// Live verification for paid events (supabase/migrations/
// 20260831000800_paid_events.sql) -- register_for_event()'s price-aware
// branch, create_event_payment_order(), record_payment_event()'s new
// event_registration_id branch, cancel_event_registration()'s refund path,
// capacity/waitlist under a paid event, waitlist promotion needing payment,
// expire_stale_event_registrations(), get_event_roster()'s payment_status
// column, and RLS on payments/refunds for an event registration. Mirrors
// scripts/live-check-payment-and-store-billing.mjs's structure and its
// "call record_payment_event directly with a fake gateway_order_id" approach
// to exercising the RPC contract without needing a real Razorpay webhook
// secret (see that script's header for why).
//
// Also re-checks the FREE event path (price null) is completely unaffected
// -- register_for_event()'s free branch is meant to be byte-for-byte the
// same behaviour as before this migration.
//
// Usage: node scripts/live-check-paid-events.mjs                 (staging)
//        node scripts/live-check-paid-events.mjs --env=production --yes-production

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
  console.log(`=== Paid events (20260831000800_paid_events.sql) -- ${target} ===`);
  const svc = serviceClient();
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const stamp = Date.now();

  const { data: aliceProfile } = await svc.from("profiles").select("campus_id").eq("id", alice.userId).single();
  const campusId = aliceProfile.campus_id;

  // ---------------------------------------------------------------
  // Fixtures: one free event (regression check) + one paid, capacity-1
  // event (capacity/waitlist/payment scenarios).
  // ---------------------------------------------------------------
  const { data: freeEvent } = await svc.from("events").insert({
    campus_id: campusId, title: `LiveCheck Free Event ${stamp}`, category: "Workshop",
    event_date: new Date(Date.now() + 7 * 86400_000).toISOString(), place: "Live Check Hall", price: null,
  }).select().single();

  const { data: paidEvent } = await svc.from("events").insert({
    campus_id: campusId, title: `LiveCheck Paid Event ${stamp}`, category: "Workshop",
    event_date: new Date(Date.now() + 7 * 86400_000).toISOString(), place: "Live Check Hall", price: 250, capacity: 1,
  }).select().single();

  try {
    // ---------------------------------------------------------------
    // Free event -- unchanged behaviour
    // ---------------------------------------------------------------
    console.log("\n--- Free event (price = null): unchanged, confirmed immediately with a ticket ---");
    const { data: freeReg, error: freeRegErr } = await alice.sb.rpc("register_for_event", {
      p_event_id: freeEvent.id, p_contact_phone: "9876543210", p_contact_name: "Alice Test",
    });
    check("register_for_event on a free event returns status=confirmed with a ticket_token", !freeRegErr && freeReg?.status === "confirmed" && !!freeReg?.ticket_token, freeRegErr || freeReg);
    const { data: freeRegRow } = await svc.from("event_registrations").select("payment_status").eq("id", freeReg.registration_id).single();
    check("Free registration's payment_status is 'not_required'", freeRegRow?.payment_status === "not_required", freeRegRow);

    // ---------------------------------------------------------------
    // Paid event, capacity 1: Alice registers -> reserves the seat but
    // no ticket yet.
    // ---------------------------------------------------------------
    console.log("\n--- Paid event: register_for_event reserves the seat, no ticket until paid ---");
    const { data: reg1, error: reg1Err } = await alice.sb.rpc("register_for_event", {
      p_event_id: paidEvent.id, p_contact_phone: "9876543210", p_contact_name: "Alice Test",
    });
    check("register_for_event on a paid event returns status=payment_pending with an amount", !reg1Err && reg1?.status === "payment_pending" && Number(reg1?.amount) === 250, reg1Err || reg1);
    check("No ticket_token is returned yet", !reg1?.ticket_token, reg1);

    const { data: reg1Row } = await svc.from("event_registrations").select("status, payment_status").eq("id", reg1.registration_id).single();
    check("Registration row is status=confirmed (seat reserved), payment_status=pending", reg1Row?.status === "confirmed" && reg1Row?.payment_status === "pending", reg1Row);
    const { data: ticketCheck } = await svc.from("event_tickets").select("id").eq("registration_id", reg1.registration_id);
    check("No event_tickets row exists yet", (ticketCheck?.length ?? 0) === 0, ticketCheck);

    // Bob tries to register for the same (now full, since Alice's pending
    // row already counts toward capacity) event -> waitlisted, not charged.
    const { data: bobReg, error: bobRegErr } = await bob.sb.rpc("register_for_event", {
      p_event_id: paidEvent.id, p_contact_phone: "9876543211", p_contact_name: "Bob Test",
    });
    check("A second student is waitlisted (Alice's pending-payment row already occupies the only seat)", !bobRegErr && bobReg?.status === "waitlisted", bobRegErr || bobReg);

    // Resuming: calling register_for_event again for Alice returns the same
    // registration instead of EVENT_ALREADY_REGISTERED.
    const { data: reg1Resume, error: reg1ResumeErr } = await alice.sb.rpc("register_for_event", {
      p_event_id: paidEvent.id, p_contact_phone: "9876543210", p_contact_name: "Alice Test",
    });
    check("Re-registering while payment is pending resumes the same registration (no EVENT_ALREADY_REGISTERED)", !reg1ResumeErr && reg1Resume?.status === "payment_pending" && reg1Resume?.registration_id === reg1.registration_id, reg1ResumeErr || reg1Resume);

    // ---------------------------------------------------------------
    // create_event_payment_order -- amount re-derived server-side, idempotent
    // ---------------------------------------------------------------
    console.log("\n--- create_event_payment_order ---");
    const { data: payOrder1, error: payOrder1Err } = await alice.sb.rpc("create_event_payment_order", { p_registration_id: reg1.registration_id });
    check("create_event_payment_order returns a 'created' payment for the event's real price (250)", !payOrder1Err && payOrder1?.status === "created" && Number(payOrder1.amount) === 250, payOrder1Err || payOrder1);

    const { data: payOrder2 } = await alice.sb.rpc("create_event_payment_order", { p_registration_id: reg1.registration_id });
    check("A second call reuses the same 'created' payment row (idempotent)", payOrder2?.id === payOrder1?.id, { payOrder1, payOrder2 });

    const { error: bobPayOrderErr } = await bob.sb.rpc("create_event_payment_order", { p_registration_id: reg1.registration_id });
    check("A different student cannot open a payment order for Alice's registration", !!bobPayOrderErr, bobPayOrderErr?.message);

    // RLS: only Alice (owner) can read this payment/refund-eligible row.
    const { error: aliceReadPaymentErr } = await alice.sb.from("payments").select("id").eq("id", payOrder1.id).single();
    check("Alice can read her own event payment row (payments_read RLS)", !aliceReadPaymentErr, aliceReadPaymentErr);
    const { data: bobReadPayment } = await bob.sb.from("payments").select("id").eq("id", payOrder1.id).maybeSingle();
    check("Bob cannot read Alice's event payment row", !bobReadPayment, bobReadPayment);

    // ---------------------------------------------------------------
    // record_payment_event: simulate the webhook's captured+verified call
    // ---------------------------------------------------------------
    console.log("\n--- record_payment_event: captured payment mints the ticket ---");
    const gatewayOrderId1 = `order_livecheck_${stamp}_1`;
    await svc.from("payments").update({ gateway_order_id: gatewayOrderId1 }).eq("id", payOrder1.id);
    const { error: captureErr } = await fakeCapture(svc, gatewayOrderId1, `${stamp}_1`, 25000);
    check("record_payment_event accepts the captured event", !captureErr, captureErr);

    const { data: reg1AfterPay } = await svc.from("event_registrations").select("status, payment_status, payment_id").eq("id", reg1.registration_id).single();
    check("Registration flips to payment_status=paid", reg1AfterPay?.payment_status === "paid" && reg1AfterPay?.payment_id === payOrder1.id, reg1AfterPay);
    const { data: ticketAfterPay } = await svc.from("event_tickets").select("token").eq("registration_id", reg1.registration_id).maybeSingle();
    check("A ticket is minted once payment is captured", !!ticketAfterPay?.token, ticketAfterPay);
    const { data: notif } = await svc.from("notifications").select("title").eq("user_id", alice.userId).eq("action_id", paidEvent.id).ilike("title", "%Payment confirmed%").order("created_at", { ascending: false }).limit(1);
    check("A 'Payment confirmed' notification was sent", (notif?.length ?? 0) > 0, notif);

    // ---------------------------------------------------------------
    // Cancel a paid registration -> refund row created; RLS-readable by the
    // owner; a captured payment on a captured registration promotes Bob off
    // the waitlist into a payment_pending state (not a free ticket).
    // ---------------------------------------------------------------
    console.log("\n--- cancel_event_registration: refund + waitlist promotion (paid) ---");
    const { data: cancelResult, error: cancelErr } = await alice.sb.rpc("cancel_event_registration", { p_event_id: paidEvent.id });
    check("cancel_event_registration returns a refund_id for a captured payment", !cancelErr && !!cancelResult?.refund_id, cancelErr || cancelResult);

    const { error: aliceReadRefundErr } = await alice.sb.from("refunds").select("id, status").eq("id", cancelResult.refund_id).single();
    check("Alice can read her own refund row (refunds_read RLS)", !aliceReadRefundErr, aliceReadRefundErr);

    const { data: bobAfterPromotion } = await svc.from("event_registrations").select("id, status, payment_status").eq("event_id", paidEvent.id).eq("user_id", bob.userId).single();
    check("Bob is promoted off the waitlist into status=confirmed, payment_status=pending (still needs to pay)", bobAfterPromotion?.status === "confirmed" && bobAfterPromotion?.payment_status === "pending", bobAfterPromotion);
    const { data: bobTicketCheck } = await svc.from("event_tickets").select("id").eq("registration_id", bobAfterPromotion?.id);
    check("Bob does NOT get a ticket just from being promoted -- he still has to pay", (bobTicketCheck?.length ?? 0) === 0, bobTicketCheck);
    const { data: bobNotif } = await svc.from("notifications").select("title").eq("user_id", bob.userId).eq("action_id", paidEvent.id).ilike("title", "%pay within 30 minutes%").order("created_at", { ascending: false }).limit(1);
    check("Bob got a 'pay within 30 minutes' notification, not a plain 'off the waitlist'", (bobNotif?.length ?? 0) > 0, bobNotif);

    // ---------------------------------------------------------------
    // expire_stale_event_registrations(): backdate Bob's registration past
    // the 30-minute window and sweep.
    // ---------------------------------------------------------------
    console.log("\n--- expire_stale_event_registrations(): abandoned payment releases the seat ---");
    await svc.from("event_registrations").update({ registered_at: new Date(Date.now() - 40 * 60_000).toISOString() }).eq("id", bobAfterPromotion.id);
    const { error: sweepErr } = await svc.rpc("expire_stale_event_registrations");
    check("expire_stale_event_registrations() runs without error", !sweepErr, sweepErr);
    const { data: bobAfterSweep } = await svc.from("event_registrations").select("status, payment_status").eq("id", bobAfterPromotion.id).single();
    check("Bob's abandoned registration is cancelled with payment_status=expired", bobAfterSweep?.status === "cancelled" && bobAfterSweep?.payment_status === "expired", bobAfterSweep);
    const { data: eventAfterSweep } = await svc.from("events").select("registration_status").eq("id", paidEvent.id).single();
    check("With nobody left waiting, the event's registration_status re-opens", eventAfterSweep?.registration_status === "OPEN", eventAfterSweep);

    // ---------------------------------------------------------------
    // get_event_roster: payment_status column
    // ---------------------------------------------------------------
    console.log("\n--- get_event_roster ---");
    const { data: roster, error: rosterErr } = await svc.rpc("get_event_roster", { p_event_id: paidEvent.id });
    check("get_event_roster resolves for the event's data (service role bypasses the organizer check for this smoke test)", !rosterErr, rosterErr);
    check("get_event_roster's rows carry a payment_status field", Array.isArray(roster) && roster.every((r) => "payment_status" in r), roster);

  } finally {
    // ---------------------------------------------------------------
    // Cleanup -- delete everything this script created.
    // ---------------------------------------------------------------
    for (const ev of [freeEvent, paidEvent]) {
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
      await svc.from("events").delete().eq("id", ev.id);
    }
    console.log("\n(cleanup complete)");
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
