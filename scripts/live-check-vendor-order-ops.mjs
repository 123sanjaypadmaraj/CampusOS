// Live verification script for vendor order-ops depth (priority / internal
// notes / staff assignment / cancel-confirm-or-resume / refund initiation --
// supabase/migrations/20260815001000_vendor_order_ops.sql,
// supabase/functions/razorpay-refund). Not a throwaway -- kept alongside the
// other scripts/live-check-*.mjs scripts. Environment-aware (see
// docs/ENVIRONMENTS.md): defaults to staging.
//
// Usage: node scripts/live-check-vendor-order-ops.mjs
//        node scripts/live-check-vendor-order-ops.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();

// Both Tango's and Udupi's passwords now live in .vendor-credentials.<env>.
// local.json, not hardcoded -- the 2026-08-18 credential-rotation incident
// (see SECURITY.md) rotated every test vendor account on both environments,
// so a literal here (Tango's old comment called it "the one place with no
// other known source") goes stale the moment that rotation happens, exactly
// like Udupi's already did. See the identical comment in
// live-check-food-hardening.mjs.
const vendorCredsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";
const vendorCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", vendorCredsFile), "utf8"));
const vendorPassword = (vendor) => {
  const password = vendorCreds.find((v) => v.vendor === vendor)?.password;
  if (!password || password.startsWith("(")) {
    throw new Error(`This script's ${vendor} vendor password isn't known in ${vendorCredsFile} for ${target} runs.`);
  }
  return password;
};
const TANGO_PASSWORD = vendorPassword("Tango Canteen");
const UDUPI_PASSWORD = vendorPassword("Udupi Canteen");

// Same reasoning as the vendor passwords above -- e2e.alice no longer has a
// fixed literal password; scripts/setup-test-users.mjs mints/persists it
// into this gitignored file now.
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const alicePassword = e2eCreds.find((r) => r.email === "e2e.alice@nhce.edu.in")?.password;
if (!alicePassword) {
  throw new Error(`No password known for e2e.alice@nhce.edu.in in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
}

const ALICE = { email: "e2e.alice@nhce.edu.in", password: alicePassword };
const UDUPI_VENDOR = { email: "udupi.canteen@nhce.edu.in", password: UDUPI_PASSWORD };
const TANGO_VENDOR = { email: "tango.canteen@nhce.edu.in", password: TANGO_PASSWORD };

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

  const gatewayOrderId = `live-check-order-ops-${orderId}`;
  const { error: payErr } = await admin
    .from("payments")
    .update({ gateway_order_id: gatewayOrderId })
    .eq("order_id", orderId)
    .eq("status", "created");
  if (payErr) throw new Error(`Could not stamp gateway_order_id: ${payErr.message}`);

  const { error: eventErr } = await admin.rpc("record_payment_event", {
    p_gateway_order_id: gatewayOrderId,
    p_gateway_payment_id: `live-check-payment-${orderId}`,
    p_status: "captured",
    p_signature_verified: true,
    p_raw_payload: { source: "live-check-vendor-order-ops.mjs" },
  });
  if (eventErr) throw new Error(`record_payment_event failed: ${eventErr.message}`);
}

async function main() {
  console.log(`=== Vendor order-ops depth (${target}) ===`);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const alice = await signIn(ALICE);
  const udupi = await signIn(UDUPI_VENDOR);
  const tango = await signIn(TANGO_VENDOR);

  const { data: udupiCanteen } = await udupi.sb.from("canteens").select("id, name").eq("owner_id", udupi.userId).single();
  const { data: tangoCanteen } = await tango.sb.from("canteens").select("id, name").eq("owner_id", tango.userId).single();
  if (!udupiCanteen || !tangoCanteen) throw new Error("Could not find both vendors' canteens");

  const ITEM_NAME = "Live Check Ops Item";
  await admin.from("food_items").delete().eq("canteen_id", udupiCanteen.id).eq("name", ITEM_NAME);
  const { data: item, error: itemErr } = await udupi.sb
    .from("food_items")
    .insert({ canteen_id: udupiCanteen.id, name: ITEM_NAME, price: 30, is_vegetarian: true, available: true, active: true })
    .select()
    .single();
  if (itemErr) throw new Error(`Could not create test item: ${itemErr.message}`);

  const orderIds = [];
  const placeAndCapture = async () => {
    const { data: order, error } = await alice.sb.rpc("create_food_order", {
      p_canteen_id: udupiCanteen.id,
      p_items: [{ food_item_id: item.id, quantity: 1 }],
      p_idempotency_key: `live-check-order-ops-${Date.now()}-${Math.random()}`,
    });
    if (error) throw new Error(`create_food_order failed: ${error.message}`);
    orderIds.push(order.id);
    await simulatePaymentCapture(alice.sb, admin, order.id);
    const { data: received } = await admin.from("orders").select("*").eq("id", order.id).single();
    return received;
  };

  // ---- staff roster ----
  await admin.from("canteen_staff").delete().eq("canteen_id", udupiCanteen.id).eq("name", "Live Check Ravi");
  const { data: staffRow, error: staffAddErr } = await udupi.sb
    .from("canteen_staff").insert({ canteen_id: udupiCanteen.id, name: "Live Check Ravi" }).select().single();
  check("Vendor can add a staff member to their own roster", !staffAddErr && staffRow?.name === "Live Check Ravi", staffAddErr);

  const { data: tangoStaffRead } = await tango.sb.from("canteen_staff").select("*").eq("canteen_id", udupiCanteen.id);
  check("A different vendor cannot read another canteen's staff roster (RLS)", (tangoStaffRead || []).length === 0, tangoStaffRead);

  const { error: tangoStaffWriteErr } = await tango.sb
    .from("canteen_staff").insert({ canteen_id: udupiCanteen.id, name: "Intruder" });
  check("A different vendor cannot write to another canteen's staff roster (RLS)", !!tangoStaffWriteErr, tangoStaffWriteErr);

  // ---- priority / internal note / staff assignment (ownership-checked RPC) ----
  const order1 = await placeAndCapture();

  const { error: tangoOpsErr } = await tango.sb.rpc("set_order_ops_fields", {
    p_order_id: order1.id, p_priority: "urgent", p_internal_note: "should not land", p_assigned_staff_name: "",
  });
  check("A different vendor cannot set ops fields on another canteen's order", !!tangoOpsErr, tangoOpsErr);

  const { data: opsResult, error: opsErr } = await udupi.sb.rpc("set_order_ops_fields", {
    p_order_id: order1.id, p_priority: "urgent", p_internal_note: "Ask for extra chutney", p_assigned_staff_name: "Live Check Ravi",
  });
  check("Owning vendor can set priority/note/assigned staff", !opsErr && opsResult?.priority === "urgent" && opsResult?.assigned_staff_name === "Live Check Ravi", opsErr || opsResult);

  const { error: badPriorityErr } = await udupi.sb.rpc("set_order_ops_fields", {
    p_order_id: order1.id, p_priority: "not-a-real-priority", p_internal_note: "", p_assigned_staff_name: "",
  });
  check("An invalid priority value is rejected server-side", !!badPriorityErr, badPriorityErr);

  // ---- CANCEL_REQUESTED -> confirm or resume (was a dead end before this pass) ----
  const order2 = await placeAndCapture();
  await udupi.sb.rpc("transition_order_status", { p_order_id: order2.id, p_to_status: "ACCEPTED" });
  const { error: cancelReqErr } = await udupi.sb.rpc("transition_order_status", { p_order_id: order2.id, p_to_status: "CANCEL_REQUESTED", p_reason: "test" });
  check("Vendor can move an accepted order to CANCEL_REQUESTED", !cancelReqErr, cancelReqErr);
  const { error: resumeErr } = await udupi.sb.rpc("transition_order_status", { p_order_id: order2.id, p_to_status: "PREPARING", p_reason: "resumed" });
  check("CANCEL_REQUESTED can resume back to PREPARING", !resumeErr, resumeErr);

  const order3 = await placeAndCapture();
  await udupi.sb.rpc("transition_order_status", { p_order_id: order3.id, p_to_status: "ACCEPTED" });
  await udupi.sb.rpc("transition_order_status", { p_order_id: order3.id, p_to_status: "CANCEL_REQUESTED", p_reason: "test" });
  const { error: confirmCancelErr } = await udupi.sb.rpc("transition_order_status", { p_order_id: order3.id, p_to_status: "CANCELLED", p_reason: "confirmed" });
  check("CANCEL_REQUESTED can be confirmed to CANCELLED", !confirmCancelErr, confirmCancelErr);

  // ---- refund initiation: ownership + valid-transition checks, then the real RPC path ----
  const order4 = await placeAndCapture(); // status RECEIVED, payment captured

  const { error: refundWrongStatusErr } = await udupi.sb.rpc("request_refund", { p_order_id: order4.id, p_amount: order4.total, p_reason: "too early" });
  check("request_refund rejects a RECEIVED order (not REJECTED/CANCELLED/PAID)", !!refundWrongStatusErr && /INVALID_TRANSITION/.test(refundWrongStatusErr.message), refundWrongStatusErr?.message);

  const { error: rejectErr } = await udupi.sb.rpc("transition_order_status", { p_order_id: order4.id, p_to_status: "REJECTED", p_reason: "kitchen closed" });
  check("Vendor can reject order4", !rejectErr, rejectErr);

  const { error: tangoRefundErr } = await tango.sb.rpc("request_refund", { p_order_id: order4.id, p_amount: order4.total, p_reason: "cross-canteen attempt" });
  check("A different vendor cannot request a refund for another canteen's order", !!tangoRefundErr, tangoRefundErr);

  const { data: refund, error: refundErr } = await udupi.sb.rpc("request_refund", { p_order_id: order4.id, p_amount: order4.total, p_reason: "kitchen closed" });
  check("Owning vendor can request a refund on a rejected, paid order", !refundErr && refund?.status === "pending", refundErr);

  const { data: orderAfterRefundReq } = await admin.from("orders").select("status, payment_status").eq("id", order4.id).single();
  check("Order flips to REFUND_PENDING", orderAfterRefundReq?.status === "REFUND_PENDING", orderAfterRefundReq);

  const { data: refundReadBack, error: refundReadErr } = await udupi.sb.from("refunds").select("*").eq("id", refund.id).maybeSingle();
  check("Owning vendor can read back their own canteen's refund row (refunds_read fix)", !refundReadErr && refundReadBack?.id === refund.id, refundReadErr);

  const { data: tangoRefundRead } = await tango.sb.from("refunds").select("*").eq("id", refund.id).maybeSingle();
  check("A different vendor cannot read another canteen's refund row", !tangoRefundRead, tangoRefundRead);

  // The Edge Function itself: on staging (no RAZORPAY_KEY_ID/SECRET set yet
  // per docs/ENVIRONMENTS.md) it must fail closed with GATEWAY_NOT_CONFIGURED,
  // not silently pretend to succeed. On production (keys are set) it should
  // actually complete the refund.
  const { data: fnResult, error: fnErr } = await udupi.sb.functions.invoke("razorpay-refund", { body: { refund_id: refund.id } });
  if (target === "staging") {
    check("razorpay-refund fails closed (GATEWAY_NOT_CONFIGURED) with no test keys set on staging", !!fnErr || fnResult?.code === "GATEWAY_NOT_CONFIGURED", fnErr || fnResult);
  } else {
    check("razorpay-refund completes the real gateway refund on production", !fnErr && fnResult?.ok === true, fnErr || fnResult);
    const { data: refundAfter } = await admin.from("refunds").select("*").eq("id", refund.id).single();
    check("Refund row reaches 'completed' with a real gateway_refund_id", refundAfter?.status === "completed" && !!refundAfter?.gateway_refund_id, refundAfter);
  }

  // A student (not the vendor) must never be able to call these directly.
  const { error: studentOpsErr } = await alice.sb.rpc("set_order_ops_fields", { p_order_id: order1.id, p_priority: "urgent", p_internal_note: "", p_assigned_staff_name: "" });
  check("A student cannot call set_order_ops_fields", !!studentOpsErr, studentOpsErr);

  // Cleanup.
  await admin.from("refunds").delete().eq("order_id", order4.id);
  await admin.from("order_status_history").delete().in("order_id", orderIds);
  await admin.from("order_items").delete().in("order_id", orderIds);
  await admin.from("payments").delete().in("order_id", orderIds);
  await admin.from("orders").delete().in("id", orderIds);
  await admin.from("food_items").delete().eq("id", item.id);
  await admin.from("canteen_staff").delete().eq("canteen_id", udupiCanteen.id).eq("name", "Live Check Ravi");
  console.log("(cleaned up test item, staff, orders, refund)");

  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
