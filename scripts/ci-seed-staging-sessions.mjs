// CI-only variant of scripts/setup-test-users.mjs + scripts/add-staging-sessions.mjs.
//
// Those two scripts create accounts (service_role) and then read several
// gitignored, machine-local credential files
// (.e2e-credentials.staging.local.json, .facilities-credentials.staging.local.json,
// .vendor-credentials.staging.local.json, .store-credentials.staging.local.json)
// that only exist because a person built up staging's test accounts by hand
// over several sessions -- see docs/ENVIRONMENTS.md. None of that state is
// in the repo, so a fresh GitHub Actions checkout has none of it.
//
// This script doesn't create anything -- staging's test accounts already
// exist. It just signs each of them in and writes scripts/.sessions.staging.json
// in the exact shape tests/live/helpers/realSession.js expects
// ({ [email]: { label, userId, session } }), using ONE consolidated secret
// instead of four local files.
//
// Required env:
//   VITE_SUPABASE_URL              -- staging project URL
//   VITE_SUPABASE_PUBLISHABLE_KEY  -- staging anon key
//   STAGING_E2E_ACCOUNTS           -- JSON array of {email, password, label}
//
// Generate STAGING_E2E_ACCOUNTS locally from the credential files that
// already exist on a machine that's run the staging setup scripts before:
// see scripts/print-ci-staging-accounts-secret.mjs (run it yourself --
// it prints real passwords, so it's deliberately not something an agent
// session should run and echo into a transcript).
import fs from "node:fs";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ACCOUNTS_JSON = process.env.STAGING_E2E_ACCOUNTS;

if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must both be set.");
}
if (!ACCOUNTS_JSON) {
  throw new Error(
    "STAGING_E2E_ACCOUNTS is not set -- see the header comment in this file for how to generate it."
  );
}

let accounts;
try {
  accounts = JSON.parse(ACCOUNTS_JSON);
} catch (err) {
  throw new Error(`STAGING_E2E_ACCOUNTS is not valid JSON: ${err.message}`);
}
if (!Array.isArray(accounts) || accounts.length === 0) {
  throw new Error("STAGING_E2E_ACCOUNTS must be a non-empty JSON array of {email, password, label}.");
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sign-in failed for ${email}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const sessions = {};
for (const { email, password, label } of accounts) {
  if (!email || !password) throw new Error(`Malformed account entry: ${JSON.stringify({ email, label })}`);
  const session = await signIn(email, password);
  sessions[email] = { label: label || email, userId: session.user.id, session };
  console.log(`[signed in] ${email}${label ? ` (${label})` : ""}`);
}

fs.mkdirSync("scripts", { recursive: true });
fs.writeFileSync("scripts/.sessions.staging.json", JSON.stringify(sessions, null, 2));
console.log(`\nWrote ${Object.keys(sessions).length} sessions to scripts/.sessions.staging.json`);
