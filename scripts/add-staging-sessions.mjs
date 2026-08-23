// One-off helper: adds admin/facilities/vendor sessions to
// scripts/.sessions.staging.json (setup-test-users.mjs only ever seeds the 3
// base e2e.alice/bob/carol accounts; tests/live/*.spec.js also needs admin,
// facilities-staff, store and canteen-vendor sessions, which production's
// .sessions.json had accumulated over time but staging's never did). Uses
// the already-known staging credentials from
// scripts/.admin-credentials.staging.local.json (run
// scripts/setup-admin-account.mjs --rotate first if that file doesn't exist
// yet -- the admin account already exists, so a plain run won't write it),
// scripts/.facilities-credentials.staging.local.json and
// scripts/.vendor-credentials.staging.local.json (run
// scripts/setup-vendor-accounts.mjs first if that file doesn't exist yet).
import fs from "node:fs";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, sessionsFile } = resolveTarget();

const admin = JSON.parse(fs.readFileSync("scripts/.admin-credentials.staging.local.json", "utf8"));
const facilities = JSON.parse(fs.readFileSync("scripts/.facilities-credentials.staging.local.json", "utf8"));
const store = fs.existsSync("scripts/.store-credentials.staging.local.json")
  ? JSON.parse(fs.readFileSync("scripts/.store-credentials.staging.local.json", "utf8"))
  : null;
// setup-vendor-accounts.mjs writes an array of {canteenName, email, password,
// label, vendor, isPrintShop} -- covers Udupi/Tango/Munch/Nescafe + the
// print shop, all needed by the vendor-facing live specs
// (05/13/17/20/24/26-*.spec.js).
const vendors = fs.existsSync("scripts/.vendor-credentials.staging.local.json")
  ? JSON.parse(fs.readFileSync("scripts/.vendor-credentials.staging.local.json", "utf8"))
  : [];

const ACCOUNTS = [
  { email: admin.email, password: admin.password, label: "Admin (Sanjay Padmaraj)" },
  { email: facilities.email, password: facilities.password, label: facilities.label },
  ...(store && !store.password.startsWith("(") ? [{ email: store.email, password: store.password, label: store.vendor }] : []),
  ...vendors
    .filter((v) => v.password && !v.password.startsWith("("))
    .map((v) => ({ email: v.email, password: v.password, label: v.vendor || v.label })),
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
