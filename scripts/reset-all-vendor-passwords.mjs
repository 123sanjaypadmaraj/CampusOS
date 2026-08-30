// One-off script: resets the password for all 5 known vendor manager
// accounts (4 canteens + print shop, see scripts/setup-vendor-accounts.mjs)
// via the Admin Auth API. Does NOT touch account records, roles, or
// ownership -- only the password. Requested explicitly with "very simple"
// passwords accepted (short, no symbols) instead of this repo's usual
// generatePassword() scheme -- see scripts/setup-vendor-accounts.mjs for
// that stronger default if this ever needs reverting to it.
//
// Usage: node scripts/reset-all-vendor-passwords.mjs                       (staging)
//        node scripts/reset-all-vendor-passwords.mjs --env=production --yes-production
// Prints emails/passwords to stdout and writes them to the gitignored
// scripts/.vendor-credentials[.staging].local.json (overwrites the existing
// file from setup-vendor-accounts.mjs).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, SERVICE_ROLE_KEY, root, target } = resolveTarget();
const credentialsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";

const VENDORS = [
  { email: "udupi.canteen@nhce.edu.in", label: "Udupi Canteen" },
  { email: "tango.canteen@nhce.edu.in", label: "Tango Canteen" },
  { email: "munch.canteen@nhce.edu.in", label: "Munch Canteen" },
  { email: "nescafe.canteen@nhce.edu.in", label: "Nescafe Canteen" },
  { email: "printshop@nhce.edu.in", label: "Print Shop" },
];

// Short, no symbols, unambiguous alphabet (no 0/O/1/l/I) -- easy to read
// aloud or type on a shop tablet, unique per account so one leak doesn't
// give away the rest.
function generateSimplePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 8; i++) pwd += chars[crypto.randomInt(chars.length)];
  return pwd;
}

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

async function resetOne(vendor) {
  const { data: list } = await adminFetch(`/auth/v1/admin/users?email=${encodeURIComponent(vendor.email)}`);
  const user = (list?.users || list)?.find?.((u) => u.email === vendor.email);
  if (!user) throw new Error(`No user found for ${vendor.email} on ${target}`);

  const password = generateSimplePassword();
  const { ok, status, data } = await adminFetch(`/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });
  if (!ok) throw new Error(`Password reset failed for ${vendor.email}: ${status} ${JSON.stringify(data)}`);

  console.log(`[reset] ${vendor.email} (${user.id})`);
  return { vendor: vendor.label, email: vendor.email, password, userId: user.id };
}

async function main() {
  const results = [];
  for (const vendor of VENDORS) {
    results.push(await resetOne(vendor));
  }

  fs.writeFileSync(
    path.join(root, "scripts", credentialsFile),
    JSON.stringify(results, null, 2)
  );

  console.log(`\n=== Vendor login credentials (${target}, sign in via the 'Vendor login' tab) ===\n`);
  for (const c of results) {
    console.log(`${c.vendor.padEnd(16)} ${c.email.padEnd(28)} ${c.password}`);
  }
  console.log(`\nAlso saved to scripts/${credentialsFile} (gitignored).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
