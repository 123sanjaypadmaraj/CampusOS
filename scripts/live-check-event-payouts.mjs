// Live verification for the event payout ledger (supabase/migrations/
// 20260831001400_event_payouts.sql) -- generate_event_payout(),
// mark_event_payout_paid(), event_settlement_report(), RLS on
// event_payouts, and get_club_dashboard()'s inline payout_status/
// payout_net_amount fields. Mirrors scripts/live-check-paid-events.mjs's
// structure and its "call record_payment_event directly with a fake
// gateway_order_id" approach to simulating a captured payment without a
// real Razorpay webhook secret.
//
// Usage: node scripts/live-check-event-payouts.mjs                 (staging)
//        node scripts/live-check-event-payouts.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();

const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
function adminPassword() {
  const p = path.join(root, "scripts", adminCredsFile);
  if (!fs.existsSync(p)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first.`);
  return JSON.parse(fs.readFileSync(p, "utf8")).password;
}
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const e2ePassword = (email) => {
  const password = e2eCreds.find((r) => r.email === email)?.password;
  if (!password) throw new Error(`No password known for ${email} in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
  return password;
};

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

async function fakeCapture(svc, gatewayOrderId, paymentIdSuffix, amountPaise) {
  return svc.rpc("record_payment_event", {
    p_gateway_order_id: gatewayOrderId,
    p_gateway_payment_id: `pay_livecheck_${paymentIdSuffix}`,
    p_status: "captured",
    p_signature_verified: true,
    p_raw_payload: { event: "payment.captured", payload: { payment: { entity: { id: `pay_livecheck_${paymentIdSuffix}`, order_id: gatewayOrderId, amount: amountPaise } } } },
  });
}

async function main() {
  console.log(`=== Event payouts (20260831001400_event_payouts.sql) -- ${target} ===`);
  const svc = serviceClient();
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const carol = await signIn("e2e.carol@nhce.edu.in", e2ePassword("e2e.carol@nhce.edu.in"));
  const stamp = Date.now();

  const { data: aliceProfile } = await svc.from("profiles").select("campus_id").eq("id", alice.userId).single();
  const campusId = aliceProfile.campus_id;

  // ---------------------------------------------------------------
  // Fixtures: a throwaway club with Alice as president, one paid event on
  // it (capacity 5, no waitlist scenario needed here -- that's already
  // covered by live-check-paid-events.mjs), Bob and Carol register+pay.
  // ---------------------------------------------------------------
  const { data: club } = await svc.from("clubs").insert({
    campus_id: campusId, name: `LiveCheck Payout Club ${stamp}`, category: "Technical",
  }).select().single();
  await svc.from("club_members").insert({ club_id: club.id, user_id: alice.userId, role: "president" });

  const { data: event } = await svc.from("events").insert({
    campus_id: campusId, club_id: club.id, organizer_id: alice.userId,
    title: `LiveCheck Payout Event ${stamp}`, category: "Workshop",
    event_date: new Date(Date.now() + 7 * 86400_000).toISOString(), place: "Live Check Hall", price: 200, capacity: 5,
  }).select().single();

  // A second, free-standing (no club) event organized solely by Bob, for
  // the organizer_id-only payee path.
  const { data: soloEvent } = await svc.from("events").insert({
    campus_id: campusId, club_id: null, organizer_id: bob.userId,
    title: `LiveCheck Payout Solo Event ${stamp}`, category: "Workshop",
    event_date: new Date(Date.now() + 7 * 86400_000).toISOString(), place: "Live Check Hall", price: 150, capacity: 5,
  }).select().single();

  let payoutId, soloPayoutId;

  try {
    // ---------------------------------------------------------------
    // Pay for two registrations on the club event (Bob 200, Carol 200),
    // one completed refund (Bob cancels after paying) -- so the payout
    // math has a real gross/fee/refund/net to check, not a trivial single
    // line.
    // ---------------------------------------------------------------
    console.log("\n--- Fixtures: two paid registrations + one completed refund ---");
    const { data: bobReg } = await bob.sb.rpc("register_for_event", { p_event_id: event.id, p_contact_phone: "9876543210", p_contact_name: "Bob Test" });
    const { data: bobPayOrder } = await bob.sb.rpc("create_event_payment_order", { p_registration_id: bobReg.registration_id });
    const bobGatewayId = `order_livecheck_payout_${stamp}_bob`;
    await svc.from("payments").update({ gateway_order_id: bobGatewayId }).eq("id", bobPayOrder.id);
    await fakeCapture(svc, bobGatewayId, `${stamp}_bob`, 20000);

    const { data: carolReg } = await carol.sb.rpc("register_for_event", { p_event_id: event.id, p_contact_phone: "9876543211", p_contact_name: "Carol Test" });
    const { data: carolPayOrder } = await carol.sb.rpc("create_event_payment_order", { p_registration_id: carolReg.registration_id });
    const carolGatewayId = `order_livecheck_payout_${stamp}_carol`;
    await svc.from("payments").update({ gateway_order_id: carolGatewayId }).eq("id", carolPayOrder.id);
    await fakeCapture(svc, carolGatewayId, `${stamp}_carol`, 20000);

    // Bob cancels -> refund request created, then marked completed directly
    // (service role) to simulate the gateway confirming the refund, same as
    // the payment-hardening live-check does for orders.
    const { data: bobCancel } = await bob.sb.rpc("cancel_event_registration", { p_event_id: event.id });
    check("Bob's cancellation created a refund request", !!bobCancel?.refund_id, bobCancel);
    await svc.rpc("mark_refund_completed", { p_refund_id: bobCancel.refund_id, p_gateway_refund_id: `rfnd_livecheck_${stamp}` });

    // ---------------------------------------------------------------
    // event_settlement_report: itemized view, self-service for the club
    // leader (Alice), before any payout is generated.
    // ---------------------------------------------------------------
    console.log("\n--- event_settlement_report ---");
    const { data: report, error: reportErr } = await alice.sb.rpc("event_settlement_report", { p_event_id: event.id });
    check("Alice (club president) can read the settlement report", !reportErr, reportErr);
    const regRows = (report || []).filter((r) => r.row_type === "registration");
    const refundRows = (report || []).filter((r) => r.row_type === "refund");
    check("Report has 2 registration rows (Bob + Carol) at ₹200 gross each", regRows.length === 2 && regRows.every((r) => Number(r.gross_amount) === 200), regRows);
    check("Report has 1 refund row for -₹200", refundRows.length === 1 && Number(refundRows[0].gross_amount) === -200, refundRows);

    const { data: carolReportAttempt, error: carolReportErr } = await carol.sb.rpc("event_settlement_report", { p_event_id: event.id });
    check("Carol (a registrant, not a club leader) cannot read the settlement report", !!carolReportErr && !carolReportAttempt, carolReportErr?.message);

    // ---------------------------------------------------------------
    // generate_event_payout: admin only, correct math, no double-generate.
    // Gross = 400 (Bob 200 + Carol 200), fee = 5% of 400 = 20, refund = 200
    // (Bob's completed refund), net = 400 - 20 - 200 = 180.
    // ---------------------------------------------------------------
    console.log("\n--- generate_event_payout ---");
    const { error: aliceGenErr } = await alice.sb.rpc("generate_event_payout", { p_event_id: event.id });
    check("A non-admin (club president) cannot generate a payout", !!aliceGenErr, aliceGenErr?.message);

    const { data: payout, error: genErr } = await admin.sb.rpc("generate_event_payout", { p_event_id: event.id });
    check("Admin generates the payout without error", !genErr, genErr);
    check("gross_amount = 400", Number(payout?.gross_amount) === 400, payout);
    check("platform_fee_amount = 20 (5% of gross)", Number(payout?.platform_fee_amount) === 20, payout);
    check("refund_amount = 200", Number(payout?.refund_amount) === 200, payout);
    check("net_amount = 180", Number(payout?.net_amount) === 180, payout);
    check("status starts 'pending'", payout?.status === "pending", payout);
    check("club_id is snapshotted onto the payout row", payout?.club_id === club.id, payout);
    payoutId = payout?.id;

    const { error: dupeErr } = await admin.sb.rpc("generate_event_payout", { p_event_id: event.id });
    check("Generating a second payout for the same event is refused", !!dupeErr, dupeErr?.message);

    const { data: freeEventForPayout } = await svc.from("events").insert({
      campus_id: campusId, club_id: club.id, title: `LiveCheck Free (no payout) ${stamp}`, category: "Workshop",
      event_date: new Date(Date.now() + 7 * 86400_000).toISOString(), place: "Live Check Hall", price: null,
    }).select().single();
    const { error: freeGenErr } = await admin.sb.rpc("generate_event_payout", { p_event_id: freeEventForPayout.id });
    check("Generating a payout for a free event is refused", !!freeGenErr, freeGenErr?.message);
    await svc.from("events").delete().eq("id", freeEventForPayout.id);

    // ---------------------------------------------------------------
    // RLS on event_payouts: club leader can read, an unrelated student can't.
    // ---------------------------------------------------------------
    console.log("\n--- event_payouts RLS ---");
    const { data: aliceReadPayout, error: aliceReadErr } = await alice.sb.from("event_payouts").select("id, net_amount").eq("id", payoutId).maybeSingle();
    check("Alice (club leader) can read the payout row", !aliceReadErr && !!aliceReadPayout, aliceReadErr || aliceReadPayout);
    const { data: carolReadPayout } = await carol.sb.from("event_payouts").select("id").eq("id", payoutId).maybeSingle();
    check("Carol (unrelated student) cannot read the payout row", !carolReadPayout, carolReadPayout);

    // ---------------------------------------------------------------
    // mark_event_payout_paid: admin only, notifies every club leader role.
    // ---------------------------------------------------------------
    console.log("\n--- mark_event_payout_paid ---");
    const { error: aliceMarkErr } = await alice.sb.rpc("mark_event_payout_paid", { p_payout_id: payoutId, p_reference: "should-not-work" });
    check("A non-admin cannot mark a payout paid", !!aliceMarkErr, aliceMarkErr?.message);

    const { data: markedPayout, error: markErr } = await admin.sb.rpc("mark_event_payout_paid", { p_payout_id: payoutId, p_reference: "UTR-LIVECHECK-1" });
    check("Admin marks the payout paid", !markErr && markedPayout?.status === "paid" && markedPayout?.reference === "UTR-LIVECHECK-1", markErr || markedPayout);
    check("paid_at is set", !!markedPayout?.paid_at, markedPayout);

    const { data: aliceNotif } = await svc.from("notifications").select("title, body").eq("user_id", alice.userId).eq("action_id", payoutId).ilike("title", "%Payout processed%").order("created_at", { ascending: false }).limit(1);
    check("Alice (club president) got a 'Payout processed' notification", (aliceNotif?.length ?? 0) > 0, aliceNotif);

    // ---------------------------------------------------------------
    // get_club_dashboard: inline payout_status/payout_net_amount.
    // ---------------------------------------------------------------
    console.log("\n--- get_club_dashboard inline payout fields ---");
    const { data: dashboard, error: dashErr } = await alice.sb.rpc("get_club_dashboard", { p_club_id: club.id });
    check("get_club_dashboard resolves", !dashErr, dashErr);
    const eventInDash = (dashboard?.events || []).find((e) => e.id === event.id);
    check("The event's payout_status is 'paid' inline in the dashboard", eventInDash?.payout_status === "paid", eventInDash);
    check("The event's payout_net_amount is 180 inline in the dashboard", Number(eventInDash?.payout_net_amount) === 180, eventInDash);

    // ---------------------------------------------------------------
    // Solo (no-club) event: organizer_id-only payee path.
    // ---------------------------------------------------------------
    console.log("\n--- Solo (no-club) event: organizer_id payee path ---");
    const { data: carolSoloReg } = await carol.sb.rpc("register_for_event", { p_event_id: soloEvent.id, p_contact_phone: "9876543212", p_contact_name: "Carol Test" });
    const { data: carolSoloPayOrder } = await carol.sb.rpc("create_event_payment_order", { p_registration_id: carolSoloReg.registration_id });
    const soloGatewayId = `order_livecheck_payout_${stamp}_solo`;
    await svc.from("payments").update({ gateway_order_id: soloGatewayId }).eq("id", carolSoloPayOrder.id);
    await fakeCapture(svc, soloGatewayId, `${stamp}_solo`, 15000);

    const { data: soloPayout, error: soloGenErr } = await admin.sb.rpc("generate_event_payout", { p_event_id: soloEvent.id });
    check("Solo event payout generates with organizer_id set, club_id null", !soloGenErr && soloPayout?.organizer_id === bob.userId && !soloPayout?.club_id, soloGenErr || soloPayout);
    check("Solo event net_amount = 142.5 (150 - 5% fee)", Number(soloPayout?.net_amount) === 142.5, soloPayout);
    soloPayoutId = soloPayout?.id;

    const { data: bobReadSoloPayout } = await bob.sb.from("event_payouts").select("id").eq("id", soloPayoutId).maybeSingle();
    check("Bob (the solo organizer) can read his own payout row", !!bobReadSoloPayout, bobReadSoloPayout);

    await admin.sb.rpc("mark_event_payout_paid", { p_payout_id: soloPayoutId, p_reference: "UTR-LIVECHECK-2" });
    const { data: bobNotif } = await svc.from("notifications").select("title").eq("user_id", bob.userId).eq("action_id", soloPayoutId).ilike("title", "%Payout processed%").order("created_at", { ascending: false }).limit(1);
    check("Bob got a 'Payout processed' notification for the solo event", (bobNotif?.length ?? 0) > 0, bobNotif);

  } finally {
    // ---------------------------------------------------------------
    // Cleanup -- delete everything this script created.
    // ---------------------------------------------------------------
    for (const ev of [event, soloEvent]) {
      if (!ev) continue;
      const { data: regs } = await svc.from("event_registrations").select("id").eq("event_id", ev.id);
      const regIds = (regs || []).map((r) => r.id);
      if (regIds.length) {
        await svc.from("event_tickets").delete().in("registration_id", regIds);
        const { data: pays } = await svc.from("payments").select("id").in("event_registration_id", regIds);
        const payIds = (pays || []).map((p) => p.id);
        if (payIds.length) {
          await svc.from("refunds").delete().in("payment_id", payIds);
          await svc.from("payment_events").delete().in("payment_id", payIds);
        }
        await svc.from("payments").delete().in("event_registration_id", regIds);
      }
      await svc.from("event_waitlist").delete().eq("event_id", ev.id);
      await svc.from("event_registrations").delete().eq("event_id", ev.id);
      await svc.from("notifications").delete().eq("action_id", ev.id);
      await svc.from("event_payouts").delete().eq("event_id", ev.id);
      await svc.from("events").delete().eq("id", ev.id);
    }
    if (club) {
      await svc.from("club_members").delete().eq("club_id", club.id);
      await svc.from("clubs").delete().eq("id", club.id);
    }
    if (payoutId) await svc.from("notifications").delete().eq("action_id", payoutId);
    if (soloPayoutId) await svc.from("notifications").delete().eq("action_id", soloPayoutId);
    console.log("\n(cleanup complete)");
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
