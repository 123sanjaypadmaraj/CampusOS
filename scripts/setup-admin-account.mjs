// One-off script: creates the requested admin account (Name/USN/Password)
// via the Admin Auth API and promotes it to super_admin. The role change
// bypasses admin_set_user_role()'s own permission check (which needs an
// *existing* admin to call it -- a bootstrapping problem for the very first
// admin) by using the service_role connection directly and toggling the
// same session-local flag protect_profile_role() checks for.
//
// Usage: node scripts/setup-admin-account.mjs

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

const ACCOUNT = { name: "Sanjay Padmaraj", usn: "1NH25CS265", password: "Sanjay@123" };
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

async function main() {
  const { data: list } = await adminFetch(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
  let user = (list?.users || list)?.find?.((u) => u.email === email);

  if (user) {
    console.log(`[skip] ${email} already exists (${user.id})`);
  } else {
    const { ok, status, data } = await adminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: ACCOUNT.password,
        email_confirm: true,
        user_metadata: { name: ACCOUNT.name, usn: ACCOUNT.usn },
      }),
    });
    if (!ok) throw new Error(`Failed to create account: ${status} ${JSON.stringify(data)}`);
    user = data;
    console.log(`[created] ${email} (${user.id})`);
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
  const sqlPath = path.join(root, "_grant_admin.sql");
  fs.writeFileSync(sqlPath, sql);
  execFileSync("npx", ["supabase", "db", "query", "--linked", "--file", sqlPath], { cwd: root, stdio: "inherit", shell: true });
  fs.unlinkSync(sqlPath);

  console.log(`\n[done] ${ACCOUNT.name} (USN ${ACCOUNT.usn}) is now super_admin.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
