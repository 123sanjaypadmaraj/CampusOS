// One-off script: creates a facilities_staff test account via the Admin
// Auth API and promotes it, for testing the FacilitiesDashboard
// (tickets.read/tickets.update/bookings.approve). Same bootstrapping
// pattern as setup-vendor-accounts.mjs/setup-admin-account.mjs: the role
// change bypasses admin_set_user_role()'s own permission check by using
// the service_role connection directly.
//
// Usage: node scripts/setup-facilities-account.mjs
// Prints the email/password to stdout and writes them to the gitignored
// scripts/.facilities-credentials.local.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function readEnvVar(name) {
  return fs.readFileSync(path.join(root, ".env"), "utf8").match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
}

const SUPABASE_URL = readEnvVar("VITE_SUPABASE_URL");
const SERVICE_ROLE_KEY = fs.readFileSync(path.join(root, ".service_role_key.local"), "utf8").trim();

const ACCOUNT = { email: "facilities.staff@nhce.edu.in", label: "Facilities Staff", password: "FacilitiesTest@2026" };

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

  const sqlPath = path.join(root, "_facilities_setup.sql");
  fs.writeFileSync(
    sqlPath,
    `do $$ begin
      perform set_config('campusos.allow_role_change', 'true', true);
      update public.profiles set role = 'facilities_staff' where id = '${user.id}';
    end $$;`
  );
  try {
    execFileSync("npx", ["supabase", "db", "query", "--linked", "--file", sqlPath], { cwd: root, stdio: "inherit", shell: true });
  } finally {
    fs.unlinkSync(sqlPath);
  }
  console.log("[done] promoted to role='facilities_staff'");

  fs.writeFileSync(
    path.join(root, "scripts", ".facilities-credentials.local.json"),
    JSON.stringify({ ...ACCOUNT, userId: user.id }, null, 2)
  );
  console.log(`email: ${ACCOUNT.email}\npassword: ${ACCOUNT.password}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
