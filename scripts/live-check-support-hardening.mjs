// One-off live verification script (not part of the automated suite) --
// exercises supabase/migrations/20260819001100_support_priority_escalation_
// attachments.sql, 20260819001200_support_faq.sql and
// 20260819001300_support_analytics.sql directly against a real Supabase
// project using real signed-in sessions. Prints PASS/FAIL per assertion.
// Same shape as scripts/live-check-operational-gaps.mjs.
//
// Usage: node scripts/live-check-support-hardening.mjs                 (staging)
//        node scripts/live-check-support-hardening.mjs --env=production --yes-production

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

function client(key = ANON_KEY) {
  return createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

const svc = client(SERVICE_ROLE_KEY);
const suffix = Date.now();
const cleanup = { tickets: [], faqs: [], storagePaths: [] };

// 1x1 transparent PNG -- storage policies only check the mime-type header,
// not real image content, so this is enough to exercise the upload path.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function main() {
  console.log(`=== Support hardening pass (${target}) ===`);
  const admin = await signIn("1nh25cs265@usn.campusos.internal", "Sanjay@123");
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));

  // =========================================================
  // Screenshot attachments
  // =========================================================
  console.log("\n--- Screenshot attachments ---");

  const attachPath = `${alice.userId}/livecheck-${suffix}.png`;
  const { error: uploadErr } = await alice.sb.storage.from("support-media").upload(attachPath, PNG_BYTES, { contentType: "image/png" });
  check("student can upload into their own support-media folder", !uploadErr, uploadErr?.message);
  cleanup.storagePaths.push(attachPath);

  const { data: ticket, error: ticketErr } = await alice.sb.rpc("create_support_ticket", {
    p_category: "technical", p_subject: `LiveCheck ticket ${suffix}`, p_description: "App crashed, see screenshot", p_attachment_url: attachPath,
  });
  check("student can create a ticket with an attachment", !ticketErr && !!ticket, ticketErr?.message);
  if (ticket) cleanup.tickets.push(ticket.id);

  const { data: openingMsg } = await svc.from("support_ticket_messages").select("attachment_url").eq("ticket_id", ticket.id).order("created_at").limit(1).single();
  check("the opening message carries the attachment path", openingMsg?.attachment_url === attachPath, openingMsg);

  const { data: adminSigned, error: adminSignErr } = await admin.sb.storage.from("support-media").createSignedUrl(attachPath, 60);
  check("support.manage/admin can sign a URL for a student's attachment", !adminSignErr && !!adminSigned?.signedUrl, adminSignErr?.message);

  const { data: bobSigned, error: bobSignErr } = await bob.sb.storage.from("support-media").createSignedUrl(attachPath, 60);
  check("an unrelated student CANNOT sign a URL for someone else's attachment", !!bobSignErr && !bobSigned?.signedUrl, bobSigned);

  // =========================================================
  // Priority + escalation
  // =========================================================
  console.log("\n--- Priority + escalation ---");

  const { error: bobPriorityErr } = await bob.sb.rpc("set_support_ticket_priority", { p_ticket_id: ticket.id, p_priority: "urgent" });
  check("a non-staff student CANNOT set ticket priority", !!bobPriorityErr, bobPriorityErr);

  const { data: afterAdminPriority, error: adminPriorityErr } = await admin.sb.rpc("set_support_ticket_priority", { p_ticket_id: ticket.id, p_priority: "high" });
  check("support.manage/admin can set priority", !adminPriorityErr && afterAdminPriority?.priority === "high", adminPriorityErr?.message || afterAdminPriority);

  const { data: notifsBefore } = await svc.from("notifications").select("id").eq("user_id", admin.userId).eq("dedup_key", `support_escalate_${ticket.id}`);
  const { data: afterEscalate, error: escalateErr } = await alice.sb.rpc("escalate_support_ticket", { p_ticket_id: ticket.id, p_reason: "Live-check escalation" });
  check("the ticket owner can escalate their own ticket", !escalateErr && afterEscalate?.priority === "urgent", escalateErr?.message || afterEscalate);

  const { data: notifsAfter } = await svc.from("notifications").select("id").eq("user_id", admin.userId).eq("dedup_key", `support_escalate_${ticket.id}`);
  check("escalating notifies the support.manage/admin pool", (notifsAfter?.length ?? 0) > (notifsBefore?.length ?? 0), { before: notifsBefore?.length, after: notifsAfter?.length });

  const { error: bobEscalateErr } = await bob.sb.rpc("escalate_support_ticket", { p_ticket_id: ticket.id, p_reason: "not my ticket" });
  check("an unrelated student CANNOT escalate someone else's ticket", !!bobEscalateErr, bobEscalateErr);

  // =========================================================
  // Help Centre / FAQ
  // =========================================================
  console.log("\n--- Help Centre / FAQ ---");

  const { data: faq, error: faqCreateErr } = await admin.sb.rpc("admin_upsert_support_faq", {
    p_id: null, p_campus_id: null, p_category: "general", p_question: `LiveCheck FAQ ${suffix}?`,
    p_answer: "Yes, this is a live-check entry.", p_sort_order: 0, p_is_active: true,
  });
  check("admin can create a global FAQ entry", !faqCreateErr && !!faq, faqCreateErr?.message);
  if (faq) cleanup.faqs.push(faq.id);

  const { error: bobFaqWriteErr } = await bob.sb.rpc("admin_upsert_support_faq", {
    p_id: null, p_campus_id: null, p_category: "general", p_question: "should fail", p_answer: "should fail", p_sort_order: 0, p_is_active: true,
  });
  check("a non-staff student CANNOT write FAQ entries", !!bobFaqWriteErr, bobFaqWriteErr);

  const { data: aliceReadFaqs, error: aliceFaqReadErr } = await alice.sb.from("support_faqs").select("id").eq("id", faq?.id);
  check("a student can read an active global FAQ entry", !aliceFaqReadErr && (aliceReadFaqs?.length ?? 0) === 1, aliceFaqReadErr?.message);

  const anonSb = client(); // no session -- self-serve help centre should work signed out
  const { data: anonReadFaqs, error: anonFaqReadErr } = await anonSb.from("support_faqs").select("id").eq("id", faq?.id);
  check("an anonymous (signed-out) visitor can read an active global FAQ entry", !anonFaqReadErr && (anonReadFaqs?.length ?? 0) === 1, anonFaqReadErr?.message);

  // =========================================================
  // Support analytics
  // =========================================================
  console.log("\n--- Support analytics ---");

  const { data: summary, error: summaryErr } = await admin.sb.rpc("admin_support_summary", { p_campus_id: null, p_days: 30 });
  check("admin_support_summary runs and sees the live-check ticket", !summaryErr && (summary?.[0]?.ticket_count ?? 0) >= 1, summaryErr?.message || summary);

  const { data: byCategory, error: byCategoryErr } = await admin.sb.rpc("admin_support_tickets_by_category", { p_campus_id: null, p_days: 30 });
  check("admin_support_tickets_by_category runs", !byCategoryErr && Array.isArray(byCategory), byCategoryErr?.message);

  const { data: byPriority, error: byPriorityErr } = await admin.sb.rpc("admin_support_tickets_by_priority", { p_campus_id: null, p_days: 30 });
  check("admin_support_tickets_by_priority runs", !byPriorityErr && Array.isArray(byPriority), byPriorityErr?.message);

  const { data: series, error: seriesErr } = await admin.sb.rpc("admin_support_tickets_series", { p_campus_id: null, p_days: 30 });
  check("admin_support_tickets_series runs and covers 30 days", !seriesErr && series?.length === 30, seriesErr?.message || series?.length);

  const { error: aliceAnalyticsErr } = await alice.sb.rpc("admin_support_summary", { p_campus_id: null, p_days: 30 });
  check("a student without analytics.read CANNOT call support analytics", !!aliceAnalyticsErr, aliceAnalyticsErr);

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
}

async function cleanupAll() {
  console.log("\nCleaning up test data...");
  if (cleanup.tickets.length) await svc.from("support_tickets").delete().in("id", cleanup.tickets);
  if (cleanup.faqs.length) await svc.from("support_faqs").delete().in("id", cleanup.faqs);
  if (cleanup.storagePaths.length) await svc.storage.from("support-media").remove(cleanup.storagePaths);
}

main()
  .catch((err) => {
    console.error("FATAL:", err);
    failCount++;
  })
  .finally(async () => {
    await cleanupAll();
    process.exit(failCount > 0 ? 1 : 0);
  });
