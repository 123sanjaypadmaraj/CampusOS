// Live verification for the readiness-audit phase 04 engineering-doable
// subset (2026-08-24): the record_payment_event() amount-integrity check
// (supabase/migrations/20260824000700_payment_webhook_hardening.sql) and
// Campus Store's new GST/invoice/settlement depth
// (20260824000600_campus_store_gst_invoices_settlement.sql).
//
// razorpay-webhook's own hardening (body-size cap, staleness check, HMAC
// verification) is NOT covered here -- exercising it needs the actual
// RAZORPAY_WEBHOOK_SECRET value configured on the target project, which
// this script (like every other live-check in this directory) never reads
// or stores. It was verified by hand against staging with a throwaway
// secret during this pass; see campusos-payment-hardening-pass memory for
// the transcript. payment-reconciliation's auth guard (401 with no/wrong
// secret) is likewise a manual check for the same reason -- both edge
// functions are otherwise exercised end to end by real Razorpay Checkout,
// which this project has never had live keys for on any environment.
//
// Environment-aware (see docs/ENVIRONMENTS.md): defaults to staging.
// Usage: node scripts/live-check-payment-and-store-billing.mjs
//        node scripts/live-check-payment-and-store-billing.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
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
const aliceEmail = "e2e.alice@nhce.edu.in";
const alicePassword = e2ePassword(aliceEmail);

const vendorCredsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";
const vendorCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", vendorCredsFile), "utf8"));
const udupiPassword = vendorCreds.find((v) => v.vendor === "Udupi Canteen")?.password;

const storeCredsFile = target === "production" ? ".store-credentials.local.json" : ".store-credentials.staging.local.json";
const storeCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", storeCredsFile), "utf8"));

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
function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}
async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

async function main() {
  console.log(`=== Payment reconciliation / webhook hardening + Campus Store billing (${target}) ===`);
  const svc = serviceClient();
  const alice = await signIn(aliceEmail, alicePassword);
  const storeVendor = await signIn(storeCreds.email, storeCreds.password);

  // ---------------------------------------------------------------
  // record_payment_event() amount-integrity check
  // ---------------------------------------------------------------
  console.log("\n--- record_payment_event: amount integrity ---");

  const { data: udupi } = await svc.from("canteens").select("id").ilike("name", "%Udupi%").limit(1).single();
  const { data: cheapItem } = await svc.from("food_items").select("id, price, tax_rate").eq("canteen_id", udupi.id).eq("active", true).order("price", { ascending: true }).limit(1).single();

  const { data: order, error: orderErr } = await alice.sb.rpc("create_food_order", {
    p_canteen_id: udupi.id,
    p_items: [{ food_item_id: cheapItem.id, quantity: 1 }],
    p_fulfillment_type: "pickup",
  });
  check("Test food order created (PAYMENT_PENDING)", !orderErr && order?.status === "PAYMENT_PENDING", orderErr);

  const { data: payment, error: paymentErr } = await alice.sb.rpc("create_payment_order", { p_order_id: order.id });
  check("create_payment_order returns a 'created' payment row", !paymentErr && payment?.status === "created", paymentErr);

  const fakeGatewayOrderId = `order_livecheck_${Date.now()}`;
  await svc.from("payments").update({ gateway_order_id: fakeGatewayOrderId, gateway: "razorpay" }).eq("id", payment.id);

  const correctPaise = Math.round(Number(payment.amount) * 100);
  const wrongPaise = correctPaise + 500; // a plausible-looking but wrong amount

  const { error: mismatchErr } = await svc.rpc("record_payment_event", {
    p_gateway_order_id: fakeGatewayOrderId,
    p_gateway_payment_id: "pay_livecheck_mismatch",
    p_status: "captured",
    p_signature_verified: true,
    p_raw_payload: { event: "payment.captured", payload: { payment: { entity: { id: "pay_livecheck_mismatch", order_id: fakeGatewayOrderId, amount: wrongPaise } } } },
  });
  check("record_payment_event accepts a captured event with a mismatched amount (doesn't error/500)", !mismatchErr, mismatchErr);

  const { data: orderAfterMismatch } = await svc.from("orders").select("status, payment_status").eq("id", order.id).single();
  check("An amount-mismatched capture does NOT flip the order to PAID", orderAfterMismatch?.status === "PAYMENT_PENDING" && orderAfterMismatch?.payment_status !== "paid", orderAfterMismatch);

  const { data: mismatchLog } = await svc.from("error_logs").select("*").eq("category", "payment").ilike("message", "%does not match the payment owed%").order("created_at", { ascending: false }).limit(1);
  check("The mismatch is logged to error_logs for the observability alert to pick up", (mismatchLog?.length ?? 0) > 0, mismatchLog);

  const { error: correctErr } = await svc.rpc("record_payment_event", {
    p_gateway_order_id: fakeGatewayOrderId,
    p_gateway_payment_id: "pay_livecheck_correct",
    p_status: "captured",
    p_signature_verified: true,
    p_raw_payload: { event: "payment.captured", payload: { payment: { entity: { id: "pay_livecheck_correct", order_id: fakeGatewayOrderId, amount: correctPaise } } } },
  });
  check("record_payment_event accepts a captured event with the correct amount", !correctErr, correctErr);

  const { data: orderAfterCorrect } = await svc.from("orders").select("status, payment_status").eq("id", order.id).single();
  check("A correctly-amounted capture DOES flip the order to PAID (then auto-forwarded to RECEIVED)", orderAfterCorrect?.status === "RECEIVED" && orderAfterCorrect?.payment_status === "paid", orderAfterCorrect);

  // ---------------------------------------------------------------
  // Campus Store: GST config, tax computation, invoice, settlement report
  // ---------------------------------------------------------------
  console.log("\n--- Campus Store: GST / invoice / settlement ---");

  const { data: stores } = await storeVendor.sb.from("stores").select("*").eq("owner_id", storeVendor.userId).limit(1);
  const store = stores[0];

  const { error: gstErr } = await storeVendor.sb.from("stores").update({ gst_registered: true, gst_number: "29ABCDE1234F1Z5" }).eq("id", store.id);
  check("Store owner can set GST registration", !gstErr, gstErr);

  const itemName = `Live-check GST item ${Date.now()}`;
  const { data: gstItem, error: gstItemErr } = await storeVendor.sb
    .from("store_items")
    .insert({ store_id: store.id, name: itemName, price: 200, category: "General", tax_rate: 0.05 })
    .select()
    .single();
  check("Vendor can create an item with an explicit tax_rate", !gstItemErr && Number(gstItem?.tax_rate) === 0.05, gstItemErr);

  const { data: taxOrder, error: taxOrderErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: gstItem.id, quantity: 2 }],
  });
  check("Order created", !taxOrderErr, taxOrderErr);
  check("Subtotal is priced correctly (200 x 2)", Number(taxOrder?.subtotal) === 400, taxOrder);
  check("Tax is computed from the item's tax_rate (400 x 0.05 = 20)", Number(taxOrder?.tax_amount) === 20, taxOrder);
  check("Total includes tax (400 + 20)", Number(taxOrder?.total) === 420, taxOrder);

  const { error: tooEarlyErr } = await alice.sb.rpc("generate_store_order_invoice", { p_order_id: taxOrder.id });
  check("Invoice generation is refused before the order is COMPLETED", !!tooEarlyErr && /INVOICE_NOT_READY/.test(tooEarlyErr.message), tooEarlyErr?.message);

  await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: taxOrder.id, p_to_status: "PACKED" });
  await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: taxOrder.id, p_to_status: "READY" });
  await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: taxOrder.id, p_to_status: "COMPLETED" });

  const { data: invoice, error: invoiceErr } = await alice.sb.rpc("generate_store_order_invoice", { p_order_id: taxOrder.id });
  check("Invoice generates once COMPLETED", !invoiceErr && invoice?.invoice_number?.startsWith("SINV-"), invoiceErr);
  check("Invoice splits tax into CGST/SGST (store is GST-registered)", Number(invoice?.cgst_amount) === 10 && Number(invoice?.sgst_amount) === 10, invoice);
  check("Invoice carries the store's GSTIN", invoice?.gst_number === "29ABCDE1234F1Z5", invoice);

  const { data: invoiceAgain } = await alice.sb.rpc("generate_store_order_invoice", { p_order_id: taxOrder.id });
  check("Re-generating the same order's invoice is idempotent (same invoice_number)", invoiceAgain?.invoice_number === invoice?.invoice_number, { invoice, invoiceAgain });

  const { error: buyerInvoiceReadErr } = await alice.sb.from("store_order_invoices").select("*").eq("order_id", taxOrder.id).single();
  check("The buyer can read their own invoice via RLS", !buyerInvoiceReadErr, buyerInvoiceReadErr);

  const today = new Date().toISOString().slice(0, 10);
  const { data: settlement, error: settlementErr } = await storeVendor.sb.rpc("store_settlement_report", { p_start: today, p_end: today });
  check("store_settlement_report resolves for the owner", !settlementErr, settlementErr);
  const settlementRow = (settlement || []).find((r) => r.order_id === taxOrder.id);
  check("The completed order appears in today's settlement report", !!settlementRow, { settlement });
  check("Settlement net_amount matches order subtotal+tax (420, platform_fee is 0)", Number(settlementRow?.net_amount) === 420, settlementRow);

  const { error: aliceSettlementErr } = await alice.sb.rpc("store_settlement_report", { p_start: today, p_end: today });
  check("A student with no store is rejected by store_settlement_report", !!aliceSettlementErr, aliceSettlementErr?.message);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
