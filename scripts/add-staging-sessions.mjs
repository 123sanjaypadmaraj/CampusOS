// One-off helper: adds admin/facilities sessions to scripts/.sessions.staging.json
// (setup-test-users.mjs only ever seeds the 3 base e2e.alice/bob/carol
// accounts; tests/live/*.spec.js also needs admin + facilities-staff
// sessions, which production's .sessions.json had accumulated over time but
// staging's never did). Uses the already-known staging credentials from
// scripts/setup-admin-account.mjs and scripts/.facilities-credentials.staging.local.json.
import fs from "node:fs";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, sessionsFile } = resolveTarget();

const facilities = JSON.parse(fs.readFileSync("scripts/.facilities-credentials.staging.local.json", "utf8"));
const store = fs.existsSync("scripts/.store-credentials.staging.local.json")
  ? JSON.parse(fs.readFileSync("scripts/.store-credentials.staging.local.json", "utf8"))
  : null;

const ACCOUNTS = [
  { email: "1nh25cs265@usn.campusos.internal", password: "Sanjay@123", label: "Admin (Sanjay Padmaraj)" },
  { email: facilities.email, password: facilities.password, label: facilities.label },
  ...(store && !store.password.startsWith("(") ? [{ email: store.email, password: store.password, label: store.vendor }] : []),
];

async function signIn({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(body)}`);
  return body;
}

const sessions = fs.existsSync(sessionsFile) ? JSON.parse(fs.readFileSync(sessionsFile, "utf8")) : {};

for (const acc of ACCOUNTS) {
  const session = await signIn(acc);
  sessions[acc.email] = { label: acc.label, userId: session.user.id, session };
  console.log(`[added] ${acc.email} (${session.user.id})`);
}

fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
console.log(`\nWrote ${Object.keys(sessions).length} sessions to ${sessionsFile}`);
