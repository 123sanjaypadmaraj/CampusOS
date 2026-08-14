// Shared "which Supabase project am I about to run against?" resolver for
// every admin/seed script in this directory (and tests/live/helpers/).
//
// Defaults to STAGING. Production requires BOTH `--env=production` AND
// `--yes-production` -- these scripts create real accounts, promote roles,
// and write directly via the service_role key (bypassing RLS), so running
// one against the live project by accident (e.g. because the CLI's mutable
// `supabase link` state happened to point at prod, see docs/ENVIRONMENTS.md)
// is exactly the kind of mistake that hurts real students. There is no
// "just trust supabase link" path left in these scripts on purpose --
// every SQL/CLI call this resolver feeds should use `--project-ref
// <projectRef>` explicitly instead of `--linked`.
//
// Usage: node scripts/whatever.mjs                       (staging, default)
//        node scripts/whatever.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const PROD_PROJECT_REF = "dzjzjlylsfpmymkcavrq";
const STAGING_PROJECT_REF = "qmfmziilgkktwnqoxakk";

function readEnvVar(filePath, name) {
  if (!fs.existsSync(filePath)) return undefined;
  const contents = fs.readFileSync(filePath, "utf8");
  return contents.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
}

export function resolveTarget() {
  const args = process.argv.slice(2);
  const envFlag = args.find((a) => a.startsWith("--env="))?.split("=")[1];
  const target = envFlag || process.env.CAMPUSOS_ENV || "staging";

  if (target !== "staging" && target !== "production") {
    throw new Error(`Unknown --env=${target}. Use "staging" or "production".`);
  }

  const envFile = path.join(root, target === "production" ? ".env.production.local" : ".env.staging.local");
  const legacyEnvFile = path.join(root, ".env"); // pre-split repos, or a manually-pointed local override

  const SUPABASE_URL = readEnvVar(envFile, "VITE_SUPABASE_URL") || readEnvVar(legacyEnvFile, "VITE_SUPABASE_URL");
  if (!SUPABASE_URL) {
    throw new Error(`Could not find VITE_SUPABASE_URL in ${path.basename(envFile)} or .env`);
  }
  const ANON_KEY = readEnvVar(envFile, "VITE_SUPABASE_PUBLISHABLE_KEY") || readEnvVar(legacyEnvFile, "VITE_SUPABASE_PUBLISHABLE_KEY");

  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];

  if (target === "staging" && projectRef === PROD_PROJECT_REF) {
    throw new Error(
      `--env=staging resolved to the PRODUCTION project (${projectRef}). ` +
      `${path.basename(envFile)} is missing/misconfigured -- refusing to run. ` +
      `If you really mean production, pass --env=production --yes-production.`
    );
  }
  if (target === "production") {
    if (projectRef !== PROD_PROJECT_REF) {
      throw new Error(`--env=production did not resolve to the known production project ref (${PROD_PROJECT_REF}); got "${projectRef}" instead. Aborting.`);
    }
    if (!args.includes("--yes-production")) {
      throw new Error(
        "Refusing to run against PRODUCTION without --yes-production. " +
        "This script writes real data via the service_role key. Re-run with " +
        "--env=production --yes-production if that's really what you want."
      );
    }
  }

  const serviceRoleFile = path.join(root, target === "production" ? ".service_role_key.local" : ".service_role_key.staging.local");
  if (!fs.existsSync(serviceRoleFile)) {
    throw new Error(`Missing ${path.basename(serviceRoleFile)} -- can't authenticate as service_role for ${target}.`);
  }
  const SERVICE_ROLE_KEY = fs.readFileSync(serviceRoleFile, "utf8").trim();

  const sessionsFile = path.join(root, "scripts", target === "production" ? ".sessions.json" : ".sessions.staging.json");

  console.log(`[env] targeting ${target} (${projectRef}${target === "staging" && projectRef === STAGING_PROJECT_REF ? ", confirmed staging" : ""})`);

  return { target, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, projectRef, sessionsFile, root };
}

// `supabase db query` only accepts --project-ref *combined with* --linked
// (it's not a --db-url-style standalone target the way `db dump`/`functions
// deploy` accept it) -- it reads whichever project the CLI's local
// `supabase/.temp/project-ref` state currently points at. That file is
// shared, mutable, unversioned local state -- another concurrent session
// (or a previous command in this one) can silently repoint it. Re-linking
// immediately before every query call, back-to-back in one exec, is the
// only way to make each admin script's target deterministic regardless of
// what else touched that state file since.
export function runProjectSql(root, projectRef, sql) {
  const sqlPath = path.join(root, `_tmp_${Date.now()}.sql`);
  fs.writeFileSync(sqlPath, sql);
  try {
    execFileSync("npx", ["supabase", "link", "--project-ref", projectRef], { cwd: root, stdio: "pipe", shell: true });
    execFileSync("npx", ["supabase", "db", "query", "--linked", "--file", sqlPath], { cwd: root, stdio: "inherit", shell: true });
  } finally {
    fs.unlinkSync(sqlPath);
  }
}
