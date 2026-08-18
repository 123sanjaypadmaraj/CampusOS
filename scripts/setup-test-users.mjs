// One-off script: creates 3 confirmed test student accounts via the Admin
// Auth API (service_role key, read from .service_role_key.local -- never
// committed) and signs each in to get a real session, which is then used to
// seed Playwright browser contexts for live multi-user testing.
//
// Usage: node scripts/setup-test-users.mjs                       (staging)
//        node scripts/setup-test-users.mjs --env=production --yes-production
// Output: ./scripts/.sessions[.staging].json (gitignored) -- one real session per user.
//
// Passwords are never hardcoded here (an earlier version did -- see the
// 2026-08-18 credential-rotation incident in SECURITY.md; those literal
// strings are compromised and must never be reused). Passwords live in the
// gitignored `.e2e-credentials[.staging].local.json`, generated on first run
// and reused after that; only if that file doesn't exist yet does this
// script mint a fresh random one for account creation.

import fs from "node:fs";
import crypto from "node:crypto";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, sessionsFile } = resolveTarget();

const isStaging = sessionsFile.includes(".staging.");
const credsFile = sessionsFile.replace(/\.sessions(\.staging)?\.json$/, `.e2e-credentials${isStaging ? ".staging" : ""}.local.json`);

function loadOrCreatePasswords(emails) {
  let saved = [];
  if (fs.existsSync(credsFile)) {
    try { saved = JSON.parse(fs.readFileSync(credsFile, "utf8")); } catch { saved = []; }
  }
  const byEmail = new Map(saved.map((r) => [r.email, r.password]));
  return emails.map((email) => byEmail.get(email) || `Rk_${crypto.randomBytes(18).toString("base64url")}!9`);
}

const USER_META = [
  { email: "e2e.alice@nhce.edu.in", name: "Alice Test", usn: "1NH22CS201", course: "Computer Science & Engineering", year: "3rd Year" },
  { email: "e2e.bob@nhce.edu.in", name: "Bob Test", usn: "1NH22IS202", course: "Information Science & Engineering", year: "2nd Year" },
  { email: "e2e.carol@nhce.edu.in", name: "Carol Test", usn: "1NH22EC203", course: "Electronics & Communication", year: "4th Year" },
];
const passwords = loadOrCreatePasswords(USER_META.map((u) => u.email));
const USERS = USER_META.map((u, i) => ({ ...u, password: passwords[i] }));

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

async function findUserByEmail(email) {
  const { data } = await adminFetch(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
  const list = data?.users || data;
  return Array.isArray(list) ? list.find((u) => u.email === email) : null;
}

async function createOrGetUser(u) {
  let existing = await findUserByEmail(u.email);
  if (existing) {
    console.log(`[skip] ${u.email} already exists (${existing.id})`);
    return existing;
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
  if (!ok) throw new Error(`Failed to create ${u.email}: ${status} ${JSON.stringify(data)}`);
  console.log(`[created] ${u.email} (${data.id})`);
  return data;
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const sessions = {};
  for (const u of USERS) {
    const user = await createOrGetUser(u);

    // Give each test user a distinct display name directly (service role
    // bypasses RLS) so they're visually distinguishable in the UI.
    await adminFetch(`/rest/v1/profiles?id=eq.${user.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ name: u.name, usn: u.usn, course: u.course, year: u.year }),
    });

    const session = await signIn(u.email, u.password);
    sessions[u.email] = { label: u.name, userId: user.id, session };
    console.log(`[signed in] ${u.email} as "${u.name}"`);
  }

  fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
  console.log(`\nWrote ${Object.keys(sessions).length} sessions to ${sessionsFile}`);

  // Persist whatever password each user actually has (gitignored) so a
  // re-run reuses it instead of minting a new one -- and so it's never the
  // hardcoded literal this script used to ship in git history.
  fs.writeFileSync(
    credsFile,
    JSON.stringify(USERS.map((u) => ({ email: u.email, password: u.password })), null, 2) + "\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
