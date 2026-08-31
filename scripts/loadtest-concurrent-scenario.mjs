// 2026-08-31 "100+ concurrent users" load test -- fires messaging, posts,
// auth, clubs, events, lost & found, and support tickets AT THE SAME TIME
// across the full scripts/setup-loadtest-users.mjs pool, then checks that
// nothing came back inconsistent (not just "did it 200"). Same anon-key +
// RLS trust boundary a real client hits -- see
// scripts/live-check-messaging-whatsapp-features.mjs for the single-scenario
// version this generalizes.
//
// Defaults to STAGING (see scripts/env-target.mjs) and refuses production
// without --env=production --yes-production, on purpose: this creates a
// nontrivial amount of throwaway data (100+ posts, DMs, tickets, ...) that
// would be real noise in front of real students if it landed on prod.
// scripts/cleanup-loadtest-users.mjs removes everything this script creates.
//
// Usage: node scripts/setup-loadtest-users.mjs --count=110      (run first)
//        node scripts/loadtest-concurrent-scenario.mjs
//        node scripts/loadtest-concurrent-scenario.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, sessionsFile, root, target } = resolveTarget();

const isStaging = sessionsFile.includes(".staging.");
const credsFile = path.join(root, "scripts", `.loadtest-credentials${isStaging ? ".staging" : ""}.local.json`);
const adminCredsFile = path.join(root, "scripts", target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json");

if (!fs.existsSync(credsFile)) {
  throw new Error(`No load-test user pool found. Run "node scripts/setup-loadtest-users.mjs" first (expected ${path.basename(credsFile)}).`);
}
if (!fs.existsSync(adminCredsFile)) {
  throw new Error(`No admin credentials in ${path.basename(adminCredsFile)} -- run "node scripts/setup-admin-account.mjs --rotate" first.`);
}

const creds = JSON.parse(fs.readFileSync(credsFile, "utf8"));
const ADMIN = { email: "1nh25cs265@usn.campusos.internal", password: JSON.parse(fs.readFileSync(adminCredsFile, "utf8")).password };
const stamp = Date.now();

// ---------------------------------------------------------------------
// Low-level: raw REST/RPC calls per-user, same shape as the app itself
// (apikey + Authorization bearer, RLS enforced) -- avoids paying for 100+
// full supabase-js client instances just to fire fetches.
// ---------------------------------------------------------------------
async function tokenSignIn(email, password) {
  const start = performance.now();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ms: performance.now() - start, data };
}

function authHeaders(accessToken, extra = {}) {
  return { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, ...extra };
}

async function callRpc(accessToken, fn, params) {
  const start = performance.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify(params),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, ms: performance.now() - start, data };
  } catch (err) {
    return { ok: false, status: 0, ms: performance.now() - start, error: String(err?.message || err) };
  }
}

async function restInsert(accessToken, table, body) {
  const start = performance.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: authHeaders(accessToken, { Prefer: "return=representation" }),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, ms: performance.now() - start, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, status: 0, ms: performance.now() - start, error: String(err?.message || err) };
  }
}

async function restSelect(accessToken, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: authHeaders(accessToken) });
  const data = await res.json().catch(() => []);
  return { ok: res.ok, status: res.status, data };
}

// ---------------------------------------------------------------------
// Wave runner + reporting
// ---------------------------------------------------------------------
function summarize(label, results) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const latencies = ok.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] : 0);
  const errorsByStatus = {};
  for (const f of failed) {
    const key = f.status === 0 ? `network:${f.error}` : `http:${f.status}:${JSON.stringify(f.data)?.slice(0, 120)}`;
    errorsByStatus[key] = (errorsByStatus[key] || 0) + 1;
  }
  const summary = {
    label,
    total: results.length,
    ok: ok.length,
    failed: failed.length,
    errorRate: results.length ? failed.length / results.length : 0,
    p50: Math.round(pct(0.5)),
    p95: Math.round(pct(0.95)),
    max: latencies.length ? Math.round(latencies[latencies.length - 1]) : 0,
    errorsByStatus,
  };
  console.log(
    `  ${label.padEnd(46)} ok=${String(summary.ok).padStart(4)}/${summary.total}  ` +
    `errRate=${(summary.errorRate * 100).toFixed(1).padStart(5)}%  p50=${String(summary.p50).padStart(5)}ms  p95=${String(summary.p95).padStart(5)}ms` +
    (Object.keys(errorsByStatus).length ? `  errors=${JSON.stringify(errorsByStatus)}` : "")
  );
  return summary;
}

async function main() {
  console.log(`=== CampusOS concurrent load test -- target: ${target} ===`);
  console.log(`Pool: ${creds.length} users from ${path.basename(credsFile)}\n`);
  const report = { target, startedAt: new Date().toISOString(), poolSize: creds.length, phases: [] };

  // -----------------------------------------------------------------
  // Phase 0: admin session sets up one ephemeral test club + event that
  // every load-test user will interact with, clearly marked for cleanup.
  // -----------------------------------------------------------------
  console.log("--- Phase 0: setup (admin session) ---");
  const adminSignIn = await tokenSignIn(ADMIN.email, ADMIN.password);
  if (!adminSignIn.ok) throw new Error(`Admin sign-in failed: ${JSON.stringify(adminSignIn.data)}`);
  const adminToken = adminSignIn.data.access_token;

  const { data: adminProfile } = await restSelect(adminToken, "profiles", `id=eq.${adminSignIn.data.user.id}&select=campus_id`);
  const campusId = adminProfile?.[0]?.campus_id;
  if (!campusId) throw new Error("Could not resolve campus_id from admin profile.");

  const clubName = `LoadTest Club ${stamp}`;
  const club = await restInsert(adminToken, "clubs", { campus_id: campusId, name: clubName, category: "Technology", description: "Ephemeral club for the 100+ concurrent-user load test; deleted by cleanup-loadtest-users.mjs." });
  if (!club.ok) throw new Error(`Failed to create load-test club: ${JSON.stringify(club.data)}`);
  const clubId = club.data.id;
  console.log(`  created club ${clubId} ("${clubName}")`);

  // Capacity intentionally set BELOW the pool size so the concurrent
  // registration wave (Phase 5) actually contends for seats -- the
  // interesting production-safety question isn't "can 110 rows insert" but
  // "does concurrent contention ever oversell capacity" (same class of bug
  // as the food-stock oversell fix from the reliability-at-scale pass).
  const eventCapacity = Math.max(10, Math.floor(creds.length / 2));
  const event = await restInsert(adminToken, "events", {
    campus_id: campusId, club_id: clubId, title: `LoadTest Event ${stamp}`, category: "Workshop",
    event_date: new Date(Date.now() + 7 * 86400_000).toISOString(), place: "Load Test Hall", capacity: eventCapacity,
  });
  if (!event.ok) throw new Error(`Failed to create load-test event: ${JSON.stringify(event.data)}`);
  const eventId = event.data.id;
  console.log(`  created event ${eventId} (capacity=${eventCapacity}, approval_status=${event.data.approval_status})`);

  fs.writeFileSync(path.join(root, "scripts", `.loadtest-fixtures${isStaging ? ".staging" : ""}.json`), JSON.stringify({ clubId, eventId, campusId, stamp }, null, 2));

  // -----------------------------------------------------------------
  // Phase 1: AUTH -- every user in the pool signs in with password, all at
  // once (true concurrency -- this is the actual login-spike measurement).
  // GoTrue's own rate limiter WILL reject some of these under real
  // concurrency (discovered live at 100+ scale) -- that 429 rate is itself
  // the finding, so this phase is reported exactly as it happened, with no
  // retry inside the burst. A separate, gentle backoff pass immediately
  // after recovers enough sessions to still run the rest of the scenario;
  // it is reported as its own line, not folded into the spike number.
  // -----------------------------------------------------------------
  console.log("\n--- Phase 1: concurrent sign-in (auth spike) ---");
  const signInResults = await Promise.all(creds.map((u) => tokenSignIn(u.email, u.password)));
  report.phases.push(summarize("auth: concurrent password sign-in (raw burst)", signInResults));

  const stillNeeded = creds.filter((u, i) => !(signInResults[i].ok && signInResults[i].data?.access_token));
  let recoveredResults = [];
  if (stillNeeded.length) {
    console.log(`  ${stillNeeded.length}/${creds.length} were rejected (mostly rate-limited) -- retrying those gently to fill out the pool for later phases...`);
    recoveredResults = [];
    for (const u of stillNeeded) {
      let r = await tokenSignIn(u.email, u.password);
      for (let attempt = 1; !r.ok && r.status === 429 && attempt <= 6; attempt++) {
        await new Promise((res) => setTimeout(res, 3000 * attempt));
        r = await tokenSignIn(u.email, u.password);
      }
      recoveredResults.push(r);
    }
    report.phases.push(summarize("auth: rate-limited sign-ins recovered via backoff (not part of the spike measurement)", recoveredResults));
  }

  const allResults = creds.map((u, i) => signInResults[i].ok ? signInResults[i] : (recoveredResults[stillNeeded.indexOf(u)] || signInResults[i]));
  const users = creds
    .map((u, i) => ({ email: u.email, ...allResults[i] }))
    .filter((u) => u.ok && u.data?.access_token && u.data?.user?.id)
    .map((u) => ({ email: u.email, token: u.data.access_token, userId: u.data.user.id }));
  console.log(`  ${users.length}/${creds.length} users have a usable session for the rest of the run`);
  if (users.length < 2) throw new Error("Too few signed-in users to run the rest of the scenario.");

  // -----------------------------------------------------------------
  // Phase 2: POSTS -- everyone publishes a post concurrently, then everyone
  // concurrently likes + comments on ONE shared post (real write contention
  // on the same rows, not just N independent inserts).
  // -----------------------------------------------------------------
  console.log("\n--- Phase 2: posts (concurrent create, then concurrent like/comment on one post) ---");
  const postResults = await Promise.all(users.map((u) =>
    restInsert(u.token, "posts", { author_id: u.userId, campus_id: campusId, type: "General", title: `LoadTest post ${stamp}`, content: `Load test content from ${u.email}`, tags: ["loadtest"], image_urls: [] })
  ));
  report.phases.push(summarize("posts: concurrent create", postResults));
  const sharedPostId = postResults.find((r) => r.ok)?.data?.id;

  if (sharedPostId) {
    const likeResults = await Promise.all(users.map((u) => restInsert(u.token, "post_likes", { post_id: sharedPostId, user_id: u.userId })));
    report.phases.push(summarize("posts: concurrent likes on one post", likeResults));
    const commentResults = await Promise.all(users.map((u) => restInsert(u.token, "comments", { post_id: sharedPostId, author_id: u.userId, content: `concurrent comment from ${u.email}` })));
    report.phases.push(summarize("posts: concurrent comments on one post", commentResults));

    const { data: likeRows } = await restSelect(adminToken, "post_likes", `post_id=eq.${sharedPostId}&select=user_id`);
    const dupeCheck = Array.isArray(likeRows) ? likeRows.length === new Set(likeRows.map((r) => r.user_id)).size : null;
    console.log(`  invariant check: ${likeRows?.length ?? "?"} like rows, ${dupeCheck === false ? "DUPLICATES FOUND" : "no duplicate (post_id,user_id) pairs"}`);
  }

  // -----------------------------------------------------------------
  // Phase 3: MESSAGING -- concurrent DM pairs + a handful of group chats,
  // with concurrent sends + reactions inside each group.
  // -----------------------------------------------------------------
  console.log("\n--- Phase 3: messaging (concurrent DMs + group chat) ---");
  const dmPairs = [];
  for (let i = 0; i + 1 < users.length; i += 2) dmPairs.push([users[i], users[i + 1]]);
  const dmConvs = await Promise.all(dmPairs.map(([a, b]) => callRpc(a.token, "start_conversation", { p_other_user: b.userId, p_listing_id: null })));
  report.phases.push(summarize("messaging: concurrent start_conversation (DM)", dmConvs));
  const dmSends = await Promise.all(dmPairs.map(([a], i) => {
    const convId = dmConvs[i]?.data;
    if (!convId) return Promise.resolve({ ok: false, status: 0, ms: 0, error: "no conversation id" });
    return callRpc(a.token, "send_message", { p_conversation_id: convId, p_body: `concurrent DM load test ${stamp}`, p_attachment_path: null, p_reply_to_message_id: null });
  }));
  report.phases.push(summarize("messaging: concurrent send_message (DM)", dmSends));

  // Group chats: chunks of ~8 users per group.
  const GROUP_SIZE = 8;
  const groups = [];
  for (let i = 0; i + 1 < users.length; i += GROUP_SIZE) groups.push(users.slice(i, i + GROUP_SIZE));
  const groupCreateResults = await Promise.all(groups.map((g) =>
    callRpc(g[0].token, "create_group_conversation", { p_title: `LoadTest Group ${stamp} #${groups.indexOf(g)}`, p_member_ids: g.slice(1).map((m) => m.userId) })
  ));
  report.phases.push(summarize("messaging: concurrent create_group_conversation", groupCreateResults));

  const groupSendTasks = [];
  const groupReactTasks = [];
  groups.forEach((g, gi) => {
    const convId = groupCreateResults[gi]?.data;
    if (!convId) return;
    g.forEach((m) => groupSendTasks.push({ m, convId }));
  });
  const groupSendResults = await Promise.all(groupSendTasks.map(({ m, convId }) => callRpc(m.token, "send_message", { p_conversation_id: convId, p_body: `hi from ${m.email}`, p_attachment_path: null, p_reply_to_message_id: null })));
  report.phases.push(summarize("messaging: concurrent send_message (group, all members at once)", groupSendResults));

  groupSendTasks.forEach(({ m }, i) => {
    const msgId = groupSendResults[i]?.data?.id;
    if (msgId) groupReactTasks.push({ m, msgId });
  });
  const groupReactResults = await Promise.all(groupReactTasks.map(({ m, msgId }) => callRpc(m.token, "toggle_message_reaction", { p_message_id: msgId, p_emoji: "👍" })));
  report.phases.push(summarize("messaging: concurrent toggle_message_reaction", groupReactResults));

  // -----------------------------------------------------------------
  // Phase 4: CLUBS -- everyone joins the ephemeral test club concurrently.
  // -----------------------------------------------------------------
  console.log("\n--- Phase 4: clubs (concurrent join) ---");
  const joinResults = await Promise.all(users.map((u) => restInsert(u.token, "club_members", { club_id: clubId, user_id: u.userId, role: "member" })));
  report.phases.push(summarize("clubs: concurrent join_club", joinResults));
  const { data: memberRows } = await restSelect(adminToken, "club_members", `club_id=eq.${clubId}&select=user_id`);
  console.log(`  invariant check: ${memberRows?.length ?? "?"} member rows for ${users.length} joiners (dupes on (club_id,user_id) would fail the unique constraint, not silently pass)`);

  // -----------------------------------------------------------------
  // Phase 5: EVENTS -- everyone registers concurrently for a capacity-
  // constrained event; the real check is confirmed <= capacity afterward.
  // -----------------------------------------------------------------
  console.log("\n--- Phase 5: events (concurrent register, capacity < pool size on purpose) ---");
  const regResults = await Promise.all(users.map((u) =>
    callRpc(u.token, "register_for_event", { p_event_id: eventId, p_contact_phone: "9999999999", p_contact_name: u.email, p_roll_number: null, p_department: null })
  ));
  report.phases.push(summarize("events: concurrent register_for_event", regResults));
  // Waitlisted registrants don't get a row in event_registrations at all --
  // register_for_event() routes them into the separate event_waitlist table
  // instead (see supabase/migrations/20260831000800_paid_events.sql) -- so
  // checking both is required for an honest "nothing got lost" invariant.
  const { data: regRows } = await restSelect(adminToken, "event_registrations", `event_id=eq.${eventId}&select=status`);
  const { data: waitlistRows } = await restSelect(adminToken, "event_waitlist", `event_id=eq.${eventId}&select=user_id`);
  const confirmedCount = (regRows || []).filter((r) => r.status === "confirmed").length;
  const waitlistedCount = (waitlistRows || []).length;
  const oversold = confirmedCount > eventCapacity;
  const lost = users.length - confirmedCount - waitlistedCount;
  console.log(`  invariant check: confirmed=${confirmedCount}, waitlisted=${waitlistedCount}, capacity=${eventCapacity} -> ${oversold ? "OVERSOLD -- BUG" : "capacity respected under concurrency"}${lost !== 0 ? ` -- ${lost} registrants UNACCOUNTED FOR (neither confirmed nor waitlisted) -- BUG` : ""}`);
  report.eventCapacityCheck = { capacity: eventCapacity, confirmed: confirmedCount, waitlisted: waitlistedCount, oversold, lost };

  // -----------------------------------------------------------------
  // Phase 6: LOST & FOUND -- a subset (every 5th user) files a report
  // concurrently (this is a lower-volume real-world action, not everyone).
  // -----------------------------------------------------------------
  console.log("\n--- Phase 6: lost & found (concurrent create, subset) ---");
  const lfUsers = users.filter((_, i) => i % 5 === 0);
  const lfResults = await Promise.all(lfUsers.map((u) =>
    restInsert(u.token, "lost_found_items", { campus_id: campusId, user_id: u.userId, item_type: "lost", title: `LoadTest item ${stamp} ${u.email}`, description: "load test item", category: "Other", location: "Load Test Hall" })
  ));
  report.phases.push(summarize(`lost&found: concurrent create (${lfUsers.length} users)`, lfResults));

  // -----------------------------------------------------------------
  // Phase 7: SUPPORT TICKETS -- a subset (every 10th user) files a ticket
  // concurrently.
  // -----------------------------------------------------------------
  console.log("\n--- Phase 7: support tickets (concurrent create, subset) ---");
  const ticketUsers = users.filter((_, i) => i % 10 === 0);
  const ticketResults = await Promise.all(ticketUsers.map((u) =>
    callRpc(u.token, "create_support_ticket", { p_category: "technical", p_subject: `LoadTest ticket ${stamp}`, p_description: "Concurrent load test ticket", p_attachment_url: null })
  ));
  report.phases.push(summarize(`support: concurrent create_support_ticket (${ticketUsers.length} users)`, ticketResults));

  // -----------------------------------------------------------------
  report.finishedAt = new Date().toISOString();
  const overallErrorRate = report.phases.reduce((a, p) => a + p.failed, 0) / report.phases.reduce((a, p) => a + p.total, 0);
  report.overallErrorRate = overallErrorRate;

  const outPath = path.join(root, "scripts", `.loadtest-scenario-${target}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Overall error rate across all phases: ${(overallErrorRate * 100).toFixed(2)}%`);
  console.log(`Event capacity respected under concurrency: ${oversold ? "NO -- BUG FOUND" : "YES"}`);
  console.log(`Full report: ${outPath}`);
  console.log(`\nNext: node scripts/cleanup-loadtest-users.mjs${target === "production" ? " --env=production --yes-production" : ""}`);
}

main().catch((err) => {
  console.error("[loadtest-concurrent-scenario] fatal:", err);
  process.exit(1);
});
