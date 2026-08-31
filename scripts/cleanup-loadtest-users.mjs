// Tears down everything scripts/setup-loadtest-users.mjs +
// scripts/loadtest-concurrent-scenario.mjs created for the 2026-08-31
// "100+ concurrent users" load test: every row those load-test accounts
// (e2e.load###@nhce.edu.in) touched, the ephemeral test club/event, and
// finally the accounts themselves -- then re-queries to confirm nothing
// was left behind instead of just trusting the delete calls succeeded.
//
// Self-contained: re-derives everything from the DB via the e2e.load%
// email pattern and the fixtures file, so it works even if the scenario
// script only got partway through, or ran in a previous session.
//
// Usage: node scripts/cleanup-loadtest-users.mjs                       (staging, default)
//        node scripts/cleanup-loadtest-users.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, SERVICE_ROLE_KEY, sessionsFile, root, target } = resolveTarget();
const isStaging = sessionsFile.includes(".staging.");

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function adminFetch(pathname, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY, ...options.headers },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log(`=== Cleaning up load-test data -- target: ${target} ===\n`);

  // ---- Find every load-test user id (source of truth: auth.users, not
  // just the local sessions/credentials files, so this also cleans up a
  // run whose local files got lost). ----
  const allLoadUsers = [];
  let page = 1;
  while (true) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const matches = (data?.users || []).filter((u) => /^e2e\.load\d+@nhce\.edu\.in$/i.test(u.email || ""));
    allLoadUsers.push(...matches);
    if (!data?.users || data.users.length < 200) break;
    page++;
  }
  const userIds = allLoadUsers.map((u) => u.id);
  console.log(`Found ${userIds.length} load-test accounts (e2e.load###@nhce.edu.in).`);

  const fixturesFile = path.join(root, "scripts", `.loadtest-fixtures${isStaging ? ".staging" : ""}.json`);
  let fixtures = null;
  if (fs.existsSync(fixturesFile)) {
    try { fixtures = JSON.parse(fs.readFileSync(fixturesFile, "utf8")); } catch { fixtures = null; }
  }
  // Fall back to name-matching in case the fixtures file is missing.
  const clubIds = fixtures?.clubId ? [fixtures.clubId] : (await svc.from("clubs").select("id").like("name", "LoadTest Club %")).data?.map((r) => r.id) || [];
  const eventIds = fixtures?.eventId ? [fixtures.eventId] : (await svc.from("events").select("id").like("title", "LoadTest Event %")).data?.map((r) => r.id) || [];

  const counts = {};
  // Chunked so a big `.in("id", [...])` delete never blows past PostgREST's
  // URL length limit -- discovered live at 110-user scale: a straight
  // one-shot delete of 1000 notification ids came back "400 Bad Request"
  // (harmless that run only because the auth.users cascade cleaned them up
  // anyway a few steps later, but not something to rely on in general).
  const CHUNK = 200;
  async function deleteWhere(label, table, filterFn) {
    const selectQuery = filterFn(svc.from(table).select("id", { count: "exact" }));
    const { data: rows, error: selErr } = await selectQuery;
    if (selErr) { console.log(`  [skip] ${label}: select failed -- ${selErr.message}`); return; }
    const ids = (rows || []).map((r) => r.id);
    counts[label] = ids.length;
    if (!ids.length) { console.log(`  ${label}: 0 rows`); return; }
    let deleted = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { error: delErr } = await svc.from(table).delete().in("id", batch);
      if (delErr) { console.log(`  [FAIL] ${label}: deleted ${deleted}/${ids.length} then -- ${delErr.message}`); return; }
      deleted += batch.length;
    }
    console.log(`  ${label}: deleted ${deleted} row(s)`);
  }

  if (userIds.length === 0 && clubIds.length === 0 && eventIds.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  // ---- Messaging: conversations where every participant is a load-test
  // user (DMs + groups created by Phase 3). ----
  console.log("\n--- Messaging ---");
  const { data: partRows } = userIds.length ? await svc.from("conversation_participants").select("conversation_id").in("user_id", userIds) : { data: [] };
  const candidateConvIds = [...new Set((partRows || []).map((r) => r.conversation_id))];
  let loadTestConvIds = [];
  if (candidateConvIds.length) {
    const { data: allParts } = await svc.from("conversation_participants").select("conversation_id, user_id").in("conversation_id", candidateConvIds);
    const byConv = new Map();
    for (const r of allParts || []) {
      if (!byConv.has(r.conversation_id)) byConv.set(r.conversation_id, []);
      byConv.get(r.conversation_id).push(r.user_id);
    }
    const userIdSet = new Set(userIds);
    loadTestConvIds = [...byConv.entries()].filter(([, members]) => members.every((m) => userIdSet.has(m))).map(([id]) => id);
  }
  console.log(`  ${candidateConvIds.length} conversations touched by load-test users, ${loadTestConvIds.length} are 100% load-test-only (safe to fully delete)`);
  if (loadTestConvIds.length) {
    const { data: msgRows } = await svc.from("messages").select("id").in("conversation_id", loadTestConvIds);
    const msgIds = (msgRows || []).map((r) => r.id);
    if (msgIds.length) {
      await svc.from("message_reactions").delete().in("message_id", msgIds);
      await svc.from("messages").delete().in("id", msgIds);
    }
    console.log(`  messages + reactions: deleted ${msgIds.length} message(s)`);
    await svc.from("conversation_participants").delete().in("conversation_id", loadTestConvIds);
    await svc.from("conversations").delete().in("id", loadTestConvIds);
    console.log(`  conversations: deleted ${loadTestConvIds.length}`);
  }

  // ---- Posts / comments / likes ----
  console.log("\n--- Posts ---");
  if (userIds.length) {
    await deleteWhere("comments (by load-test authors)", "comments", (q) => q.in("author_id", userIds));
    await deleteWhere("post_likes (by load-test users)", "post_likes", (q) => q.in("user_id", userIds));
    const { data: postRows } = await svc.from("posts").select("id").in("author_id", userIds);
    const postIds = (postRows || []).map((r) => r.id);
    if (postIds.length) {
      await svc.from("comments").delete().in("post_id", postIds); // comments from anyone else on a load-test post
      await svc.from("post_likes").delete().in("post_id", postIds);
      await svc.from("posts").delete().in("id", postIds);
    }
    console.log(`  posts: deleted ${postIds.length}`);
  }

  // ---- Clubs / events ----
  console.log("\n--- Clubs & events ---");
  if (userIds.length) await deleteWhere("club_members (load-test users, any club)", "club_members", (q) => q.in("user_id", userIds));
  if (clubIds.length) {
    await svc.from("club_members").delete().in("club_id", clubIds);
    const { error } = await svc.from("clubs").delete().in("id", clubIds);
    console.log(`  clubs: deleted ${clubIds.length}${error ? ` (FAIL: ${error.message})` : ""}`);
  }
  if (userIds.length) {
    await deleteWhere("event_registrations (load-test users, any event)", "event_registrations", (q) => q.in("user_id", userIds));
    await deleteWhere("event_waitlist (load-test users, any event)", "event_waitlist", (q) => q.in("user_id", userIds));
  }
  if (eventIds.length) {
    await svc.from("event_registrations").delete().in("event_id", eventIds);
    await svc.from("event_waitlist").delete().in("event_id", eventIds);
    const { error } = await svc.from("events").delete().in("id", eventIds);
    console.log(`  events: deleted ${eventIds.length}${error ? ` (FAIL: ${error.message})` : ""}`);
  }

  // ---- Lost & found / support tickets ----
  console.log("\n--- Lost & found / support ---");
  if (userIds.length) {
    await deleteWhere("lost_found_items (load-test users)", "lost_found_items", (q) => q.in("user_id", userIds));
    const { data: ticketRows } = await svc.from("support_tickets").select("id").in("user_id", userIds);
    const ticketIds = (ticketRows || []).map((r) => r.id);
    if (ticketIds.length) {
      await svc.from("support_ticket_messages").delete().in("ticket_id", ticketIds);
      await svc.from("support_tickets").delete().in("id", ticketIds);
    }
    console.log(`  support_tickets: deleted ${ticketIds.length}`);
  }

  // ---- Notifications generated as a side effect of all the above ----
  console.log("\n--- Notifications ---");
  if (userIds.length) await deleteWhere("notifications (load-test users)", "notifications", (q) => q.in("user_id", userIds));

  // ---- Finally, the accounts themselves (auth.users; profiles cascades) ----
  console.log("\n--- Auth accounts ---");
  let deletedUsers = 0;
  for (const u of allLoadUsers) {
    const { ok, status, data } = await adminFetch(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
    if (ok) deletedUsers++;
    else console.log(`  [FAIL] delete ${u.email}: ${status} ${JSON.stringify(data)}`);
  }
  console.log(`  deleted ${deletedUsers}/${allLoadUsers.length} accounts`);

  // ---- Verify: nothing referencing these ids should remain anywhere. ----
  console.log("\n--- Verification ---");
  const { count: remainingProfiles } = await svc.from("profiles").select("id", { count: "exact", head: true }).ilike("usn", "1NH22LT%");
  const { count: remainingPosts } = userIds.length ? await svc.from("posts").select("id", { count: "exact", head: true }).in("author_id", userIds) : { count: 0 };
  const { count: remainingClubs } = await svc.from("clubs").select("id", { count: "exact", head: true }).like("name", "LoadTest Club %");
  const { count: remainingEvents } = await svc.from("events").select("id", { count: "exact", head: true }).like("title", "LoadTest Event %");
  const clean = !remainingProfiles && !remainingPosts && !remainingClubs && !remainingEvents;
  console.log(`  remaining load-test profiles=${remainingProfiles ?? 0}, posts=${remainingPosts ?? 0}, clubs=${remainingClubs ?? 0}, events=${remainingEvents ?? 0}`);
  console.log(clean ? "  CLEAN -- no load-test data left behind." : "  NOT CLEAN -- some load-test rows remain, see counts above.");

  if (fs.existsSync(fixturesFile)) fs.unlinkSync(fixturesFile);

  if (!clean) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[cleanup-loadtest-users] fatal:", err);
  process.exit(1);
});
