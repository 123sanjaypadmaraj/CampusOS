// One-off helper: resets a staging vendor's password via the Admin API so
// live-check scripts can sign in (their real passwords were never saved --
// "(pre-existing account, not shown)"). Staging-only by default; refuses
// production unless explicitly overridden, same as every env-target script.
// Usage: node scripts/reset-vendor-password-temp.mjs <email> <newPassword>
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, SERVICE_ROLE_KEY, target } = resolveTarget();
const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) throw new Error("Usage: node scripts/reset-vendor-password-temp.mjs <email> <newPassword>");

async function main() {
  const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
  });
  const list = await listRes.json();
  const user = (list?.users || list)?.find?.((u) => u.email === email);
  if (!user) throw new Error(`No user found for ${email} on ${target}`);

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) throw new Error(`Password reset failed: ${res.status} ${await res.text()}`);
  console.log(`[done] ${email} password reset on ${target}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
