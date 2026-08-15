// One-off script: creates a real Campus Store vendor account (doc §28),
// via the Admin Auth API, promotes it to the 'vendor' role, creates the
// store row and assigns ownership (stores.owner_id), and seeds a handful
// of real items -- same shape/bootstrapping trick as
// scripts/setup-vendor-accounts.mjs (canteens/print shop), now that the
// store finally has its own owned, real backend
// (supabase/migrations/20260815000100_campus_store.sql) instead of a
// hardcoded item array.
//
// Usage: node scripts/setup-store-account.mjs                       (staging)
//        node scripts/setup-store-account.mjs --env=production --yes-production
// Prints the email/password to stdout and writes it to the gitignored
// scripts/.store-credentials[.staging].local.json.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveTarget, runProjectSql } from "./env-target.mjs";

const { SUPABASE_URL, SERVICE_ROLE_KEY, projectRef, root, target } = resolveTarget();
const credentialsFile = target === "production" ? ".store-credentials.local.json" : ".store-credentials.staging.local.json";

const STORE_EMAIL = "campusstore@nhce.edu.in";
const STORE_NAME = "Campus Store";
const STORE_LABEL = "Campus Store";

const SEED_ITEMS = [
  { name: "Engineering Record", price: 45, category: "Stationery" },
  { name: "A4 Sheets — 100", price: 30, category: "Stationery" },
  { name: "Scientific Calculator", price: 650, category: "Electronics" },
  { name: "Black Gel Pen", price: 10, category: "Stationery" },
  { name: "Drawing Sheets", price: 20, category: "Stationery" },
  { name: "Lab Coat", price: 420, category: "Merch" },
];

function generatePassword() {
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

function runSql(sql) {
  runProjectSql(root, projectRef, sql);
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const { data: list } = await adminFetch(`/auth/v1/admin/users?email=${encodeURIComponent(STORE_EMAIL)}`);
  let user = (list?.users || list)?.find?.((u) => u.email === STORE_EMAIL);
  let password = null;

  if (user) {
    console.log(`[skip] ${STORE_EMAIL} already exists (${user.id}) -- password not reset`);
  } else {
    password = generatePassword();
    const { ok, status, data } = await adminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: STORE_EMAIL,
        password,
        email_confirm: true,
        user_metadata: { name: STORE_LABEL },
      }),
    });
    if (!ok) throw new Error(`Failed to create ${STORE_EMAIL}: ${status} ${JSON.stringify(data)}`);
    user = data;
    console.log(`[created] ${STORE_EMAIL} (${user.id})`);
  }

  await adminFetch(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: STORE_LABEL }),
  });

  // Promote to 'vendor' (bypasses protect_profile_role() the same way
  // setup-admin-account.mjs / setup-vendor-accounts.mjs do), then create
  // (or re-own) the store row and seed a handful of real items.
  const itemsSql = SEED_ITEMS
    .map(
      (i) =>
        `insert into public.store_items (store_id, name, price, category)
         select s.id, ${sqlLiteral(i.name)}, ${i.price}, ${sqlLiteral(i.category)}
         from public.stores s where s.name = ${sqlLiteral(STORE_NAME)}
         on conflict (store_id, name) do nothing;`
    )
    .join("\n");

  const sql = `
    do $$ begin
      perform set_config('campusos.allow_role_change', 'true', true);
      update public.profiles set role = 'vendor' where id = ${sqlLiteral(user.id)};
    end $$;

    insert into public.stores (campus_id, owner_id, name, category, subtitle)
    select c.id, ${sqlLiteral(user.id)}, ${sqlLiteral(STORE_NAME)}, 'General', 'Stationery, books, records and academic supplies'
    from public.campuses c
    on conflict (campus_id, name) do update set owner_id = excluded.owner_id;

    ${itemsSql}
  `;
  runSql(sql);
  console.log("[done] promoted to role='vendor', created/owned the store, seeded items");

  const credentials = {
    vendor: STORE_LABEL,
    email: STORE_EMAIL,
    password: password || "(pre-existing account -- password unchanged, not shown)",
    userId: user.id,
  };

  fs.writeFileSync(path.join(root, "scripts", credentialsFile), JSON.stringify(credentials, null, 2));

  console.log("\n=== Campus Store vendor login (sign in via the 'Vendor login' tab) ===\n");
  console.log(`${credentials.vendor.padEnd(16)} ${credentials.email.padEnd(28)} ${credentials.password}`);
  console.log(`\nAlso saved to scripts/${credentialsFile} (gitignored).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
