// One-off script: creates 3 confirmed test student accounts via the Admin
// Auth API (service_role key, read from .service_role_key.local -- never
// committed) and signs each in to get a real session, which is then used to
// seed Playwright browser contexts for live multi-user testing.
//
// Usage: node scripts/setup-test-users.mjs
// Output: ./scripts/.sessions.json (gitignored) -- one real session per user.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function readEnvVar(name) {
  const contents = fs.readFileSync(path.join(root, ".env"), "utf8");
  const match = contents.match(new RegExp(`^${name}=(.+)$`, "m"));
  return match?.[1]?.trim();
}

const SUPABASE_URL = readEnvVar("VITE_SUPABASE_URL");
const ANON_KEY = readEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY");
const SERVICE_ROLE_KEY = fs.readFileSync(path.join(root, ".service_role_key.local"), "utf8").trim();

const USERS = [
  { email: "e2e.alice@nhce.edu.in", password: "TestPass!2026Alice", name: "Alice Test", usn: "1NH22CS201", course: "Computer Science & Engineering", year: "3rd Year" },
  { email: "e2e.bob@nhce.edu.in", password: "TestPass!2026Bob", name: "Bob Test", usn: "1NH22IS202", course: "Information Science & Engineering", year: "2nd Year" },
  { email: "e2e.carol@nhce.edu.in", password: "TestPass!2026Carol", name: "Carol Test", usn: "1NH22EC203", course: "Electronics & Communication", year: "4th Year" },
];

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

  fs.writeFileSync(path.join(__dirname, ".sessions.json"), JSON.stringify(sessions, null, 2));
  console.log(`\nWrote ${Object.keys(sessions).length} sessions to scripts/.sessions.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
