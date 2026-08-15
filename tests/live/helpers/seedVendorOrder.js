// tests/live/helpers/seedVendorOrder.js
//
// Seeds a fresh, uniquely-identifiable order against Udupi's real menu for
// the vendor-order-queue live spec, and clears out any leftover orders from
// prior runs first.
//
// Why this exists: the spec used to assume a "Rava Idli" / "Live
// vendor-queue test order" order already existed in the DB (created once,
// by hand, outside the repo) and picked it up via
// `.locator('.resource-row', { hasText: 'Rava Idli' }).first()`. Every run
// walks that order to READY and leaves it there (there's no headless way to
// read the real pickup code and complete it), so re-running the suite left
// another stale row behind each time. Once more than one such row existed,
// `.first()` could resolve to an old COMPLETED order instead of a fresh
// RECEIVED one, failing the `toContainText('RECEIVED')` assertion -- not a
// product bug, a test-isolation bug.
//
// The fix: each run (a) deletes every previous test order matching the
// marker notes, then (b) creates exactly one new order as Alice via the
// real create_food_order() RPC, then (c) forwards it straight to RECEIVED
// using the service_role connection the same way
// record_payment_event() would after a verified Razorpay capture (driving
// an actual gateway payment headlessly isn't feasible -- see the spec's own
// header comment). That leaves exactly one matching order in the DB by the
// time the browser-based assertions run.
//
// Which Udupi item gets ordered is resolved dynamically (any active item on
// Udupi's menu), not hardcoded to "Rava Idli" -- staging's seed data is a
// different set of dishes than production's (see docs/ENVIRONMENTS.md), so
// a hardcoded dish name would only ever work on one of the two projects.
// The chosen item's real name is returned so the spec can assert against it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { resolveServiceRoleKey } from "./resolveServiceRoleKey.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "..");

function readEnvVar(name) {
  return fs
    .readFileSync(path.join(root, ".env"), "utf8")
    .match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]
    ?.trim();
}

const SUPABASE_URL = readEnvVar("VITE_SUPABASE_URL");
const ANON_KEY = readEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY");
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);

// Same "which project is .env actually pointed at" resolution
// tests/live/helpers/realSession.js uses -- this helper used to hardcode
// scripts/.sessions.json (production-only), which silently broke on
// staging (missing/stale session) instead of using the sessions file that
// actually matches the currently-linked project.
const PROD_PROJECT_REF = "dzjzjlylsfpmymkcavrq";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const sessionsFileName = PROJECT_REF === PROD_PROJECT_REF ? ".sessions.json" : ".sessions.staging.json";
const SESSIONS = JSON.parse(fs.readFileSync(path.join(root, "scripts", sessionsFileName), "utf8"));

export const TEST_ORDER_NOTES = "Live vendor-queue test order";
export const TEST_ORDER_ITEM_NOTES = "Extra chutney please";

// Deletes every order (and its items/history) matching the marker notes --
// run before seeding a fresh one so old runs never leave a stale row behind.
async function clearStaleTestOrders(admin) {
  const { data: stale, error } = await admin.from("orders").select("id").eq("notes", TEST_ORDER_NOTES);
  if (error) throw new Error(`Failed to look up stale test orders: ${error.message}`);
  const ids = (stale || []).map((o) => o.id);
  if (!ids.length) return;

  await admin.from("order_status_history").delete().in("order_id", ids);
  await admin.from("order_items").delete().in("order_id", ids);
  const { error: delErr } = await admin.from("orders").delete().in("id", ids);
  if (delErr) throw new Error(`Failed to delete stale test orders: ${delErr.message}`);
}

// Creates one fresh order (against whatever Udupi actually has on its menu)
// as Alice, then forwards it to RECEIVED the same way a verified Razorpay
// capture would via record_payment_event(). Returns { orderId, itemName }.
export async function seedFreshVendorTestOrder() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await clearStaleTestOrders(admin);

  const { data: udupi, error: canteenErr } = await admin
    .from("canteens")
    .select("id")
    .ilike("name", "%udupi%")
    .limit(1)
    .single();
  if (canteenErr || !udupi) {
    throw new Error(`Could not find the Udupi canteen to seed the order against: ${canteenErr?.message}`);
  }

  const { data: foodItem, error: foodErr } = await admin
    .from("food_items")
    .select("id, name, canteen_id")
    .eq("canteen_id", udupi.id)
    .eq("active", true)
    .eq("available", true)
    .limit(1)
    .single();
  if (foodErr || !foodItem) {
    throw new Error(`Could not find an available Udupi food item to seed the order against: ${foodErr?.message}`);
  }

  const aliceEntry = SESSIONS["e2e.alice@nhce.edu.in"];
  if (!aliceEntry) throw new Error("No cached session for e2e.alice@nhce.edu.in -- run scripts/setup-test-users.mjs first");

  const asAlice = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: sessionErr } = await asAlice.auth.setSession({
    access_token: aliceEntry.session.access_token,
    refresh_token: aliceEntry.session.refresh_token,
  });
  if (sessionErr) throw new Error(`Failed to restore Alice's session: ${sessionErr.message}`);

  const { data: order, error: orderErr } = await asAlice.rpc("create_food_order", {
    p_canteen_id: foodItem.canteen_id,
    p_items: [{ food_item_id: foodItem.id, quantity: 1, special_instructions: TEST_ORDER_ITEM_NOTES }],
    p_notes: TEST_ORDER_NOTES,
    p_fulfillment_type: "pickup",
    p_idempotency_key: `vendor-queue-live-test-${Date.now()}`,
  });
  if (orderErr || !order) {
    throw new Error(`Failed to seed vendor-queue test order: ${orderErr?.message}`);
  }

  // Mirror record_payment_event()'s PAYMENT_PENDING -> PAID -> RECEIVED
  // forwarding (that RPC is service_role-only and normally only reachable
  // from the payments webhook after a verified gateway capture).
  const { error: paidErr } = await admin
    .from("orders")
    .update({ status: "PAID", payment_status: "paid" })
    .eq("id", order.id);
  if (paidErr) throw new Error(`Failed to mark seeded order PAID: ${paidErr.message}`);
  await admin.from("order_status_history").insert({
    order_id: order.id,
    from_status: "PAYMENT_PENDING",
    to_status: "PAID",
    reason: "test seed: simulated gateway webhook",
  });

  const { error: receivedErr } = await admin.from("orders").update({ status: "RECEIVED" }).eq("id", order.id);
  if (receivedErr) throw new Error(`Failed to mark seeded order RECEIVED: ${receivedErr.message}`);
  await admin.from("order_status_history").insert({
    order_id: order.id,
    from_status: "PAID",
    to_status: "RECEIVED",
    reason: "test seed: auto-forwarded to vendor queue",
  });

  return { orderId: order.id, itemName: foodItem.name };
}
