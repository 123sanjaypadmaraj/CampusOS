// Live verification script for vendor menu stock/low-stock tracking (doc
// §17-19, supabase/migrations/20260815000800_food_stock_tracking.sql). Not
// a throwaway -- kept alongside the other scripts/live-check-*.mjs scripts
// for future re-runs. Environment-aware (see docs/ENVIRONMENTS.md):
// defaults to staging.
//
// Exercises the real order lifecycle end-to-end, not just the DB columns:
// creates a track_stock item with 2 in stock, places two real orders via
// create_food_order(), pushes each through record_payment_event() the same
// way the payments webhook does (service_role only, so this is the only
// way to test it without a real Razorpay capture), and checks stock
// decrements, auto-hide-at-zero, and restock-on-reject all actually fire.
//
// Usage: node scripts/live-check-food-stock.mjs
//        node scripts/live-check-food-stock.mjs --env=production --yes-production

import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, target } = resolveTarget();

const VENDOR_PASSWORD = target === "staging" ? "StagingTest@2026!" : undefined;
if (!VENDOR_PASSWORD) {
  throw new Error("This script's Udupi vendor password is only known for staging -- pass it in for production runs.");
}

const ALICE = { email: "e2e.alice@nhce.edu.in", password: "TestPass!2026Alice" };
const UDUPI_VENDOR = { email: "udupi.canteen@nhce.edu.in", password: VENDOR_PASSWORD };

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

// Mirrors the real flow: create_payment_order() (student, creates the
// 'created' payments row) -> create-razorpay-order edge function stamping
// gateway_order_id (simulated here directly, since this isn't hitting real
// Razorpay) -> record_payment_event() as service_role, same as the
// payments webhook calls after a verified capture. This is the only path
// that decrements stock.
async function simulatePaymentCapture(studentSb, admin, orderId) {
  const { error: createPaymentErr } = await studentSb.rpc("create_payment_order", { p_order_id: orderId });
  if (createPaymentErr) throw new Error(`create_payment_order failed: ${createPaymentErr.message}`);

  const gatewayOrderId = `live-check-food-stock-${orderId}`;
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
    p_raw_payload: { source: "live-check-food-stock.mjs" },
  });
  if (eventErr) throw new Error(`record_payment_event failed: ${eventErr.message}`);
}

async function main() {
  console.log(`=== Food stock/low-stock tracking (${target}) ===`);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const alice = await signIn(ALICE);
  const udupi = await signIn(UDUPI_VENDOR);

  const { data: canteen, error: canteenErr } = await udupi.sb.from("canteens").select("id").eq("owner_id", udupi.userId).single();
  if (canteenErr || !canteen) throw new Error(`Could not find Udupi's canteen: ${canteenErr?.message}`);

  // Clean up any stale item from a previous failed run, then create a fresh one.
  const ITEM_NAME = "Live Check Stock Item";
  await admin.from("food_items").delete().eq("canteen_id", canteen.id).eq("name", ITEM_NAME);

  const { data: item, error: itemErr } = await udupi.sb
    .from("food_items")
    .insert({
      canteen_id: canteen.id, name: ITEM_NAME, price: 10, is_vegetarian: true,
      available: true, active: true, track_stock: true, stock_quantity: 2, low_stock_threshold: 5,
    })
    .select()
    .single();
  check("Vendor can create an item with track_stock + stock_quantity set", !itemErr && item?.stock_quantity === 2, itemErr);

  const orderIds = [];
  const placeOrder = async () => {
    const { data: order, error } = await alice.sb.rpc("create_food_order", {
      p_canteen_id: canteen.id,
      p_items: [{ food_item_id: item.id, quantity: 1 }],
      p_notes: "live-check-food-stock",
      p_idempotency_key: `live-check-food-stock-${Date.now()}-${Math.random()}`,
    });
    if (error) throw new Error(`create_food_order failed: ${error.message}`);
    orderIds.push(order.id);
    return order;
  };

  const readItem = async () => {
    const { data } = await admin.from("food_items").select("*").eq("id", item.id).single();
    return data;
  };

  // Order 1: stock 2 -> 1, item stays available and above threshold.
  const order1 = await placeOrder();
  await simulatePaymentCapture(alice.sb, admin, order1.id);
  let current = await readItem();
  check("First paid order decrements stock 2 -> 1", current.stock_quantity === 1, current.stock_quantity);
  check("Item still available with stock remaining", current.available === true, current.available);

  // Order 2: stock 1 -> 0, item auto-hidden.
  const order2 = await placeOrder();
  await simulatePaymentCapture(alice.sb, admin, order2.id);
  current = await readItem();
  check("Second paid order decrements stock 1 -> 0", current.stock_quantity === 0, current.stock_quantity);
  check("Item auto-flips to unavailable at 0 stock", current.available === false, current.available);

  // Vendor rejects order 2 (RECEIVED -> REJECTED is a valid transition) --
  // stock should be restored, but availability stays as the vendor left it.
  const { error: rejectErr } = await udupi.sb.rpc("transition_order_status", {
    p_order_id: order2.id,
    p_to_status: "REJECTED",
    p_reason: "live-check-food-stock cleanup",
  });
  check("Vendor can reject the now-out-of-stock order", !rejectErr, rejectErr);
  current = await readItem();
  check("Rejecting a paid order restores stock 0 -> 1", current.stock_quantity === 1, current.stock_quantity);
  check("Restocking does NOT auto-flip availability back on", current.available === false, current.available);

  // A student trying to order an item that's out of stock server-side
  // (available=false) is still correctly rejected by create_food_order's
  // own pre-existing check -- confirms the two mechanisms compose.
  await udupi.sb.from("food_items").update({ stock_quantity: 0, available: false }).eq("id", item.id);
  const { error: outOfStockOrderErr } = await alice.sb.rpc("create_food_order", {
    p_canteen_id: canteen.id,
    p_items: [{ food_item_id: item.id, quantity: 1 }],
    p_idempotency_key: `live-check-food-stock-oos-${Date.now()}`,
  });
  check("Ordering an unavailable (out-of-stock) item is rejected", !!outOfStockOrderErr && /UNAVAILABLE/.test(outOfStockOrderErr.message), outOfStockOrderErr?.message);

  // Direct calls to the internal helper must be blocked from the browser.
  const { error: directCallErr } = await alice.sb.rpc("adjust_stock_for_order", { p_order_id: order1.id, p_direction: 1 });
  check("adjust_stock_for_order is not callable directly by an authenticated user", !!directCallErr, directCallErr?.message);

  // Cleanup.
  await admin.from("order_status_history").delete().in("order_id", orderIds);
  await admin.from("order_items").delete().in("order_id", orderIds);
  await admin.from("payments").delete().in("order_id", orderIds);
  await admin.from("orders").delete().in("id", orderIds);
  await admin.from("food_items").delete().eq("id", item.id);
  console.log("(cleaned up test item + orders)");

  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
