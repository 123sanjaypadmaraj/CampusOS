// Data layer for the per-vendor dashboard (doc §16 vendor portal): CRUD for
// a single canteen's menu, plus print-rate CRUD for the print shop vendor.
// Menu writes reuse the exact same canteens/food_items functions the admin
// CMS already uses (../admin/api.js) -- they were never admin-exclusive in
// the code, only in practice, because only admins held 'food.menu.write'
// before real per-canteen vendor accounts existed. Isolation between
// vendors is now enforced by ownership-scoped RLS, not by which UI calls
// the function -- see supabase/migrations/20260814002200_vendor_dashboard.sql.

import { supabase } from "../../lib/supabase";
import { listFoodCategories, upsertCanteen, upsertFoodItem } from "../admin/api";
import { transitionOrderStatus, redeemPickupToken, getOrderPickupToken } from "../../services/mvpService";

export { listFoodCategories, upsertCanteen, upsertFoodItem, transitionOrderStatus, redeemPickupToken, getOrderPickupToken };

function throwIfError(error) {
  if (error) throw error;
}

// A vendor owns at most one canteen (owner_id is set 1:1 when the account
// is provisioned -- see scripts/setup-vendor-accounts.mjs).
export async function getMyCanteen(userId) {
  const { data, error } = await supabase
    .from("canteens")
    .select("*")
    .eq("owner_id", userId)
    .maybeSingle();
  throwIfError(error);
  return data;
}

export async function listMyFoodItems(canteenId) {
  const { data, error } = await supabase
    .from("food_items")
    .select("*, food_categories(id, name)")
    .eq("canteen_id", canteenId)
    .order("name");
  throwIfError(error);
  return data || [];
}

// Real delete when nothing references the item yet. Items with order
// history can't be hard-deleted -- order_items.food_item_id is a plain
// (RESTRICT) foreign key into food_items on purpose, so past receipts never
// go stale (doc §17) -- fall back to archiving (hidden from the menu,
// unavailable) instead of surfacing a raw FK error to the vendor.
export async function deleteFoodItem(id) {
  const { error } = await supabase.from("food_items").delete().eq("id", id);
  if (!error) return { hardDeleted: true };

  if (error.code === "23503") {
    const { error: archiveError } = await supabase
      .from("food_items")
      .update({ active: false, available: false })
      .eq("id", id);
    throwIfError(archiveError);
    return { hardDeleted: false };
  }

  throw error;
}

/* =========================================================================
   BULK MENU ACTIONS -- doc §16 "bulk menu & inventory". Availability/
   archive/category are the same value across every selected item, so those
   go through one .update().in() call each (single round trip, and Postgres
   applies it atomically). Price adjustment is different per item (it's a
   relative +/-, not an absolute value), so there's no single query that can
   express it -- it's computed client-side from the prices already loaded in
   the UI, then applied as one update per item via Promise.all. Menus here
   are small (tens of items, not thousands), so this is the right tradeoff:
   simple and safe over a single clever query. Deliberately NOT built on
   .upsert() -- upserting a partial row (just id+price) would reset every
   other column to its default, silently wiping name/category/etc.
========================================================================= */

export async function bulkSetAvailability(ids, available) {
  if (!ids.length) return;
  const { error } = await supabase.from("food_items").update({ available }).in("id", ids);
  throwIfError(error);
}

export async function bulkSetCategory(ids, categoryId) {
  if (!ids.length) return;
  const { error } = await supabase.from("food_items").update({ category_id: categoryId || null }).in("id", ids);
  throwIfError(error);
}

// Same "archive, don't hard-delete" reasoning as deleteFoodItem -- bulk
// delete would either half-succeed on the first FK-referenced item (23503)
// or need per-row fallback logic anyway, so bulk archive (hide from the
// menu) is the one bulk-destructive action offered; hard delete stays
// single-item only.
export async function bulkArchiveFoodItems(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from("food_items").update({ active: false, available: false }).in("id", ids);
  throwIfError(error);
}

// items: [{id, price}] -- the current price of each selected item, read
// from state the UI already has loaded (avoids an extra fetch). mode is
// 'amount' (flat ₹) or 'percent'; direction is +1 (increase) or -1
// (decrease). Price never goes below 0 and is rounded to paise.
export async function bulkAdjustPrice(items, { mode, value, direction }) {
  if (!items.length) return;
  const v = Number(value) || 0;
  const updates = items.map((it) => {
    const delta = mode === "percent" ? (Number(it.price) * v) / 100 : v;
    const nextPrice = Math.max(0, Math.round((Number(it.price) + direction * delta) * 100) / 100);
    return { id: it.id, price: nextPrice };
  });
  const results = await Promise.all(
    updates.map((u) => supabase.from("food_items").update({ price: u.price }).eq("id", u.id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

// Sets an absolute stock count on every selected item and opts them into
// tracking (setting a specific stock number without track_stock=true would
// be a silent no-op -- see food_items_stock_quantity_check /
// adjust_stock_for_order in 20260815000600, both gated on track_stock).
export async function bulkSetStock(ids, quantity) {
  if (!ids.length) return;
  const q = Math.max(0, Math.floor(Number(quantity)) || 0);
  const { error } = await supabase.from("food_items").update({ track_stock: true, stock_quantity: q }).in("id", ids);
  throwIfError(error);
}

// Turns tracking off for the selected items -- they behave like every item
// did before this feature existed (always orderable, no low-stock badge).
export async function bulkStopTrackingStock(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from("food_items").update({ track_stock: false, stock_quantity: null }).in("id", ids);
  throwIfError(error);
}

/* =========================================================================
   CSV IMPORT / EXPORT (doc §17-19) -- frontend-only, no new RPC needed.
   Export walks the items already loaded in the UI; import reuses the same
   upsertFoodItem() single-item write the manual editor uses (sequential,
   not Promise.all, so one bad row's error doesn't wreck the ordering and a
   partial-failure summary can name each broken row) -- same "menus are
   small, simple beats clever" reasoning as the bulk actions above.
========================================================================= */

const CSV_COLUMNS = [
  "id", "sku", "name", "category", "price", "description", "is_vegetarian",
  "available", "active", "featured", "preparation_time_min",
  "track_stock", "stock_quantity", "low_stock_threshold",
];

function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Turns the vendor's currently-loaded menu into a CSV string. Every column
// import understands is included, so "export, tweak a few prices in a
// spreadsheet, re-import" round-trips cleanly without dropping fields.
export function foodItemsToCsv(items, categories) {
  const categoryName = (id) => categories.find((c) => c.id === id)?.name || "";
  const rows = items.map((item) => [
    item.id, item.sku || "", item.name, categoryName(item.category_id), item.price,
    item.description || "", item.is_vegetarian, item.available, item.active, item.featured,
    item.preparation_time_min, item.track_stock, item.stock_quantity ?? "", item.low_stock_threshold,
  ]);
  return [CSV_COLUMNS, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

// A minimal RFC-4180-ish CSV parser -- handles quoted fields with embedded
// commas/newlines/escaped quotes, which a naive text.split(",") would break
// on the moment a description field contains a comma.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text ?? "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCsvBool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["true", "1", "yes", "y"].includes(String(value).trim().toLowerCase());
}

// Parses raw CSV text into ready-to-save item rows plus a list of
// human-readable per-row problems (unknown category, bad price, etc.) --
// nothing is written to the DB here, so the caller can show a preview and
// let the vendor back out before anything actually saves.
export function parseFoodItemsCsv(text, categories) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rows: [], errors: ["CSV is empty or has no data rows"] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const col = {
    id: idx("id"), sku: idx("sku"), name: idx("name"), category: idx("category"), price: idx("price"),
    description: idx("description"), is_vegetarian: idx("is_vegetarian"), available: idx("available"),
    active: idx("active"), featured: idx("featured"), prep: idx("preparation_time_min"),
    track_stock: idx("track_stock"), stock: idx("stock_quantity"), low_stock: idx("low_stock_threshold"),
  };
  if (col.name === -1 || col.price === -1) {
    return { rows: [], errors: ['CSV must have at least "name" and "price" columns'] };
  }

  const catByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const parsedRows = [];
  const errors = [];

  rows.slice(1).forEach((r, i) => {
    if (r.every((c) => c.trim() === "")) return; // skip blank rows
    const lineNo = i + 2;
    const name = (r[col.name] || "").trim();
    if (!name) { errors.push(`Row ${lineNo}: missing name`); return; }

    const priceRaw = r[col.price];
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      errors.push(`Row ${lineNo} (${name}): invalid price "${priceRaw}"`);
      return;
    }

    let categoryId = null;
    const categoryName = col.category >= 0 ? (r[col.category] || "").trim() : "";
    if (categoryName) {
      const match = catByName.get(categoryName.toLowerCase());
      if (match) categoryId = match;
      else errors.push(`Row ${lineNo} (${name}): unknown category "${categoryName}" — left uncategorised`);
    }

    const trackStock = col.track_stock >= 0 ? parseCsvBool(r[col.track_stock], false) : false;
    const stockRaw = col.stock >= 0 ? (r[col.stock] || "").trim() : "";
    let stockQuantity = null;
    if (trackStock && stockRaw !== "") {
      const n = Number(stockRaw);
      if (!Number.isFinite(n) || n < 0) errors.push(`Row ${lineNo} (${name}): invalid stock_quantity "${stockRaw}"`);
      else stockQuantity = Math.floor(n);
    }

    parsedRows.push({
      id: col.id >= 0 ? (r[col.id] || "").trim() || null : null,
      sku: col.sku >= 0 ? (r[col.sku] || "").trim() : "",
      name,
      category_id: categoryId,
      price,
      description: col.description >= 0 ? (r[col.description] || "").trim() : "",
      is_vegetarian: col.is_vegetarian >= 0 ? parseCsvBool(r[col.is_vegetarian], true) : true,
      available: col.available >= 0 ? parseCsvBool(r[col.available], true) : true,
      active: col.active >= 0 ? parseCsvBool(r[col.active], true) : true,
      featured: col.featured >= 0 ? parseCsvBool(r[col.featured], false) : false,
      preparation_time_min: col.prep >= 0 && r[col.prep] ? Number(r[col.prep]) || 10 : 10,
      track_stock: trackStock,
      stock_quantity: stockQuantity,
      low_stock_threshold: col.low_stock >= 0 && r[col.low_stock] ? Number(r[col.low_stock]) || 5 : 5,
    });
  });

  return { rows: parsedRows, errors };
}

// Applies parsed rows: matches each row against the vendor's existing menu
// by id, then sku, then name (first match wins, in that order of
// confidence) and updates it; anything unmatched is created fresh. Reuses
// upsertFoodItem so the same column-whitelisting/defaulting logic as the
// manual editor applies -- CSV can't sneak in a column the form doesn't
// already allow.
export async function bulkImportFoodItems(canteenId, parsedRows, existingItems) {
  const byId = new Map(existingItems.map((i) => [i.id, i]));
  const bySku = new Map(existingItems.filter((i) => i.sku).map((i) => [i.sku.trim().toLowerCase(), i]));
  const byName = new Map(existingItems.map((i) => [i.name.trim().toLowerCase(), i]));

  let created = 0;
  let updated = 0;
  const errors = [];

  for (const row of parsedRows) {
    const match =
      (row.id && byId.get(row.id)) ||
      (row.sku && bySku.get(row.sku.toLowerCase())) ||
      byName.get(row.name.trim().toLowerCase());
    try {
      await upsertFoodItem({ ...row, id: match?.id, canteen_id: canteenId });
      if (match) updated++; else created++;
    } catch (err) {
      errors.push(`${row.name}: ${err.message || "failed to save"}`);
    }
  }

  return { created, updated, errors };
}

// The print shop vendor manages page pricing (Black & White / Colour)
// instead of a SKU catalog -- that's what actually drives create_print_job's
// price calculation. Both rows are provisioned with owner_id set at
// account-creation time, so there's nothing to "add"; price is the only
// editable field.
export async function getMyPrintRateCard(userId) {
  const { data, error } = await supabase
    .from("print_rate_card")
    .select("*")
    .eq("owner_id", userId)
    .order("color_mode");
  throwIfError(error);
  return data || [];
}

export async function updatePrintRate(id, pricePerPage) {
  const { data, error } = await supabase
    .from("print_rate_card")
    .update({ price_per_page: pricePerPage })
    .eq("id", id)
    .select()
    .single();
  throwIfError(error);
  return data;
}

/* =========================================================================
   ORDER QUEUE (doc §13, §16) -- RECEIVED -> ACCEPTED -> PREPARING -> READY.
   Every write goes through transition_order_status(), which re-checks
   canteens.owner_id server-side (20260814002400_vendor_order_queue.sql) --
   the client never trusts its own canteenId filter for authorization,
   only for which rows to *show*.
========================================================================= */

// Active queue: everything from the moment payment clears to the moment
// it's picked up/delivered. CANCEL_REQUESTED is included -- it's not a
// terminal status (CANCEL_REQUESTED -> CANCELLED/PREPARING/READY are all
// valid, see order_status_transitions), so excluding it here was a real bug:
// an order the vendor tried to cancel used to vanish into history with no
// action ever able to move it to a terminal state. Older terminal orders
// (COMPLETED/CANCELLED/REFUNDED/...) are deliberately excluded -- see
// listCanteenOrderHistory for those.
const ACTIVE_STATUSES = ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "CANCEL_REQUESTED"];

export async function listActiveCanteenOrders(canteenId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(id, item_name, quantity, unit_price, special_instructions)")
    .eq("canteen_id", canteenId)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function listCanteenOrderHistory(canteenId, { limit = 30 } = {}) {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(id, item_name, quantity, unit_price)")
    .eq("canteen_id", canteenId)
    .not("status", "in", `(${ACTIVE_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(limit);
  throwIfError(error);
  return data || [];
}

export function subscribeToCanteenOrders(canteenId, callback) {
  if (!canteenId) return () => {};
  const channel = supabase
    .channel(`vendor-orders:${canteenId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `canteen_id=eq.${canteenId}` },
      callback
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* =========================================================================
   PRINT JOB QUEUE -- print_jobs has no state-machine RPC like orders/
   tickets (just a CHECK constraint + print_jobs_update_manage RLS, see
   0011), so a plain update is the correct, intended write path here, not a
   gap to fix.
========================================================================= */

const ACTIVE_PRINT_STATUSES = ["UPLOADED", "PROCESSING", "QUEUED", "PRINTING", "READY"];

export async function listActivePrintJobs() {
  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .in("status", ACTIVE_PRINT_STATUSES)
    .order("created_at", { ascending: true });
  throwIfError(error);

  const jobs = data || [];
  if (jobs.length === 0) return jobs;

  // A direct `profiles!...(name)` embed resolves to null here -- print.manage
  // doesn't extend to profiles RLS (same reason as the facilities dashboard's
  // ticket/booking queues). get_profile_snippets() is the safe, RLS-bypassing
  // way every other feature already shows "who did this".
  const uploaderIds = [...new Set(jobs.map((j) => j.user_id))];
  const { data: profiles } = await supabase.rpc("get_profile_snippets", { p_ids: uploaderIds });
  const profileMap = {};
  (profiles || []).forEach((p) => { profileMap[p.id] = p; });
  return jobs.map((j) => ({ ...j, profiles: profileMap[j.user_id] || null }));
}

export async function setPrintJobStatus(jobId, status) {
  const { data, error } = await supabase
    .from("print_jobs")
    .update({ status })
    .eq("id", jobId)
    .select()
    .single();
  throwIfError(error);
  return data;
}

export function subscribeToPrintJobs(callback) {
  const channel = supabase
    .channel("vendor-print-jobs")
    .on("postgres_changes", { event: "*", schema: "public", table: "print_jobs" }, callback)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* =========================================================================
   ORDER OPS -- priority / internal note / staff assignment
   (20260815000900_vendor_order_ops.sql). orders has no client-side update
   policy at all (same reasoning as transitionOrderStatus above) -- this one
   RPC is the only writer for all three fields, ownership-checked server-side.
========================================================================= */

export async function setOrderOpsFields(orderId, { priority, internalNote, assignedStaffName }) {
  const { data, error } = await supabase.rpc("set_order_ops_fields", {
    p_order_id: orderId,
    p_priority: priority,
    p_internal_note: internalNote ?? "",
    p_assigned_staff_name: assignedStaffName ?? "",
  });
  throwIfError(error);
  return data;
}

export async function listCanteenStaff(canteenId) {
  const { data, error } = await supabase
    .from("canteen_staff")
    .select("*")
    .eq("canteen_id", canteenId)
    .order("name");
  throwIfError(error);
  return data || [];
}

export async function addCanteenStaff(canteenId, name) {
  const { data, error } = await supabase
    .from("canteen_staff")
    .insert({ canteen_id: canteenId, name: name.trim() })
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function setCanteenStaffActive(id, active) {
  const { error } = await supabase.from("canteen_staff").update({ active }).eq("id", id);
  throwIfError(error);
}

export async function removeCanteenStaff(id) {
  const { error } = await supabase.from("canteen_staff").delete().eq("id", id);
  throwIfError(error);
}

/* =========================================================================
   REFUND INITIATION (doc §13, "Refund initiation") -- request_refund() (RPC,
   fixed in the same migration to actually check canteen ownership and the
   order's current status) records intent and flips the order to
   REFUND_PENDING; the razorpay-refund Edge Function then makes the real
   gateway call (needs RAZORPAY_KEY_SECRET, which never reaches the browser)
   and closes the loop via mark_refund_completed(). Two steps, not one --
   mirrors how create_payment_order()/create-razorpay-order split the same
   way on the payment side.
========================================================================= */

export async function initiateRefund(orderId, amount, reason) {
  const { data: refund, error } = await supabase.rpc("request_refund", {
    p_order_id: orderId,
    p_amount: amount,
    p_reason: reason || null,
  });
  throwIfError(error);

  const { data: result, error: fnError } = await supabase.functions.invoke("razorpay-refund", {
    body: { refund_id: refund.id },
  });
  if (fnError) throw fnError;
  return result;
}
