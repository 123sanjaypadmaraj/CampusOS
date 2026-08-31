// Concurrent-payment load test for paid events checkout (supabase/
// migrations/20260831000800_paid_events.sql +
// 20260831001100_restore_payment_amount_integrity_check.sql). Flagged as
// "not built" by campusos-loadtest-100-reverify-31aug: the 110-account
// concurrent scenario's shared test event is always free, so it has never
// exercised Razorpay order-creation/capture/refund under real contention --
// the exact race class scripts/loadtest-food-stock-race.mjs already catches
// for food orders. This is that test's sibling for the payments path.
//
// scripts/live-check-paid-events.mjs already proves the *sequential*
// contract (register -> pay -> capture -> cancel/refund, one step at a
// time). What it can't catch is a lock that looks correct on paper but
// doesn't actually serialize under real simultaneous requests -- e.g.
// event_tickets has no unique constraint on registration_id (only a plain
// index, see 20260831000900_index_audit_followup.sql), so a broken lock
// would silently mint duplicate tickets under concurrency without a single
// sequential call ever revealing it. This script fires genuine concurrent
// requests (Promise.all over raw fetch, real authenticated sessions --
// never one client instance serialized by supabase-js) at each of the
// three contended paths:
//
//   Phase A -- capacity race: N students hit register_for_event on the same
//              capacity-1 paid event at once. Exactly 1 should land
//              payment_status=pending (seat reserved); the rest waitlisted.
//   Phase B -- order-creation race: the winner opens create_event_payment_order
//              from N "tabs" at once. Exactly one 'created' payments row
//              should exist for the registration; every call returns it.
//   Phase C -- capture race: simulates a duplicate webhook delivery (Razorpay
//              retries on anything but a 2xx, and payment-reconciliation can
//              independently observe the same captured payment) -- N
//              concurrent record_payment_event('captured') calls for the
//              SAME gateway_order_id. Exactly one event_tickets row and one
//              "Payment confirmed" notification should result, not N.
//   Phase D -- refund race: a second registrant's paid registration gets
//              N concurrent cancel_event_registration calls (a double-tap
//              on Cancel). Exactly one should succeed with a refund_id; the
//              rest must fail cleanly (no active registration left to
//              cancel), and exactly one refunds row should exist.
//
// record_payment_event is only ever reachable via the service_role key (it's
// revoked from authenticated/anon -- only razorpay-webhook and
// payment-reconciliation call it), so Phase C is exercised the same
// no-real-Razorpay-account-needed way live-check-payment-and-store-billing.mjs
// already does: a crafted captured payload sent directly to the RPC.
//
// This IS a payment-simulation script (it fabricates captured-payment rows
// via record_payment_event, same category as live-check-payment-and-store-
// billing.mjs / live-check-paid-events.mjs) -- docs/DEPLOYMENT.md's "payments/
// refunds should never be tested against production" applies, and per
// campusos-payment-hardening-pass's own recorded lesson ("do not rely on
// --yes-production friction or any permission classifier to catch it for
// you"), this script refuses production OUTRIGHT, with no override flag at
// all, rather than trusting env-target.mjs's normal --yes-production gate.
//
// Creates its own small throwaway account pool (timestamp-namespaced, never
// touches the shared e2e.alice/bob/carol or e2e.load### pools) and a
// throwaway campus event; cleans up everything it created, on success or
// failure.
//
// Usage: node scripts/loadtest-event-payment-race.mjs [--concurrency=6]

import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, target } = resolveTarget();

if (target === "production") {
  console.error(
    "[event-payment-race] refusing to run against PRODUCTION. This script fabricates " +
    "captured Razorpay payments/refunds directly via record_payment_event -- exactly the " +
    "category docs/DEPLOYMENT.md's \"payments/refunds should never be tested against " +
    "production\" warns about. There is no override flag for this script; run it against " +
    "staging (the default, no --env needed)."
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const CONCURRENCY = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] || 6);
const stamp = Date.now();

const svc = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function svcFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { ...svc, ...(opts.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function rpcAs(token, name, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function passwordSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

let overallPass = true;
function report(label, cond, extra) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? " -- " + JSON.stringify(extra) : ""}`);
  if (!cond) overallPass = false;
}

async function main() {
  console.log(`[event-payment-race] target: ${target}, concurrency: ${CONCURRENCY}`);

  // 1. Throwaway account pool -- created fresh each run, deleted at the end.
  const emails = Array.from({ length: CONCURRENCY }, (_, i) => `e2e.payrace${stamp}.${i + 1}@nhce.edu.in`);
  const password = `Rk_race_${stamp}!9`;
  console.log(`[event-payment-race] creating ${CONCURRENCY} throwaway accounts...`);
  const accounts = [];
  for (const email of emails) {
    const created = await svcFetch(`/auth/v1/admin/users`, {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: `PayRace ${email}` } }),
    });
    accounts.push({ email, userId: created.id });
  }
  for (const acc of accounts) {
    const signedIn = await passwordSignIn(acc.email, password);
    acc.token = signedIn.token;
  }
  console.log(`[event-payment-race] ${accounts.length} accounts ready and signed in.`);

  // 2. Fixtures: two paid events on a real campus -- one capacity-1 event
  // for the registration/order-creation/capture races (A-C), one
  // capacity>=1 event dedicated to the refund race (D) so it doesn't
  // contend with event 1's own state.
  const [anyProfile] = await svcFetch(`/rest/v1/profiles?select=campus_id&campus_id=not.is.null&limit=1`);
  if (!anyProfile) throw new Error("No profile with a campus_id found on staging -- can't set up fixture");
  const campusId = anyProfile.campus_id;

  const [eventA] = await svcFetch(`/rest/v1/events`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      campus_id: campusId, title: `LOADTEST payment-race capacity-1 ${stamp}`, category: "Workshop",
      event_date: new Date(Date.now() + 7 * 86400_000).toISOString(), place: "Load Test Hall",
      price: 250, capacity: 1,
    }),
  });
  const [eventD] = await svcFetch(`/rest/v1/events`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      campus_id: campusId, title: `LOADTEST payment-race refund ${stamp}`, category: "Workshop",
      event_date: new Date(Date.now() + 7 * 86400_000).toISOString(), place: "Load Test Hall",
      price: 300, capacity: 5,
    }),
  });
  console.log(`[event-payment-race] fixtures: event A ${eventA.id} (capacity 1, ₹250), event D ${eventD.id} (₹300)`);

  const createdRegistrationIds = [];

  try {
    // =========================================================
    // Phase A -- capacity race: all N accounts register for eventA at once.
    // =========================================================
    console.log(`\n[Phase A] ${accounts.length} concurrent register_for_event calls at 1 seat...`);
    const regResults = await Promise.all(
      accounts.map((acc) =>
        rpcAs(acc.token, "register_for_event", {
          p_event_id: eventA.id, p_contact_phone: "9876543210", p_contact_name: acc.email,
        }).then((r) => ({ acc, ...r }))
      )
    );
    const pendingWinners = regResults.filter((r) => r.body?.status === "payment_pending");
    const waitlisted = regResults.filter((r) => r.body?.status === "waitlisted");
    const otherA = regResults.filter((r) => r !== pendingWinners.find((x) => x === r) && r.body?.status !== "payment_pending" && r.body?.status !== "waitlisted");

    report("exactly one registration reserved the seat (payment_pending)", pendingWinners.length === 1, regResults.map((r) => r.body));
    report(`the other ${accounts.length - 1} were waitlisted, none oversold`, waitlisted.length === accounts.length - 1, regResults.map((r) => r.body));
    report("no unexpected errors/statuses", otherA.length === 0, otherA.map((r) => r.body));

    const winner = pendingWinners[0]?.acc;
    const winnerRegId = pendingWinners[0]?.body?.registration_id;
    if (!winner || !winnerRegId) throw new Error("Phase A produced no winner registration -- can't continue to Phase B/C");
    createdRegistrationIds.push(winnerRegId);

    const [eventAAfter] = await svcFetch(`/rest/v1/events?id=eq.${eventA.id}&select=registration_status`);
    report("event A's registration_status reflects the full seat (WAITLIST or FULL)", ["WAITLIST", "FULL"].includes(eventAAfter?.registration_status), eventAAfter);

    // =========================================================
    // Phase B -- order-creation race: the winner opens N concurrent
    // create_event_payment_order calls for the same registration (double-
    // tab checkout).
    // =========================================================
    console.log(`\n[Phase B] ${accounts.length} concurrent create_event_payment_order calls for the same registration...`);
    const payResults = await Promise.all(
      Array.from({ length: accounts.length }, () => rpcAs(winner.token, "create_event_payment_order", { p_registration_id: winnerRegId }))
    );
    const paySuccesses = payResults.filter((r) => r.status >= 200 && r.status < 300 && r.body?.id);
    report("every concurrent call succeeded", paySuccesses.length === payResults.length, payResults.map((r) => r.body));
    const distinctPaymentIds = new Set(paySuccesses.map((r) => r.body.id));
    report("all calls returned the SAME payment row (idempotent, not a fresh one per call)", distinctPaymentIds.size === 1, [...distinctPaymentIds]);

    const paymentsForReg = await svcFetch(`/rest/v1/payments?event_registration_id=eq.${winnerRegId}&select=id,status,amount`);
    report("exactly one payments row exists for the registration despite the concurrent calls", paymentsForReg.length === 1, paymentsForReg);
    const payment = paymentsForReg[0];

    // =========================================================
    // Phase C -- capture race: simulate a duplicate webhook delivery --
    // N concurrent record_payment_event('captured') calls for the SAME
    // gateway_order_id, correct amount, same payment_id (a true retry of
    // the identical Razorpay event, the realistic duplicate-delivery case).
    // =========================================================
    console.log(`\n[Phase C] ${accounts.length} concurrent record_payment_event('captured') calls for the same gateway_order_id...`);
    const gatewayOrderId = `order_loadtest_${stamp}`;
    await svcFetch(`/rest/v1/payments?id=eq.${payment.id}`, {
      method: "PATCH",
      body: JSON.stringify({ gateway_order_id: gatewayOrderId }),
    });
    const correctPaise = Math.round(Number(payment.amount) * 100);
    const capturePayload = {
      p_gateway_order_id: gatewayOrderId,
      p_gateway_payment_id: `pay_loadtest_${stamp}`,
      p_status: "captured",
      p_signature_verified: true,
      p_raw_payload: { event: "payment.captured", payload: { payment: { entity: { id: `pay_loadtest_${stamp}`, order_id: gatewayOrderId, amount: correctPaise } } } },
    };
    const captureResults = await Promise.all(
      Array.from({ length: accounts.length }, () =>
        fetch(`${SUPABASE_URL}/rest/v1/rpc/record_payment_event`, { method: "POST", headers: svc, body: JSON.stringify(capturePayload) })
          .then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }))
      )
    );
    const captureFailures = captureResults.filter((r) => r.status < 200 || r.status >= 300);
    report("every concurrent capture call completed without erroring", captureFailures.length === 0, captureFailures.map((r) => r.body));

    const [regAfterCapture] = await svcFetch(`/rest/v1/event_registrations?id=eq.${winnerRegId}&select=payment_status`);
    report("registration ends up paid exactly (not left pending/failed by a lost race)", regAfterCapture?.payment_status === "paid", regAfterCapture);

    const ticketsForReg = await svcFetch(`/rest/v1/event_tickets?registration_id=eq.${winnerRegId}&select=id`);
    report("exactly ONE ticket was minted despite N concurrent captures (no duplicate-ticket race)", ticketsForReg.length === 1, ticketsForReg);

    const confirmNotifs = await svcFetch(
      `/rest/v1/notifications?user_id=eq.${winner.userId}&action_id=eq.${eventA.id}&title=ilike.*Payment+confirmed*&select=id`
    );
    report("exactly ONE 'Payment confirmed' notification was sent, not one per duplicate delivery", confirmNotifs.length === 1, confirmNotifs);

    // =========================================================
    // Phase D -- refund race: a fresh registrant pays for eventD, then N
    // concurrent cancel_event_registration calls (double-tap Cancel) race
    // to refund the same captured payment.
    // =========================================================
    console.log(`\n[Phase D] setting up a paid+captured registration on event D, then racing ${accounts.length} concurrent cancels...`);
    const refundAcc = accounts[1] || accounts[0];
    const dReg = await rpcAs(refundAcc.token, "register_for_event", {
      p_event_id: eventD.id, p_contact_phone: "9876543211", p_contact_name: refundAcc.email,
    });
    if (dReg.body?.status !== "payment_pending") throw new Error(`Phase D setup: expected payment_pending, got ${JSON.stringify(dReg.body)}`);
    createdRegistrationIds.push(dReg.body.registration_id);

    const dPayOrder = await rpcAs(refundAcc.token, "create_event_payment_order", { p_registration_id: dReg.body.registration_id });
    const dGatewayOrderId = `order_loadtest_${stamp}_refund`;
    await svcFetch(`/rest/v1/payments?id=eq.${dPayOrder.body.id}`, { method: "PATCH", body: JSON.stringify({ gateway_order_id: dGatewayOrderId }) });
    const dPaise = Math.round(Number(dPayOrder.body.amount) * 100);
    await svcFetch(`/rest/v1/rpc/record_payment_event`, {
      method: "POST",
      body: JSON.stringify({
        p_gateway_order_id: dGatewayOrderId, p_gateway_payment_id: `pay_loadtest_${stamp}_refund`,
        p_status: "captured", p_signature_verified: true,
        p_raw_payload: { event: "payment.captured", payload: { payment: { entity: { id: `pay_loadtest_${stamp}_refund`, order_id: dGatewayOrderId, amount: dPaise } } } },
      }),
    });
    const [dRegPaid] = await svcFetch(`/rest/v1/event_registrations?id=eq.${dReg.body.registration_id}&select=payment_status`);
    if (dRegPaid?.payment_status !== "paid") throw new Error(`Phase D setup: registration didn't reach paid (${JSON.stringify(dRegPaid)})`);

    const cancelResults = await Promise.all(
      Array.from({ length: accounts.length }, () => rpcAs(refundAcc.token, "cancel_event_registration", { p_event_id: eventD.id }))
    );
    const cancelSuccesses = cancelResults.filter((r) => r.status >= 200 && r.status < 300 && r.body?.refund_id);
    const cancelCleanFailures = cancelResults.filter((r) => r.status >= 400);
    report("exactly one concurrent cancel succeeded with a refund_id", cancelSuccesses.length === 1, cancelResults.map((r) => r.body));
    report(`the other ${accounts.length - 1} failed cleanly (no active registration left to cancel)`, cancelCleanFailures.length === accounts.length - 1, cancelResults.map((r) => ({ status: r.status, body: r.body })));

    const refundsForPayment = await svcFetch(`/rest/v1/refunds?payment_id=eq.${dPayOrder.body.id}&select=id`);
    report("exactly one refunds row exists despite the concurrent double-cancel", refundsForPayment.length === 1, refundsForPayment);

    console.log(`\n[event-payment-race] ${overallPass ? "PASS" : "FAIL"} -- see phase results above`);
    if (!overallPass) process.exitCode = 1;
  } finally {
    // 3. Cleanup -- everything this script created, regardless of outcome.
    console.log("\n[event-payment-race] cleaning up...");
    for (const ev of [eventA, eventD]) {
      const regs = await svcFetch(`/rest/v1/event_registrations?event_id=eq.${ev.id}&select=id`);
      const regIds = regs.map((r) => r.id);
      if (regIds.length) {
        for (const id of regIds) await svcFetch(`/rest/v1/event_tickets?registration_id=eq.${id}`, { method: "DELETE" }).catch(() => {});
        const pays = await svcFetch(`/rest/v1/payments?event_registration_id=in.(${regIds.join(",")})&select=id`);
        const payIds = pays.map((p) => p.id);
        for (const id of payIds) {
          await svcFetch(`/rest/v1/refunds?payment_id=eq.${id}`, { method: "DELETE" }).catch(() => {});
          await svcFetch(`/rest/v1/payment_events?payment_id=eq.${id}`, { method: "DELETE" }).catch(() => {});
        }
        await svcFetch(`/rest/v1/payments?event_registration_id=in.(${regIds.join(",")})`, { method: "DELETE" }).catch(() => {});
      }
      await svcFetch(`/rest/v1/event_waitlist?event_id=eq.${ev.id}`, { method: "DELETE" }).catch(() => {});
      await svcFetch(`/rest/v1/event_registrations?event_id=eq.${ev.id}`, { method: "DELETE" }).catch(() => {});
      await svcFetch(`/rest/v1/notifications?action_id=eq.${ev.id}`, { method: "DELETE" }).catch(() => {});
      await svcFetch(`/rest/v1/events?id=eq.${ev.id}`, { method: "DELETE" }).catch(() => {});
    }
    for (const acc of accounts) {
      await svcFetch(`/auth/v1/admin/users/${acc.userId}`, { method: "DELETE" }).catch(() => {});
    }
    console.log(`[event-payment-race] cleaned up 2 fixture events, ${createdRegistrationIds.length} registration(s), ${accounts.length} throwaway account(s).`);
  }
}

main().catch((err) => {
  console.error("[event-payment-race] fatal:", err);
  process.exit(1);
});
