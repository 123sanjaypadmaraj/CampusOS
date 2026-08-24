// One-off live verification script (not part of the automated suite) --
// exercises the Campus Store stock-tracking / product-variant / analytics
// additions from supabase/migrations/20260815000900_campus_store_variants_
// stock_analytics.sql against a real signed-in session. Same idea/shape as
// scripts/live-check-campus-store.mjs, which already covers the base
// commerce flow (idempotent orders, pickup codes, state machine, ownership
// RLS) -- this only covers what's new.
//
// Usage: node scripts/live-check-store-variants-stock.mjs                       (staging, default)
//        node scripts/live-check-store-variants-stock.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const e2ePassword = (email) => {
  const password = e2eCreds.find((r) => r.email === email)?.password;
  if (!password) throw new Error(`No password known for ${email} in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
  return password;
};

const credsFile = target === "production" ? ".store-credentials.local.json" : ".store-credentials.staging.local.json";
const vendorCredsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";
const storeCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", credsFile), "utf8"));
const vendorCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", vendorCredsFile), "utf8"));
const udupi = vendorCreds.find((v) => v.vendor === "Udupi Canteen");
const aliceEmail = "e2e.alice@nhce.edu.in";
const alicePassword = e2ePassword("e2e.alice@nhce.edu.in");

let passCount = 0;
let failCount = 0;
function check(label, cond, extra) {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}${extra ? " -- " + JSON.stringify(extra) : ""}`);
  }
}

function client() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

// Udupi's staging password isn't fixed -- reset it via the Admin API for the
// duration of this one negative-RLS check. IMPORTANT: this account is shared
// with live-check-food-hardening.mjs/live-check-food-stock.mjs/
// live-check-vendor-order-ops.mjs (all of which read the password back out of
// vendorCredsFile rather than hardcoding it), plus anyone signing in on
// staging by hand -- a reset with no corresponding write-back here previously
// left the credentials file permanently stale relative to the account's real
// password (production incident lesson: this caused cascading sign-in
// failures in every one of those other scripts once this one had run first).
// Always persist the new password to vendorCredsFile in the same call so it
// stays the single source of truth for every script that reads it.
async function adminResetPassword(userId, newPassword) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) throw new Error(`Password reset failed for ${userId}: ${res.status} ${await res.text()}`);

  const entry = vendorCreds.find((v) => v.userId === userId);
  if (entry) {
    entry.password = newPassword;
    fs.writeFileSync(path.join(root, "scripts", vendorCredsFile), JSON.stringify(vendorCreds, null, 2));
  }
}

async function main() {
  console.log(`=== Campus Store: stock tracking, variants, analytics (${target}) ===`);

  const alice = await signIn(aliceEmail, alicePassword);
  const storeVendor = await signIn(storeCreds.email, storeCreds.password);

  const { data: stores } = await storeVendor.sb.from("stores").select("*").eq("owner_id", storeVendor.userId).limit(1);
  const store = stores?.[0];
  check("Store vendor owns a real store row", !!store, stores);

  // ---------------------------------------------------------------
  // Item-level stock tracking (no variant)
  // ---------------------------------------------------------------
  const stockItemName = `Live-check stock item ${Date.now()}`;
  const { data: stockItem, error: stockItemErr } = await storeVendor.sb
    .from("store_items")
    .insert({ store_id: store.id, name: stockItemName, price: 99, category: "General", track_stock: true, stock_quantity: 2 })
    .select()
    .single();
  check("Vendor can create a stock-tracked item", !stockItemErr && stockItem?.stock_quantity === 2, stockItemErr);

  const { data: order1, error: order1Err } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: stockItem.id, quantity: 2 }],
  });
  check("Ordering the full tracked stock succeeds", !order1Err && order1?.status === "PLACED", order1Err);

  const { data: afterOrder } = await alice.sb.from("store_items").select("stock_quantity, available").eq("id", stockItem.id).single();
  check("Stock decrements by the ordered quantity immediately at PLACED", afterOrder?.stock_quantity === 0, afterOrder);
  check("Stock hitting 0 auto-flips the item unavailable", afterOrder?.available === false, afterOrder);

  const { error: overorderErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: stockItem.id, quantity: 1 }],
  });
  check("Ordering more than available stock is rejected", !!overorderErr, overorderErr?.message);

  const { error: cancelReqErr } = await alice.sb.rpc("transition_store_order_status", { p_order_id: order1.id, p_to_status: "CANCEL_REQUESTED" });
  check("Buyer can request cancellation", !cancelReqErr, cancelReqErr);
  const { error: cancelErr } = await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: order1.id, p_to_status: "CANCELLED" });
  check("Vendor can confirm the cancellation", !cancelErr, cancelErr);

  const { data: afterCancel } = await alice.sb.from("store_items").select("stock_quantity, available").eq("id", stockItem.id).single();
  check("Cancelling a PLACED order restores the stock it had reserved", afterCancel?.stock_quantity === 2, afterCancel);
  check("Stock restoration does NOT auto-flip availability back on (vendor may have hidden it deliberately)", afterCancel?.available === false, afterCancel);

  // ---------------------------------------------------------------
  // Product variants
  // ---------------------------------------------------------------
  const variantItemName = `Live-check variant item ${Date.now()}`;
  const { data: variantItem, error: variantItemErr } = await storeVendor.sb
    .from("store_items")
    .insert({ store_id: store.id, name: variantItemName, price: 500, category: "Merch" })
    .select()
    .single();
  check("Vendor can create the parent item for variants", !variantItemErr, variantItemErr);

  const { data: smallVariant, error: smallErr } = await storeVendor.sb
    .from("store_item_variants")
    .insert({ store_item_id: variantItem.id, name: "Small", price: 480, track_stock: true, stock_quantity: 1 })
    .select()
    .single();
  const { data: mediumVariant, error: mediumErr } = await storeVendor.sb
    .from("store_item_variants")
    .insert({ store_item_id: variantItem.id, name: "Medium", price: 520 })
    .select()
    .single();
  check("Vendor can add a stock-tracked variant", !smallErr && smallVariant?.stock_quantity === 1, smallErr);
  check("Vendor can add an untracked variant", !mediumErr && mediumVariant?.track_stock === false, mediumErr);

  const { data: readBack, error: readErr } = await alice.sb
    .from("store_items")
    .select("*, store_item_variants(*)")
    .eq("id", variantItem.id)
    .single();
  check("Anyone can read an item's variants via embed (RLS)", !readErr && readBack?.store_item_variants?.length === 2, { readErr, count: readBack?.store_item_variants?.length });

  const { data: variantOrder, error: variantOrderErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: variantItem.id, variant_id: smallVariant.id, quantity: 1 }],
  });
  check("Ordering a variant succeeds", !variantOrderErr && variantOrder?.status === "PLACED", variantOrderErr);
  // 480 subtotal + 5% default tax_rate (20260824000600_campus_store_gst_
  // invoices_settlement.sql) = 504. Priced off the variant, not the parent
  // item's price -- that's still the thing this assertion is really for.
  check("Order total is priced off the variant, not the parent item (480 + 5% tax = 504)", Number(variantOrder?.total) === 504, variantOrder);

  const { data: orderItems } = await alice.sb.from("store_order_items").select("*").eq("order_id", variantOrder.id);
  check("The order item snapshots the variant name", orderItems?.[0]?.variant_name === "Small", orderItems);
  check("The order item's display name includes the variant", orderItems?.[0]?.item_name === `${variantItemName} (Small)`, orderItems);

  const { data: smallAfter } = await alice.sb.from("store_item_variants").select("stock_quantity, available").eq("id", smallVariant.id).single();
  check("The variant's own stock decremented (parent item's price/stock untouched)", smallAfter?.stock_quantity === 0 && smallAfter?.available === false, smallAfter);

  const { error: variantOutOfStockErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: variantItem.id, variant_id: smallVariant.id, quantity: 1 }],
  });
  check("Ordering an out-of-stock variant is rejected", !!variantOutOfStockErr && /out of stock|no longer available/i.test(variantOutOfStockErr.message), variantOutOfStockErr?.message);

  const { data: mediumOrder, error: mediumOrderErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: variantItem.id, variant_id: mediumVariant.id, quantity: 3 }],
  });
  check("The untracked variant has no stock ceiling", !mediumOrderErr && mediumOrder?.status === "PLACED", mediumOrderErr);
  // 1560 subtotal + 5% default tax_rate = 1638 (see note above).
  check("Untracked variant order is priced correctly (520 x 3 + 5% tax = 1638)", Number(mediumOrder?.total) === 1638, mediumOrder);

  const { error: mismatchedVariantErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: stockItem.id, variant_id: smallVariant.id, quantity: 1 }],
  });
  check("A variant that doesn't belong to the given item is rejected", !!mismatchedVariantErr, mismatchedVariantErr?.message);

  // Cancel-and-restore, this time through a variant
  const { data: smallVariant2 } = await storeVendor.sb
    .from("store_item_variants")
    .update({ stock_quantity: 1, available: true })
    .eq("id", smallVariant.id)
    .select()
    .single();
  check("Vendor can restock a variant by hand", smallVariant2?.stock_quantity === 1 && smallVariant2?.available === true, smallVariant2);

  const { data: order2 } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: variantItem.id, variant_id: smallVariant.id, quantity: 1 }],
  });
  await alice.sb.rpc("transition_store_order_status", { p_order_id: order2.id, p_to_status: "CANCEL_REQUESTED" });
  await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: order2.id, p_to_status: "CANCELLED" });
  const { data: smallAfterRestore } = await alice.sb.from("store_item_variants").select("stock_quantity").eq("id", smallVariant.id).single();
  check("Cancelling a variant order restores that variant's stock specifically", smallAfterRestore?.stock_quantity === 1, smallAfterRestore);

  // Hard-delete of a variant with order history should succeed (ON DELETE
  // SET NULL), unlike items -- and the order's own item_name/variant_name
  // snapshots should stay intact regardless.
  const { error: deleteVariantErr } = await storeVendor.sb.from("store_item_variants").delete().eq("id", mediumVariant.id);
  check("A variant with order history can be hard-deleted (snapshot columns preserve history)", !deleteVariantErr, deleteVariantErr);
  const { data: orderAfterVariantDelete } = await alice.sb.from("store_order_items").select("variant_id, variant_name, item_name").eq("order_id", mediumOrder.id).single();
  check("Past order still reads correctly after its variant is deleted", orderAfterVariantDelete?.variant_id === null && orderAfterVariantDelete?.variant_name === "Medium", orderAfterVariantDelete);

  console.log("\n=== Cross-vendor RLS on variants ===");
  // Random, not a fixed literal -- an earlier version hardcoded
  // "LiveCheckTemp!2026" here, which meant a production run left Udupi
  // Canteen's real login password sitting in this public tracked file
  // (same class of finding as the admin-account incident, see SECURITY.md's
  // 2026-08-23 entry). adminResetPassword() already persists whatever's
  // passed here back to vendorCredsFile, so a random value costs nothing.
  const tempPassword = crypto.randomBytes(18).toString("base64url");
  await adminResetPassword(udupi.userId, tempPassword);
  const udupiVendor = await signIn(udupi.email, tempPassword);

  const { error: intruderVariantErr } = await udupiVendor.sb
    .from("store_item_variants")
    .insert({ store_item_id: variantItem.id, name: "Intruder", price: 1 });
  check("A different vendor cannot add a variant to this store's item (RLS)", !!intruderVariantErr, intruderVariantErr?.message);

  const { error: intruderVariantUpdateErr } = await udupiVendor.sb
    .from("store_item_variants")
    .update({ price: 1 })
    .eq("id", smallVariant.id);
  const { data: unchangedVariant } = await alice.sb.from("store_item_variants").select("price").eq("id", smallVariant.id).single();
  check("A different vendor cannot edit this store's variant (RLS)", Number(unchangedVariant?.price) === 480, { intruderVariantUpdateErr, unchangedVariant });

  console.log("\n=== Store analytics (vendor_gmv_series / vendor_sla_summary) ===");
  // GMV only counts COMPLETED orders (pay-at-pickup has no payment_status to
  // key off) -- walk variantOrder and mediumOrder through the full state
  // machine so there's a real, known completed total to assert against.
  for (const o of [variantOrder, mediumOrder]) {
    await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: o.id, p_to_status: "PACKED" });
    await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: o.id, p_to_status: "READY" });
    await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: o.id, p_to_status: "COMPLETED" });
  }

  const { data: gmv, error: gmvErr } = await storeVendor.sb.rpc("vendor_gmv_series", { p_days: 7 });
  check("vendor_gmv_series resolves the 'store' branch for a store owner", !gmvErr && Array.isArray(gmv) && gmv.length === 7, gmvErr);
  const totalGmv = (gmv || []).reduce((s, d) => s + Number(d.gmv || 0), 0);
  check("Today's GMV reflects the two completed test orders (504 + 1638, tax-inclusive totals)", totalGmv >= 2142, { totalGmv, gmv });

  const { data: sla, error: slaErr } = await storeVendor.sb.rpc("vendor_sla_summary", { p_days: 7 });
  check("vendor_sla_summary resolves the 'store_order' domain for a store owner", !slaErr && sla?.[0]?.domain === "store_order", { slaErr, sla });

  const { error: aliceAnalyticsErr } = await alice.sb.rpc("vendor_gmv_series", { p_days: 7 });
  check("A student with no vendor profile is rejected by vendor_gmv_series", !!aliceAnalyticsErr, aliceAnalyticsErr?.message);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
