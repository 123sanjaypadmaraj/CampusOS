// One-off script: creates a facilities_staff test account via the Admin
// Auth API and promotes it, for testing the FacilitiesDashboard
// (tickets.read/tickets.update/bookings.approve). Same bootstrapping
// pattern as setup-vendor-accounts.mjs/setup-admin-account.mjs: the role
// change bypasses admin_set_user_role()'s own permission check by using
// the service_role connection directly.
//
// Usage: node scripts/setup-facilities-account.mjs                       (staging)
//        node scripts/setup-facilities-account.mjs --env=production --yes-production
// Prints the email/password to stdout and writes them to the gitignored
// scripts/.facilities-credentials[.staging].local.json.
//
// Passwords are never hardcoded here (an earlier version did -- literal
// "FacilitiesTest@2026" -- same class of finding as setup-admin-account.mjs,
// same fix). This account's password is reset to a known value on every run
// (unlike the vendor/store scripts) because live-check scripts need a
// deterministic credential; that known value is a random one minted on
// first run and persisted/reused from the credentials file after that,
// never a literal in source.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveTarget, runProjectSql } from "./env-target.mjs";

const { SUPABASE_URL, SERVICE_ROLE_KEY, projectRef, root, target } = resolveTarget();
const credentialsFile = target === "production" ? ".facilities-credentials.local.json" : ".facilities-credentials.staging.local.json";
const credentialsPath = path.join(root, "scripts", credentialsFile);

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

function loadOrCreatePassword() {
  if (fs.existsSync(credentialsPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
      if (saved?.password) return saved.password;
    } catch { /* fall through to minting a fresh one */ }
  }
  return generatePassword();
}

const ACCOUNT = { email: "facilities.staff@nhce.edu.in", label: "Facilities Staff", password: loadOrCreatePassword() };

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
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const list = await adminFetch(`/auth/v1/admin/users?page=1&per_page=200`);
  let user = (list.users || []).find((u) => u.email === ACCOUNT.email);

  if (!user) {
    user = await adminFetch(`/auth/v1/admin/users`, {
      method: "POST",
      body: JSON.stringify({
        email: ACCOUNT.email,
        password: ACCOUNT.password,
        email_confirm: true,
        user_metadata: { name: ACCOUNT.label },
      }),
    });
    console.log(`[created] ${ACCOUNT.email}`);
  } else {
    await adminFetch(`/auth/v1/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ password: ACCOUNT.password }),
    });
    console.log(`[exists] ${ACCOUNT.email} -- password reset to known value`);
  }

  await adminFetch(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: ACCOUNT.label }),
  });

  runProjectSql(
    root,
    projectRef,
    `do $$ begin
      perform set_config('campusos.allow_role_change', 'true', true);
      update public.profiles set role = 'facilities_staff' where id = '${user.id}';
    end $$;`
  );
  console.log("[done] promoted to role='facilities_staff'");

  fs.writeFileSync(
    path.join(root, "scripts", credentialsFile),
    JSON.stringify({ ...ACCOUNT, userId: user.id }, null, 2)
  );
  console.log(`email: ${ACCOUNT.email}\npassword: ${ACCOUNT.password}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
