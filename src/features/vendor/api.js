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
// it's picked up/delivered. Older terminal orders (COMPLETED/CANCELLED/...)
// are deliberately excluded here -- see listCanteenOrderHistory for those.
const ACTIVE_STATUSES = ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

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
