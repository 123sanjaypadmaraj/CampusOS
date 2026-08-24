// One-off live verification script (not part of the automated suite) --
// exercises the Campus Store commerce backend directly against the
// production Supabase project using real signed-in sessions, same idea as
// scripts/live-check-new-features.mjs. Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-campus-store.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, root, target } = resolveTarget();
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const e2ePassword = (email) => {
  const password = e2eCreds.find((r) => r.email === email)?.password;
  if (!password) throw new Error(`No password known for ${email} in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
  return password;
};

// Bug fix: this used to hardcode the PRODUCTION credential filenames
// regardless of target, so a default (staging) run signed in with prod
// passwords against the staging project and failed with "Invalid login
// credentials" -- match the target-aware pattern every other live-check
// script here already uses.
const storeCredsFile = target === "production" ? ".store-credentials.local.json" : ".store-credentials.staging.local.json";
const vendorCredsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";
const storeCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", storeCredsFile), "utf8"));
const vendorCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", vendorCredsFile), "utf8"));
const udupi = vendorCreds.find((v) => v.vendor === "Udupi Canteen");

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

async function main() {
  console.log("=== Campus Store ===");
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const storeVendor = await signIn(storeCreds.email, storeCreds.password);
  const udupiVendor = await signIn(udupi.email, udupi.password);

  const { data: stores, error: storesErr } = await alice.sb.from("stores").select("*").eq("name", "Campus Store").limit(1);
  check("Anyone can read the store catalog", !storesErr && stores?.length === 1, storesErr);
  const store = stores[0];

  const { data: items, error: itemsErr } = await alice.sb.from("store_items").select("*").eq("store_id", store.id);
  check("Anyone can read store items", !itemsErr && items?.length >= 6, { itemsErr, count: items?.length });
  const pen = items.find((i) => i.name === "Black Gel Pen");
  const record = items.find((i) => i.name === "Engineering Record");

  const idempotencyKey = `live-check-${Date.now()}`;
  const { data: order1, error: orderErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: pen.id, quantity: 3 }],
    p_idempotency_key: idempotencyKey,
  });
  check("create_store_order succeeds", !orderErr && order1?.status === "PLACED", orderErr);
  // Total is subtotal + tax (20260824000600_campus_store_gst_invoices_
  // settlement.sql added tax_rate to store_items, default 0.05) -- computed
  // off the item's own tax_rate rather than a hardcoded rate so this stays
  // correct whatever the pen's actual rate is.
  const penSubtotal = Number(pen.price) * 3;
  const penExpectedTotal = Math.round((penSubtotal + penSubtotal * Number(pen.tax_rate)) * 100) / 100;
  check("Order total is computed server-side (3 pens, incl. tax)", Number(order1?.total) === penExpectedTotal, { order1, penExpectedTotal });
  check("Order gets a real pickup code", /^\d{6}$/.test(order1?.pickup_code || ""), order1?.pickup_code);

  const { data: order1Again, error: order1AgainErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: pen.id, quantity: 3 }],
    p_idempotency_key: idempotencyKey,
  });
  check("Re-submitting the same idempotency key returns the same order, not a duplicate", !order1AgainErr && order1Again?.id === order1?.id, { order1AgainErr, order1Again });

  const { error: mixedStoreErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: pen.id, quantity: 1 }, { store_item_id: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
  });
  check("Ordering a nonexistent item is rejected, not silently accepted", !!mixedStoreErr, mixedStoreErr?.message);

  const { error: unavailErr } = await storeVendor.sb.from("store_items").update({ available: false }).eq("id", record.id);
  check("Store owner can mark an item unavailable", !unavailErr, unavailErr);
  const { error: buyUnavailErr } = await alice.sb.rpc("create_store_order", {
    p_store_id: store.id,
    p_items: [{ store_item_id: record.id, quantity: 1 }],
  });
  check("Ordering an unavailable item is rejected", !!buyUnavailErr && /unavailable/i.test(buyUnavailErr.message), buyUnavailErr?.message);
  await storeVendor.sb.from("store_items").update({ available: true }).eq("id", record.id);

  console.log("\n=== Ownership RLS ===");
  const { error: intruderErr } = await udupiVendor.sb.from("store_items").update({ price: 1 }).eq("id", pen.id);
  const { data: unchanged } = await alice.sb.from("store_items").select("price").eq("id", pen.id).single();
  check("A different vendor cannot write to this store's items (RLS)", Number(unchanged?.price) === Number(pen.price), { intruderErr, unchanged });

  const { error: intruderTransitionErr } = await udupiVendor.sb.rpc("transition_store_order_status", {
    p_order_id: order1.id,
    p_to_status: "PACKED",
  });
  check("A different vendor cannot transition this store's orders", !!intruderTransitionErr, intruderTransitionErr?.message);

  console.log("\n=== Vendor order queue (real owner) ===");
  const { data: packed, error: packErr } = await storeVendor.sb.rpc("transition_store_order_status", {
    p_order_id: order1.id,
    p_to_status: "PACKED",
  });
  check("Store owner can advance PLACED -> PACKED", !packErr && packed?.status === "PACKED", packErr);

  const { error: skipErr } = await storeVendor.sb.rpc("transition_store_order_status", {
    p_order_id: order1.id,
    p_to_status: "COMPLETED",
  });
  check("Skipping straight to COMPLETED is rejected by the state machine", !!skipErr, skipErr?.message);

  const { data: ready } = await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: order1.id, p_to_status: "READY" });
  check("Store owner can advance PACKED -> READY", ready?.status === "READY", ready);

  const { data: completed, error: completeErr } = await storeVendor.sb.rpc("transition_store_order_status", { p_order_id: order1.id, p_to_status: "COMPLETED" });
  check("Store owner can complete the order", !completeErr && completed?.status === "COMPLETED", completeErr);

  const { data: notif } = await alice.sb.from("notifications").select("*").eq("action_id", order1.id).eq("action_type", "store_order").order("created_at", { ascending: false }).limit(1);
  check("The buyer got a real status-change notification", notif?.length > 0, notif);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
