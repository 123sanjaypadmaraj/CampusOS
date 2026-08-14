// One-off script: creates the 5 vendor accounts (4 canteens + print shop)
// for the vendor dashboard (doc §16), via the Admin Auth API, promotes each
// to the 'vendor' role, and assigns ownership (canteens.owner_id /
// print_rate_card.owner_id) so each account only sees and edits its own
// menu/pricing under the RLS added in
// supabase/migrations/20260814002200_vendor_dashboard.sql.
//
// The role change bypasses admin_set_user_role()'s own permission check
// (same bootstrapping problem setup-admin-account.mjs solves) by using the
// service_role connection directly and toggling the same session-local flag
// protect_profile_role() checks for.
//
// Usage: node scripts/setup-vendor-accounts.mjs
// Prints emails/passwords to stdout and writes them to the gitignored
// scripts/.vendor-credentials.local.json (same pattern as
// scripts/.sessions.json) so they aren't lost after this terminal closes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function readEnvVar(name) {
  return fs.readFileSync(path.join(root, ".env"), "utf8").match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
}

const SUPABASE_URL = readEnvVar("VITE_SUPABASE_URL");
const SERVICE_ROLE_KEY = fs.readFileSync(path.join(root, ".service_role_key.local"), "utf8").trim();

// Domain matches the campus's real email domain (nhce.edu.in) so these read
// as real institutional shop accounts, not throwaway test addresses.
const VENDORS = [
  { canteenName: "Udupi", email: "udupi.canteen@nhce.edu.in", label: "Udupi Canteen" },
  { canteenName: "Tango", email: "tango.canteen@nhce.edu.in", label: "Tango Canteen" },
  { canteenName: "Munch", email: "munch.canteen@nhce.edu.in", label: "Munch Canteen" },
  { canteenName: "Nescafe", email: "nescafe.canteen@nhce.edu.in", label: "Nescafe Canteen" },
  { canteenName: null, email: "printshop@nhce.edu.in", label: "Print Shop", isPrintShop: true },
];

function generatePassword() {
  // 12 chars, unambiguous alphabet, guaranteed at least one of each class
  // so it always clears the "Password must be at least 8 characters" style
  // checks elsewhere in the app plus a bit more.
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

async function ensureVendorUser(vendor) {
  const { data: list } = await adminFetch(`/auth/v1/admin/users?email=${encodeURIComponent(vendor.email)}`);
  let user = (list?.users || list)?.find?.((u) => u.email === vendor.email);
  let password = null;

  if (user) {
    console.log(`[skip] ${vendor.email} already exists (${user.id}) -- password not reset`);
  } else {
    password = generatePassword();
    const { ok, status, data } = await adminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: vendor.email,
        password,
        email_confirm: true,
        user_metadata: { name: vendor.label },
      }),
    });
    if (!ok) throw new Error(`Failed to create ${vendor.email}: ${status} ${JSON.stringify(data)}`);
    user = data;
    console.log(`[created] ${vendor.email} (${user.id})`);
  }

  // Ensure the profile's display name is right even if the row pre-existed.
  await adminFetch(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: vendor.label }),
  });

  return { userId: user.id, password };
}

function runSql(sql) {
  const sqlPath = path.join(root, "_vendor_setup.sql");
  fs.writeFileSync(sqlPath, sql);
  try {
    execFileSync("npx", ["supabase", "db", "query", "--linked", "--file", sqlPath], { cwd: root, stdio: "inherit", shell: true });
  } finally {
    fs.unlinkSync(sqlPath);
  }
}

async function main() {
  const results = [];

  for (const vendor of VENDORS) {
    const { userId, password } = await ensureVendorUser(vendor);
    results.push({ ...vendor, userId, password });
  }

  // Promote every account to 'vendor' in one batch (bypasses
  // protect_profile_role() the same way setup-admin-account.mjs does).
  const roleSql = `
    do $$ begin
      perform set_config('campusos.allow_role_change', 'true', true);
      update public.profiles set role = 'vendor'
        where id in (${results.map((r) => `'${r.userId}'`).join(",")});
    end $$;
  `;
  runSql(roleSql);
  console.log("[done] promoted all 5 accounts to role='vendor'");

  // Assign ownership: canteens.owner_id for the 4 canteens, print_rate_card
  // .owner_id for the print shop's 2 rate rows.
  const ownershipSql = results
    .map((r) =>
      r.isPrintShop
        ? `update public.print_rate_card set owner_id = '${r.userId}';`
        : `update public.canteens set owner_id = '${r.userId}' where name = '${r.canteenName}';`
    )
    .join("\n");
  runSql(ownershipSql);
  console.log("[done] assigned canteen/print-rate-card ownership");

  const credentials = results.map((r) => ({
    vendor: r.label,
    email: r.email,
    password: r.password || "(pre-existing account -- password unchanged, not shown)",
    userId: r.userId,
  }));

  fs.writeFileSync(
    path.join(root, "scripts", ".vendor-credentials.local.json"),
    JSON.stringify(credentials, null, 2)
  );

  console.log("\n=== Vendor login credentials (sign in via the 'Vendor login' tab) ===\n");
  for (const c of credentials) {
    console.log(`${c.vendor.padEnd(16)} ${c.email.padEnd(28)} ${c.password}`);
  }
  console.log("\nAlso saved to scripts/.vendor-credentials.local.json (gitignored).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
