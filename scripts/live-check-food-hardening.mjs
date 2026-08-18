// Live verification for the Phase 3 Food Ordering hardening pass (2026-08-17):
// vendor staff sub-accounts, menu variants/add-ons/availability/dietary
// metadata, stock adjustment audit trail + inventory reports, and
// GST/invoices/payouts/settlement reconciliation.
//
// Environment-aware (see docs/ENVIRONMENTS.md): defaults to staging.
// Usage: node scripts/live-check-food-hardening.mjs
//        node scripts/live-check-food-hardening.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();

// Udupi's password isn't a fixed constant -- scripts/live-check-store-variants-
// stock.mjs (and any future admin-API reset) can change it, and
// .vendor-credentials.<env>.local.json is the one place that stays in sync
// when that happens. Read it from there instead of hardcoding a value that
// silently goes stale the moment another script rotates it (this is exactly
// what broke this script's sign-in previously -- see git history).
const vendorCredsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";
const vendorCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", vendorCredsFile), "utf8"));
const VENDOR_PASSWORD = vendorCreds.find((v) => v.vendor === "Udupi Canteen")?.password;
if (!VENDOR_PASSWORD || VENDOR_PASSWORD.startsWith("(")) {
  throw new Error(`This script's Udupi vendor password isn't known in ${vendorCredsFile} for ${target} runs.`);
}

// Same reasoning as the vendor password above -- e2e.alice/bob/carol no
// longer have fixed literal passwords (2026-08-18 credential-rotation
// incident, see SECURITY.md): scripts/setup-test-users.mjs is the one place
// that mints/persists them now, into this gitignored file. Hardcoding the
// old literals here is exactly what broke this script's sign-in after that
// rotation.
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const e2ePassword = (email) => {
  const password = e2eCreds.find((r) => r.email === email)?.password;
  if (!password) throw new Error(`No password known for ${email} in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
  return password;
};

const ALICE = { email: "e2e.alice@nhce.edu.in", password: e2ePassword("e2e.alice@nhce.edu.in") };
const BOB = { email: "e2e.bob@nhce.edu.in", password: e2ePassword("e2e.bob@nhce.edu.in") };
const CAROL = { email: "e2e.carol@nhce.edu.in", password: e2ePassword("e2e.carol@nhce.edu.in") };
const UDUPI_VENDOR = { email: "udupi.canteen@nhce.edu.in", password: VENDOR_PASSWORD };
const ADMIN = { email: "1nh25cs265@usn.campusos.internal", password: "Sanjay@123" };

let passCount = 0;
let failCount = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  [pass] ${label}`);
    passCount++;
  } else {
    console.log(`  [FAIL] ${label}${extra ? ` -- ${JSON.stringify(extra)}` : ""}`);
    failCount++;
  }
}

function client() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(creds) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword(creds);
  if (error) throw new Error(`Sign-in failed for ${creds.email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

async function simulatePaymentCapture(studentSb, admin, orderId) {
  const { error: createPaymentErr } = await studentSb.rpc("create_payment_order", { p_order_id: orderId });
  if (createPaymentErr) throw new Error(`create_payment_order failed: ${createPaymentErr.message}`);

  const gatewayOrderId = `live-check-food-hardening-${orderId}`;
  const { error: payErr } = await admin.from("payments").update({ gateway_order_id: gatewayOrderId }).eq("order_id", orderId).eq("status", "created");
  if (payErr) throw new Error(`Could not stamp gateway_order_id: ${payErr.message}`);

  const { error: eventErr } = await admin.rpc("record_payment_event", {
    p_gateway_order_id: gatewayOrderId,
    p_gateway_payment_id: `live-check-payment-${orderId}`,
    p_status: "captured",
    p_signature_verified: true,
    p_raw_payload: { source: "live-check-food-hardening.mjs" },
  });
  if (eventErr) throw new Error(`record_payment_event failed: ${eventErr.message}`);
}

async function main() {
  console.log(`=== Food ordering hardening pass (${target}) ===`);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const alice = await signIn(ALICE);
  const bob = await signIn(BOB);
  const carol = await signIn(CAROL);
  const udupi = await signIn(UDUPI_VENDOR);
  const superAdmin = await signIn(ADMIN);

  const { data: canteen, error: canteenErr } = await udupi.sb.from("canteens").select("id, gst_registered, gst_number").eq("owner_id", udupi.userId).single();
  if (canteenErr || !canteen) throw new Error(`Could not find Udupi's canteen: ${canteenErr?.message}`);
  const canteenOriginalGst = { gst_registered: canteen.gst_registered, gst_number: canteen.gst_number };

  const { data: bobProfileBefore } = await admin.from("profiles").select("role").eq("id", bob.userId).single();
  const bobOriginalRole = bobProfileBefore?.role;

  const cleanup = { orderIds: [], itemIds: [], hoursIds: [], staffAccountId: null, payoutIds: [] };

  try {
    /* ============================== GROUP A: vendor staff ============================== */
    console.log("\n-- Vendor staff sub-accounts --");

    const { error: staffAddErr } = await bob.sb.rpc("add_canteen_staff_account", { p_canteen_id: canteen.id, p_email: UDUPI_VENDOR.email });
    check("A non-owner cannot add themselves as staff for someone else's canteen", !!staffAddErr, staffAddErr?.message);

    const { data: staffRow, error: addStaffErr } = await udupi.sb.rpc("add_canteen_staff_account", { p_canteen_id: canteen.id, p_email: BOB.email });
    check("Canteen owner can add an existing student as staff", !addStaffErr && staffRow?.user_id === bob.userId, addStaffErr);
    cleanup.staffAccountId = staffRow?.id;

    const { data: bobProfileAfter } = await admin.from("profiles").select("role").eq("id", bob.userId).single();
    check("Adding staff promotes the target profile to vendor_staff", bobProfileAfter?.role === "vendor_staff", bobProfileAfter?.role);

    // A stock-tracked item, used both for the staff-can-adjust-stock check
    // below and for Group C's inventory report later.
    const STOCK_ITEM_NAME = "Live Check Stock Variant Item";
    await admin.from("food_items").delete().eq("canteen_id", canteen.id).eq("name", STOCK_ITEM_NAME);
    const { data: stockItem, error: stockItemErr } = await udupi.sb
      .from("food_items")
      .insert({ canteen_id: canteen.id, name: STOCK_ITEM_NAME, price: 50, is_vegetarian: true, available: true, active: true })
      .select()
      .single();
    check("Vendor can create the stock-test item", !stockItemErr, stockItemErr);
    cleanup.itemIds.push(stockItem.id);

    const { data: stockVariant, error: stockVariantErr } = await udupi.sb
      .from("food_item_variants")
      .insert({ food_item_id: stockItem.id, name: "Full", price: 50, track_stock: true, stock_quantity: 3, low_stock_threshold: 2 })
      .select()
      .single();
    check("Vendor can create a stock-tracked variant", !stockVariantErr && stockVariant?.stock_quantity === 3, stockVariantErr);

    const { data: order1, error: order1Err } = await alice.sb.rpc("create_food_order", {
      p_canteen_id: canteen.id,
      p_items: [{ food_item_id: stockItem.id, quantity: 2, variant_id: stockVariant.id }],
      p_idempotency_key: `live-check-food-hardening-stock-${Date.now()}`,
    });
    check("Student can order a variant", !order1Err, order1Err?.message);
    cleanup.orderIds.push(order1.id);
    await simulatePaymentCapture(alice.sb, admin, order1.id);

    const { data: variantAfterOrder } = await admin.from("food_item_variants").select("stock_quantity").eq("id", stockVariant.id).single();
    check("Paid order decrements variant stock 3 -> 1", variantAfterOrder?.stock_quantity === 1, variantAfterOrder?.stock_quantity);

    const { error: bobAcceptErr } = await bob.sb.rpc("transition_order_status", { p_order_id: order1.id, p_to_status: "ACCEPTED" });
    check("Staff sub-account can advance an order for their canteen", !bobAcceptErr, bobAcceptErr?.message);

    const { error: bobMenuWriteErr } = await bob.sb.from("food_items").update({ price: 999 }).eq("id", stockItem.id);
    const { data: priceCheck } = await admin.from("food_items").select("price").eq("id", stockItem.id).single();
    check("Staff sub-account cannot write menu items (price unchanged)", Number(priceCheck.price) !== 999, priceCheck.price);

    const { error: bobRefundErr } = await bob.sb.rpc("request_refund", { p_order_id: order1.id, p_amount: 100, p_reason: "test" });
    check("Staff sub-account cannot initiate refunds", !!bobRefundErr, bobRefundErr?.message);

    const { data: bobStockAdjust, error: bobStockErr } = await bob.sb.rpc("adjust_item_stock", {
      p_food_item_id: stockItem.id, p_variant_id: stockVariant.id, p_delta: 5, p_reason: "live-check restock by staff",
    });
    check("Staff sub-account CAN adjust stock (operational task)", !bobStockErr && bobStockAdjust === 6, bobStockErr?.message || bobStockAdjust);

    const { error: carolStockErr } = await carol.sb.rpc("adjust_item_stock", { p_food_item_id: stockItem.id, p_variant_id: stockVariant.id, p_delta: 1 });
    check("An uninvolved student cannot adjust this canteen's stock", !!carolStockErr, carolStockErr?.message);

    const { error: removeStaffErr } = await udupi.sb.rpc("remove_canteen_staff_account", { p_staff_account_id: staffRow.id });
    check("Canteen owner can remove a staff account", !removeStaffErr, removeStaffErr?.message);
    cleanup.staffAccountId = null;

    const { data: bobProfileFinal } = await admin.from("profiles").select("role").eq("id", bob.userId).single();
    check("Removing staff reverts the profile role back to student", bobProfileFinal?.role === "student", bobProfileFinal?.role);

    const { error: bobPostRemovalErr } = await bob.sb.rpc("transition_order_status", { p_order_id: order1.id, p_to_status: "PREPARING" });
    check("Ex-staff can no longer manage this canteen's orders", !!bobPostRemovalErr, bobPostRemovalErr?.message);

    /* ============================== GROUP B: menu depth ============================== */
    console.log("\n-- Menu variants / add-ons / dietary metadata / availability --");

    const MENU_ITEM_NAME = "Live Check Thali";
    await admin.from("food_items").delete().eq("canteen_id", canteen.id).eq("name", MENU_ITEM_NAME);
    const { data: menuItem, error: menuItemErr } = await udupi.sb
      .from("food_items")
      .insert({
        canteen_id: canteen.id, name: MENU_ITEM_NAME, price: 80, is_vegetarian: true, available: true, active: true,
        dietary_tags: ["vegan"], allergens: ["gluten"], spice_level: "medium", calories: 450,
      })
      .select()
      .single();
    check("Vendor can set dietary metadata on an item", !menuItemErr && menuItem?.dietary_tags?.[0] === "vegan" && menuItem?.spice_level === "medium", menuItemErr);
    cleanup.itemIds.push(menuItem.id);

    const { data: fullVariant, error: fullVariantErr } = await udupi.sb
      .from("food_item_variants").insert({ food_item_id: menuItem.id, name: "Full", price: 120 }).select().single();
    check("Vendor can create a priced variant", !fullVariantErr, fullVariantErr);

    const { data: anonVariantCheck } = await client().from("food_item_variants").select("id").eq("id", fullVariant.id);
    check("Anonymous users can read active variants", (anonVariantCheck || []).length === 1);

    const { data: spiceGroup } = await udupi.sb.from("food_item_addon_groups")
      .insert({ food_item_id: menuItem.id, name: "Spice Level", min_select: 1, max_select: 1 }).select().single();
    const { data: spiceOptions } = await udupi.sb.from("food_item_addon_options")
      .insert([{ group_id: spiceGroup.id, name: "Mild", price_delta: 0 }, { group_id: spiceGroup.id, name: "Hot", price_delta: 0 }])
      .select();
    const { data: toppingsGroup } = await udupi.sb.from("food_item_addon_groups")
      .insert({ food_item_id: menuItem.id, name: "Extra Toppings", min_select: 0, max_select: 2 }).select().single();
    const { data: toppingOptions } = await udupi.sb.from("food_item_addon_options")
      .insert([{ group_id: toppingsGroup.id, name: "Paneer", price_delta: 20 }]).select();
    check("Vendor can build required + optional add-on groups", !!spiceGroup && spiceOptions?.length === 2 && !!toppingsGroup && toppingOptions?.length === 1);

    const { error: missingRequiredErr } = await alice.sb.rpc("create_food_order", {
      p_canteen_id: canteen.id,
      p_items: [{ food_item_id: menuItem.id, quantity: 1, variant_id: fullVariant.id }],
      p_idempotency_key: `live-check-food-hardening-noaddon-${Date.now()}`,
    });
    check("Ordering without a required add-on group selection is rejected", !!missingRequiredErr && /ADDON/.test(missingRequiredErr.message), missingRequiredErr?.message);

    const hotOption = spiceOptions.find((o) => o.name === "Hot");
    const paneerOption = toppingOptions[0];
    const { data: order2, error: order2Err } = await alice.sb.rpc("create_food_order", {
      p_canteen_id: canteen.id,
      p_items: [{ food_item_id: menuItem.id, quantity: 2, variant_id: fullVariant.id, addon_option_ids: [hotOption.id, paneerOption.id] }],
      p_idempotency_key: `live-check-food-hardening-order2-${Date.now()}`,
    });
    check("Ordering a variant + valid add-ons succeeds", !order2Err, order2Err?.message);
    cleanup.orderIds.push(order2.id);

    const { data: order2Items } = await admin.from("order_items").select("*").eq("order_id", order2.id).single();
    const expectedUnitPrice = 120 + 20; // variant price + Paneer add-on (Hot is free)
    check("Order line snapshot has the right variant name", order2Items?.variant_name === "Full", order2Items?.variant_name);
    check("Order line unit price = variant price + add-on price", Number(order2Items?.unit_price) === expectedUnitPrice, order2Items?.unit_price);
    check("Order line add-on selection has 2 entries", Array.isArray(order2Items?.addon_selection) && order2Items.addon_selection.length === 2, order2Items?.addon_selection);
    await simulatePaymentCapture(alice.sb, admin, order2.id);

    const today = new Date().getDay();
    await udupi.sb.from("food_items").update({ available_days: [(today + 1) % 7, (today + 2) % 7] }).eq("id", menuItem.id);
    const { error: itemUnavailableErr } = await alice.sb.rpc("create_food_order", {
      p_canteen_id: canteen.id,
      p_items: [{ food_item_id: menuItem.id, quantity: 1, variant_id: fullVariant.id, addon_option_ids: [hotOption.id] }],
      p_idempotency_key: `live-check-food-hardening-daywindow-${Date.now()}`,
    });
    check("Item outside its available_days window is rejected", !!itemUnavailableErr && /UNAVAILABLE/.test(itemUnavailableErr.message), itemUnavailableErr?.message);
    await udupi.sb.from("food_items").update({ available_days: null }).eq("id", menuItem.id);

    const nowTime = new Date();
    const closedFrom = `${String((nowTime.getHours() + 3) % 24).padStart(2, "0")}:00:00`;
    const closedTo = `${String((nowTime.getHours() + 4) % 24).padStart(2, "0")}:00:00`;
    const { data: hoursRow } = await udupi.sb.from("canteen_hours")
      .insert({ canteen_id: canteen.id, day_of_week: today, opens_at: closedFrom, closes_at: closedTo }).select().single();
    cleanup.hoursIds.push(hoursRow.id);
    const { error: closedCanteenErr } = await alice.sb.rpc("create_food_order", {
      p_canteen_id: canteen.id,
      p_items: [{ food_item_id: menuItem.id, quantity: 1, variant_id: fullVariant.id, addon_option_ids: [hotOption.id] }],
      p_idempotency_key: `live-check-food-hardening-closed-${Date.now()}`,
    });
    check("Ordering outside configured canteen hours is rejected", !!closedCanteenErr && /CANTEEN_CLOSED/.test(closedCanteenErr.message), closedCanteenErr?.message);
    await udupi.sb.from("canteen_hours").delete().eq("id", hoursRow.id);
    cleanup.hoursIds = [];

    /* ============================== GROUP C: inventory ops ============================== */
    console.log("\n-- Stock adjustment audit trail + inventory report --");

    const { data: consumeRows } = await admin.from("stock_adjustments").select("*").eq("variant_id", stockVariant.id).eq("source", "order_consume");
    check("Order consumption logged a stock_adjustments row", (consumeRows || []).some((r) => r.delta === -2 && r.order_id === order1.id), consumeRows);

    const { data: restockRows } = await admin.from("stock_adjustments").select("*").eq("variant_id", stockVariant.id).eq("source", "manual_restock");
    check("Manual restock logged a stock_adjustments row", (restockRows || []).some((r) => r.delta === 5 && r.actor_id === bob.userId), restockRows);

    const { data: report, error: reportErr } = await udupi.sb.rpc("vendor_inventory_report", { p_days: 1 });
    const reportRow = (report || []).find((r) => r.variant_id === stockVariant.id);
    check("vendor_inventory_report includes the tracked variant with correct movement", !reportErr && reportRow?.consumed_qty === 2 && reportRow?.restocked_qty === 5, reportErr || reportRow);

    const { error: carolReportErr } = await carol.sb.rpc("vendor_inventory_report", {});
    check("A student with no canteen cannot read an inventory report", !!carolReportErr, carolReportErr?.message);

    /* ============================== GROUP D: billing & payouts ============================== */
    console.log("\n-- GST / invoices / payouts / settlement --");

    const { data: invoice1, error: invoice1Err } = await alice.sb.rpc("generate_order_invoice", { p_order_id: order2.id });
    check("Buyer can generate an invoice for their paid order", !invoice1Err && invoice1?.invoice_number?.startsWith("INV-"), invoice1Err?.message);
    check("Invoice with GST not registered shows no CGST/SGST split", Number(invoice1?.cgst_amount) === 0 && Number(invoice1?.sgst_amount) === 0, invoice1);

    const { data: invoice1Again } = await alice.sb.rpc("generate_order_invoice", { p_order_id: order2.id });
    check("Generating the same invoice twice is idempotent", invoice1Again?.id === invoice1?.id, invoice1Again);

    const { error: carolInvoiceErr } = await carol.sb.rpc("generate_order_invoice", { p_order_id: order2.id });
    check("An uninvolved student cannot generate someone else's invoice", !!carolInvoiceErr, carolInvoiceErr?.message);

    await udupi.sb.from("canteens").update({ gst_registered: true, gst_number: "29ABCDE1234F1Z5" }).eq("id", canteen.id);
    const { data: invoice2, error: invoice2Err } = await udupi.sb.rpc("generate_order_invoice", { p_order_id: order1.id });
    const expectedTax = Number(invoice2?.tax_amount || 0);
    const splitSum = Number(invoice2?.cgst_amount || 0) + Number(invoice2?.sgst_amount || 0);
    check("With GST registered, invoice splits tax into CGST+SGST summing to tax_amount", !invoice2Err && Math.abs(splitSum - expectedTax) < 0.01, invoice2Err || invoice2);

    const startDate = new Date().toISOString().slice(0, 10);
    const { data: settlement, error: settlementErr } = await udupi.sb.rpc("vendor_settlement_report", { p_start: startDate, p_end: startDate });
    const settlementOrderIds = (settlement || []).filter((r) => r.row_type === "order").map((r) => r.order_id);
    check("Settlement report includes both today's paid orders", !settlementErr && settlementOrderIds.includes(order1.id) && settlementOrderIds.includes(order2.id), settlementErr || settlement);

    const { error: udupiPayoutErr } = await udupi.sb.rpc("generate_vendor_payout", { p_canteen_id: canteen.id, p_period_start: startDate, p_period_end: startDate });
    check("A vendor (non-admin) cannot generate their own payout", !!udupiPayoutErr, udupiPayoutErr?.message);

    const { data: payout, error: payoutErr } = await superAdmin.sb.rpc("generate_vendor_payout", { p_canteen_id: canteen.id, p_period_start: startDate, p_period_end: startDate });
    check("Admin can generate a vendor payout", !payoutErr && Number(payout?.net_amount) > 0, payoutErr?.message);
    if (payout?.id) cleanup.payoutIds.push(payout.id);

    const { error: duplicatePayoutErr } = await superAdmin.sb.rpc("generate_vendor_payout", { p_canteen_id: canteen.id, p_period_start: startDate, p_period_end: startDate });
    check("Generating a payout for the same period twice is rejected", !!duplicatePayoutErr, duplicatePayoutErr?.message);

    const { data: paidPayout, error: markPaidErr } = await superAdmin.sb.rpc("mark_payout_paid", { p_payout_id: payout.id, p_reference: "live-check-ref-001" });
    check("Admin can mark a payout as paid", !markPaidErr && paidPayout?.status === "paid", markPaidErr?.message);

    const { error: udupiMarkPaidErr } = await udupi.sb.rpc("mark_payout_paid", { p_payout_id: payout.id, p_reference: "x" });
    check("A vendor cannot mark their own payout as paid", !!udupiMarkPaidErr, udupiMarkPaidErr?.message);

    const { data: vendorPayoutRead } = await udupi.sb.from("vendor_payouts").select("id").eq("id", payout.id);
    check("Vendor can read their own payout record", (vendorPayoutRead || []).length === 1);
  } finally {
    console.log("\n(cleaning up)");
    if (cleanup.staffAccountId) {
      await udupi.sb.rpc("remove_canteen_staff_account", { p_staff_account_id: cleanup.staffAccountId }).catch(() => {});
    }
    if (bobOriginalRole && bobOriginalRole !== "vendor_staff") {
      await admin.from("profiles").update({ role: bobOriginalRole }).eq("id", bob.userId);
    }
    await admin.from("vendor_payouts").delete().in("id", cleanup.payoutIds);
    await admin.from("order_invoices").delete().in("order_id", cleanup.orderIds);
    await admin.from("stock_adjustments").delete().in("order_id", cleanup.orderIds);
    await admin.from("order_status_history").delete().in("order_id", cleanup.orderIds);
    await admin.from("order_items").delete().in("order_id", cleanup.orderIds);
    await admin.from("payments").delete().in("order_id", cleanup.orderIds);
    await admin.from("orders").delete().in("id", cleanup.orderIds);
    await admin.from("canteen_hours").delete().in("id", cleanup.hoursIds);
    await admin.from("food_items").delete().in("id", cleanup.itemIds); // cascades variants/addon groups/options
    await admin.from("canteens").update(canteenOriginalGst).eq("id", canteen.id);
    console.log("(cleanup done)");
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
