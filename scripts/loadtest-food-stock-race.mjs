// Phase 7 (Reliability at scale) -- live race-condition test for the
// food-order stock reservation fix (supabase/migrations/20260824000200_
// fix_food_stock_reservation_race.sql). Creates a throwaway food item with
// stock_quantity=1 on a real staging canteen, fires several concurrent
// create_food_order calls at it from real student sessions, and asserts
// exactly one succeeds and the item's stock lands at exactly 0 (not
// negative). Cleans up everything it creates, on success or failure.
//
// Defaults to staging; refuses production without --env=production
// --yes-production (see scripts/env-target.mjs). Uses the service_role key
// only for fixture setup/teardown -- the actual race is exercised through
// the same RPC path a real client uses, as real authenticated users.
//
// Usage: node scripts/loadtest-food-stock-race.mjs [--concurrency=8]

import fs from "node:fs";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, target, sessionsFile } = resolveTarget();

const args = process.argv.slice(2);
const CONCURRENCY = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] || 8);

const svc = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function svcFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { ...svc, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function refreshSession(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`Refresh failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function main() {
  console.log(`[race-test] target: ${target}, concurrency: ${CONCURRENCY}`);

  // 1. Gather student sessions to fire concurrent orders from.
  const sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
  const studentEmails = Object.keys(sessions).filter((e) => e.startsWith("e2e."));
  if (studentEmails.length === 0) throw new Error("No e2e.* student sessions found in " + sessionsFile);

  const tokens = [];
  for (const email of studentEmails) {
    const refreshToken = sessions[email]?.session?.refresh_token;
    if (!refreshToken) continue;
    tokens.push(await refreshSession(refreshToken));
    console.log(`[race-test] refreshed session for ${email}`);
  }
  if (tokens.length === 0) throw new Error("No refreshable student sessions found");
  // Cycle through however many real accounts exist to reach the requested
  // concurrency -- the resource contention is what's under test, not
  // identity uniqueness (check_rate_limit allows 20 orders/hour/user, far
  // more than this test fires per account).
  while (tokens.length < CONCURRENCY) tokens.push(tokens[tokens.length % studentEmails.length]);

  // 2. Fixture: a real canteen, a throwaway food item with stock_quantity=1.
  const [canteen] = await svcFetch(`/rest/v1/canteens?select=id,name&limit=1`);
  if (!canteen) throw new Error("No canteens found on staging -- can't set up fixture");
  console.log(`[race-test] using canteen ${canteen.name} (${canteen.id})`);

  const [item] = await svcFetch(`/rest/v1/food_items`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      canteen_id: canteen.id,
      name: `LOADTEST race item ${Date.now()}`,
      price: 1,
      tax_rate: 0,
      active: true,
      available: true,
      track_stock: true,
      stock_quantity: 1,
    }),
  });
  console.log(`[race-test] created fixture food item ${item.id} with stock_quantity=1`);

  let orderIds = [];
  try {
    // 3. Fire concurrent create_food_order calls, all for qty 1 of the same item.
    const calls = tokens.slice(0, CONCURRENCY).map((token) =>
      fetch(`${SUPABASE_URL}/rest/v1/rpc/create_food_order`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_canteen_id: canteen.id,
          p_items: [{ food_item_id: item.id, quantity: 1 }],
          p_fulfillment_type: "pickup",
        }),
      }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }))
    );
    const results = await Promise.all(calls);

    const successes = results.filter((r) => r.status >= 200 && r.status < 300 && r.body?.id);
    // The winner's reservation (adjust_stock_for_order) also flips
    // available=false once stock hits 0, so losers can fail either on the
    // explicit stock-count check or the earlier availability check --
    // both are the correct "someone else got it first" outcome.
    const stockErrors = results.filter(
      (r) =>
        typeof r.body?.message === "string" &&
        (r.body.message.includes("ORDER_ITEM_UNAVAILABLE: not enough stock") || r.body.message.includes("is currently unavailable"))
    );
    const other = results.filter((r) => !successes.includes(r) && !stockErrors.includes(r));

    orderIds = successes.map((r) => r.body.id);

    console.log(`\n[race-test] ${CONCURRENCY} concurrent orders fired at 1 unit of stock:`);
    console.log(`  successes:    ${successes.length}`);
    console.log(`  stock-denied: ${stockErrors.length}`);
    console.log(`  other/errors: ${other.length}${other.length ? "  " + JSON.stringify(other.map((r) => r.body)) : ""}`);

    const [finalItem] = await svcFetch(`/rest/v1/food_items?id=eq.${item.id}&select=stock_quantity`);
    console.log(`  final stock_quantity: ${finalItem.stock_quantity}`);

    const pass = successes.length === 1 && stockErrors.length === CONCURRENCY - 1 && finalItem.stock_quantity === 0;
    console.log(`\n[race-test] ${pass ? "PASS" : "FAIL"} -- exactly-one-winner + stock lands at 0` + (pass ? "" : " NOT observed"));
    if (!pass) process.exitCode = 1;
  } finally {
    // 4. Clean up everything this test created, regardless of outcome.
    for (const orderId of orderIds) {
      await svcFetch(`/rest/v1/order_status_history?order_id=eq.${orderId}`, { method: "DELETE" }).catch(() => {});
      await svcFetch(`/rest/v1/order_items?order_id=eq.${orderId}`, { method: "DELETE" }).catch(() => {});
      await svcFetch(`/rest/v1/orders?id=eq.${orderId}`, { method: "DELETE" }).catch(() => {});
    }
    await svcFetch(`/rest/v1/stock_adjustments?food_item_id=eq.${item.id}`, { method: "DELETE" }).catch(() => {});
    await svcFetch(`/rest/v1/food_items?id=eq.${item.id}`, { method: "DELETE" }).catch(() => {});
    console.log(`[race-test] cleaned up fixture item + ${orderIds.length} test order(s)`);
  }
}

main().catch((err) => {
  console.error("[race-test] fatal:", err);
  process.exit(1);
});
