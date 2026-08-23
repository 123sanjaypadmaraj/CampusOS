// tests/live/helpers/resolveAdminPassword.js
//
// The real admin account's (1nh25cs265@usn.campusos.internal) password used
// to be hardcoded as the literal "Sanjay@123" directly in
// 03-usn-login-and-cms.spec.js -- the one spec that has to type it into the
// login form itself rather than reusing a pre-seeded session. That literal
// sat in this public repo since 8e823497 (14 Aug); see SECURITY.md's
// 2026-08-23 entry. Read it from the gitignored credentials file
// scripts/setup-admin-account.mjs writes instead, same convention as
// resolveServiceRoleKey.js. Keep in sync with scripts/env-target.mjs.

import fs from "node:fs";
import path from "node:path";

const PROD_PROJECT_REF = "dzjzjlylsfpmymkcavrq";

export function resolveAdminPassword(root, supabaseUrl) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const fileName = projectRef === PROD_PROJECT_REF ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
  const filePath = path.join(root, "scripts", fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing scripts/${fileName} for project ${projectRef} -- run "node scripts/setup-admin-account.mjs --rotate" first (the account already exists, so a plain run won't write this file).`);
  }
  const { password } = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!password) throw new Error(`scripts/${fileName} has no password field.`);
  return password;
}
