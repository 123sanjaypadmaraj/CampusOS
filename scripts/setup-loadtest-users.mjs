// One-off script: creates (or reuses) a pool of N confirmed test student
// accounts via the Admin Auth API for the 2026-08-31 "100+ concurrent users"
// load test -- a bigger, disposable sibling of scripts/setup-test-users.mjs's
// 3-account pool (that pool -- e2e.alice/bob/carol -- is reserved for other
// live-checks and is deliberately left untouched here).
//
// Namespaced separately (e2e.load###@nhce.edu.in, USN shape 1NH22LT###) so
// every row this pool ever touches is unambiguously identifiable and safe
// for scripts/cleanup-loadtest-users.mjs to find and delete later -- see
// docs/ENVIRONMENTS.md and the env-target.mjs staging/production guard.
//
// Deliberately does NOT sign each account in here (an earlier version did --
// that meant 110 password-grant calls at setup time, which collided with
// GoTrue's own auth rate limiter for no benefit, since nothing downstream
// reads the session it produced). The real concurrent sign-in -- the actual
// "auth spike" this load test is meant to exercise -- happens once, as true
// concurrency, in scripts/loadtest-concurrent-scenario.mjs's Phase 1.
//
// Idempotent: re-running reuses existing accounts and keeps their password
// in sync with the credentials file instead of erroring or minting
// duplicates that drift out of sync with each other.
//
// Usage: node scripts/setup-loadtest-users.mjs --count=110              (staging, default)
//        node scripts/setup-loadtest-users.mjs --count=110 --env=production --yes-production

import fs from "node:fs";
import crypto from "node:crypto";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, SERVICE_ROLE_KEY, sessionsFile, root } = resolveTarget();

const args = process.argv.slice(2);
const COUNT = Number(args.find((a) => a.startsWith("--count="))?.split("=")[1] || 110);
const CONCURRENCY = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] || 10);

const isStaging = sessionsFile.includes(".staging.");
const credsFile = `${root}/scripts/.loadtest-credentials${isStaging ? ".staging" : ""}.local.json`;

const COURSES = [
  "Computer Science & Engineering",
  "Information Science & Engineering",
  "Electronics & Communication",
  "Mechanical Engineering",
  "Civil Engineering",
];
const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

function userMeta(i) {
  const n = String(i).padStart(3, "0");
  return {
    email: `e2e.load${n}@nhce.edu.in`,
    name: `LoadTest User ${n}`,
    usn: `1NH22LT${n}`, // matches USN_PATTERN (\dNH\d{2}[A-Za-z]{2}\d{3}); "LT" marks it as load-test data everywhere it surfaces
    course: COURSES[i % COURSES.length],
    year: YEARS[i % YEARS.length],
  };
}

function loadOrCreatePasswords(emails) {
  let saved = [];
  if (fs.existsSync(credsFile)) {
    try { saved = JSON.parse(fs.readFileSync(credsFile, "utf8")); } catch { saved = []; }
  }
  const byEmail = new Map(saved.map((r) => [r.email, r.password]));
  return emails.map((email) => byEmail.get(email) || `Rk_${crypto.randomBytes(18).toString("base64url")}!9`);
}

const USER_META = Array.from({ length: COUNT }, (_, i) => userMeta(i + 1));
const passwords = loadOrCreatePasswords(USER_META.map((u) => u.email));
const USERS = USER_META.map((u, i) => ({ ...u, password: passwords[i] }));

// Persist passwords BEFORE any network calls -- previously this only
// happened at the very end of main(), so a mid-run crash (e.g. a 429) lost
// every freshly-minted password for accounts the run had already created,
// leaving them permanently out of sync with a re-run's freshly-generated
// ones. Discovered live during the 2026-08-31 load test.
fs.writeFileSync(credsFile, JSON.stringify(USERS.map((u) => ({ email: u.email, password: u.password })), null, 2) + "\n");

async function adminFetch(pathname, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      ...options.headers,
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// The admin users REST endpoint's `?email=` query param is silently
// ignored on this project (confirmed live: it just returns an arbitrary
// default-sized page, unfiltered) -- so per-user lookups were missing
// already-created accounts once the project had more than one page of
// users, and this script would then try to (re)create them and get a 422
// email_exists. Fetch every existing user ONCE up front, paginated, and
// filter client-side instead.
async function fetchAllUsersByEmail() {
  const byEmail = new Map();
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data } = await adminFetch(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`);
    const list = data?.users || [];
    for (const u of list) byEmail.set(u.email, u);
    if (list.length < perPage) break;
    page++;
  }
  return byEmail;
}

async function createOrGetUser(u, existingByEmail) {
  let existing = existingByEmail.get(u.email);
  if (existing) {
    // Self-healing: if a previous run created this account but crashed
    // before the credentials file was persisted, the account's real
    // password and this run's in-memory password can disagree. Force them
    // back in sync (admin API, no rate-limited password-grant call needed)
    // rather than leaving a permanently unsignable account.
    const { ok } = await adminFetch(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({ password: u.password }),
    });
    if (!ok) throw new Error(`Failed to sync password for existing user ${u.email}`);
    return { user: existing, created: false };
  }
  const { ok, status, data } = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { name: u.name, usn: u.usn, course: u.course, year: u.year },
    }),
  });
  if (!ok) {
    // Belt-and-suspenders for the stale-page issue above: if the account
    // actually exists despite our upfront listing missing it (e.g. it was
    // created moments earlier by a different process), fall back to
    // syncing its password instead of hard-failing the whole run.
    if (status === 422 && data?.error_code === "email_exists") {
      const byEmail = await fetchAllUsersByEmail();
      const found = byEmail.get(u.email);
      if (found) {
        const { ok: syncOk } = await adminFetch(`/auth/v1/admin/users/${found.id}`, { method: "PUT", body: JSON.stringify({ password: u.password }) });
        if (!syncOk) throw new Error(`Failed to sync password for existing user ${u.email} (post-422 recovery)`);
        return { user: found, created: false };
      }
    }
    throw new Error(`Failed to create ${u.email}: ${status} ${JSON.stringify(data)}`);
  }
  return { user: data, created: true };
}

async function setupOne(u, existingByEmail) {
  const { user, created } = await createOrGetUser(u, existingByEmail);
  await adminFetch(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: u.name, usn: u.usn, course: u.course, year: u.year }),
  });
  return { email: u.email, label: u.name, userId: user.id, created };
}

// Bounded-concurrency pool -- 100+ admin API calls fired all at once is more
// likely to trip Postgres/pooler connection limits on the free tier
// (see docs/DISASTER_RECOVERY.md) than to actually save meaningful time here.
async function pool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function main() {
  console.log(`[setup-loadtest-users] provisioning ${COUNT} accounts (concurrency=${CONCURRENCY})...`);
  console.log(`[setup-loadtest-users] listing existing accounts (paginated) to check for reuse...`);
  const existingByEmail = await fetchAllUsersByEmail();
  console.log(`[setup-loadtest-users] project has ${existingByEmail.size} total accounts on file.`);

  let createdCount = 0;
  let reusedCount = 0;
  const results = await pool(
    USERS,
    async (u, i) => {
      const r = await setupOne(u, existingByEmail);
      if (r.created) createdCount++; else reusedCount++;
      if ((i + 1) % 20 === 0 || i === USERS.length - 1) {
        console.log(`  ... ${i + 1}/${USERS.length} ready`);
      }
      return r;
    },
    CONCURRENCY
  );

  console.log(`\n[setup-loadtest-users] done: ${createdCount} created, ${reusedCount} reused, ${results.length} total.`);
  console.log(`[setup-loadtest-users] credentials -> ${credsFile}`);
}

main().catch((err) => {
  console.error("[setup-loadtest-users] fatal:", err);
  process.exit(1);
});
