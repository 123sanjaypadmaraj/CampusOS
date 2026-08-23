// One-off script: creates the requested admin account (Name/USN/Password)
// via the Admin Auth API and promotes it to super_admin. The role change
// bypasses admin_set_user_role()'s own permission check (which needs an
// *existing* admin to call it -- a bootstrapping problem for the very first
// admin) by using the service_role connection directly and toggling the
// same session-local flag protect_profile_role() checks for.
//
// Usage: node scripts/setup-admin-account.mjs                       (staging)
//        node scripts/setup-admin-account.mjs --env=production --yes-production
//        node scripts/setup-admin-account.mjs --rotate [--env=production --yes-production]
// Output: ./scripts/.admin-credentials[.staging].local.json (gitignored).
//
// Passwords are never hardcoded here (an earlier version did -- literal
// "Sanjay@123", committed 8e82349, the same pass that remediated the
// unrelated CampusOS@2026 incident in SECURITY.md; that string has been
// sitting in this public repo's history since and must be treated as
// compromised in every environment it was ever applied to). A fresh random
// password is minted when the account doesn't exist yet, or when --rotate
// is passed for an existing account (resets it via the Admin API and
// overwrites the credentials file) -- run --rotate yourself, in your own
// terminal, for this specific account: it's the real owner's login, not a
// disposable test account, so this script won't reset it without the flag.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveTarget, runProjectSql } from "./env-target.mjs";

const { SUPABASE_URL, SERVICE_ROLE_KEY, projectRef, root, target } = resolveTarget();
const credentialsFile = path.join(root, "scripts", target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json");

function generatePassword() {
  // 12 chars, unambiguous alphabet, guaranteed at least one of each class --
  // same generator as setup-vendor-accounts.mjs/setup-store-account.mjs.
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%";
  const all = upper + lower + digits + symbols;
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
  for (let i = pwd.length; i < 12; i++) pwd += pick(all);
  return pwd.split("").sort(() => crypto.randomInt(3) - 1).join("");
}

const ACCOUNT = { name: "Sanjay Padmaraj", usn: "1NH25CS265" };
const email = `${ACCOUNT.usn.toLowerCase()}@usn.campusos.internal`;

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
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

const shouldRotate = process.argv.includes("--rotate");

async function main() {
  const { data: list } = await adminFetch(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
  let user = (list?.users || list)?.find?.((u) => u.email === email);
  let password = null;

  if (user && !shouldRotate) {
    console.log(`[skip] ${email} already exists (${user.id}) -- password not reset (pass --rotate to reset it)`);
    if (!fs.existsSync(credentialsFile)) {
      console.log(`[warn] ${credentialsFile} doesn't exist -- live-check scripts that need this account's password will fail until you run --rotate once.`);
    }
  } else if (user && shouldRotate) {
    password = generatePassword();
    const { ok, status, data } = await adminFetch(`/auth/v1/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    });
    if (!ok) throw new Error(`Failed to rotate password: ${status} ${JSON.stringify(data)}`);
    console.log(`[rotated] ${email} (${user.id})`);
    fs.writeFileSync(credentialsFile, JSON.stringify({ email, password, userId: user.id }, null, 2) + "\n");
    console.log(`[saved] new password written to ${credentialsFile}`);
  } else {
    password = generatePassword();
    const { ok, status, data } = await adminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: ACCOUNT.name, usn: ACCOUNT.usn },
      }),
    });
    if (!ok) throw new Error(`Failed to create account: ${status} ${JSON.stringify(data)}`);
    user = data;
    console.log(`[created] ${email} (${user.id})`);
    fs.writeFileSync(credentialsFile, JSON.stringify({ email, password, userId: user.id }, null, 2) + "\n");
    console.log(`[saved] password written to ${credentialsFile}`);
  }

  // Ensure name/usn are set even if the row pre-existed with different values.
  await adminFetch(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: ACCOUNT.name, usn: ACCOUNT.usn }),
  });

  const sql = `
    do $$ begin
      perform set_config('campusos.allow_role_change', 'true', true);
      update public.profiles set role = 'super_admin' where id = '${user.id}';
    end $$;
  `;
  runProjectSql(root, projectRef, sql);

  console.log(`\n[done] ${ACCOUNT.name} (USN ${ACCOUNT.usn}) is now super_admin.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
