// Run this YOURSELF, locally -- it prints real staging passwords to stdout.
// Not something an agent session should execute and echo into a transcript.
//
// Assembles the STAGING_E2E_ACCOUNTS secret that scripts/ci-seed-staging-sessions.mjs
// (run by .github/workflows/deploy.yml) needs, from the same gitignored
// local credential files scripts/add-staging-sessions.mjs already reads --
// see that script's header comment for what each file is and how to
// (re)create it if missing (setup-test-users.mjs, setup-admin-account.mjs,
// setup-facilities-account.mjs, setup-store-account.mjs,
// setup-vendor-accounts.mjs, all run with no flags so they target staging).
//
// Usage:
//   node scripts/print-ci-staging-accounts-secret.mjs > /tmp/staging-accounts.json
//   gh secret set STAGING_E2E_ACCOUNTS < /tmp/staging-accounts.json
//   rm /tmp/staging-accounts.json
// or paste the printed JSON directly into GitHub -> repo -> Settings ->
// Secrets and variables -> Actions -> New repository secret.
import fs from "node:fs";

function readJson(path) {
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : null;
}

const e2e = readJson("scripts/.e2e-credentials.staging.local.json") || [];
const facilities = readJson("scripts/.facilities-credentials.staging.local.json");
const store = readJson("scripts/.store-credentials.staging.local.json");
const vendors = readJson("scripts/.vendor-credentials.staging.local.json") || [];

// e2e-credentials.staging.local.json is [{email, password}] with no name/
// label field -- match by email against setup-test-users.mjs's USER_META
// rather than trusting array order.
const E2E_LABELS = {
  "e2e.alice@nhce.edu.in": "Alice Test",
  "e2e.bob@nhce.edu.in": "Bob Test",
  "e2e.carol@nhce.edu.in": "Carol Test",
};
const accounts = [];

for (const u of e2e) {
  if (u?.email && u?.password) accounts.push({ email: u.email, password: u.password, label: E2E_LABELS[u.email] || u.email });
}

accounts.push({ email: "1nh25cs265@usn.campusos.internal", password: "Sanjay@123", label: "Admin (Sanjay Padmaraj)" });

if (facilities?.email && facilities?.password) {
  accounts.push({ email: facilities.email, password: facilities.password, label: facilities.label || "Facilities" });
}
if (store?.email && store?.password && !String(store.password).startsWith("(")) {
  accounts.push({ email: store.email, password: store.password, label: store.vendor || "Store" });
}
for (const v of vendors) {
  if (v?.email && v?.password && !String(v.password).startsWith("(")) {
    accounts.push({ email: v.email, password: v.password, label: v.vendor || v.label || v.email });
  }
}

if (accounts.length === 0) {
  console.error(
    "No staging credential files found. Run the setup-*.mjs scripts listed in this file's header comment first."
  );
  process.exit(1);
}

console.log(JSON.stringify(accounts));
console.error(`\n(${accounts.length} accounts assembled -- printed to stdout, not this stderr line)`);
