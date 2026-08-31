// scripts/rotate-credentials.mjs
//
// Single entry point for the credential-rotation checklist in
// docs/CREDENTIAL_ROTATION.md: does every part of rotating the legacy
// Supabase JWT and the Razorpay/Groq/Resend (+ Fast2SMS) Edge Function
// secrets that does NOT require clicking a dashboard button. What it does
// NOT do, on purpose: generate the new value for you (Razorpay/Groq/Resend
// only hand those out through their own dashboards), or type it anywhere
// this session/a chat transcript can see it -- every secret value is read
// via a masked terminal prompt, run this yourself, in your own terminal.
//
// Usage:
//   node scripts/rotate-credentials.mjs status [--env=staging|production|both]
//   node scripts/rotate-credentials.mjs legacy-jwt --env=staging|production [--yes-production]
//   node scripts/rotate-credentials.mjs razorpay-keys --env=staging|production [--yes-production]
//   node scripts/rotate-credentials.mjs razorpay-webhook-secret --env=... [--yes-production] [--generate]
//   node scripts/rotate-credentials.mjs groq-api-key --env=... [--yes-production]
//   node scripts/rotate-credentials.mjs resend --env=... [--yes-production]
//   node scripts/rotate-credentials.mjs fast2sms-api-key --env=... [--yes-production]
//
// Same staging/production guard rails as scripts/env-target.mjs: staging is
// the default target where a command needs one, production requires both
// --env=production and --yes-production.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const PROD_PROJECT_REF = "dzjzjlylsfpmymkcavrq";
const STAGING_PROJECT_REF = "qmfmziilgkktwnqoxakk";
const PROD_URL = `https://${PROD_PROJECT_REF}.supabase.co`;
const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;

// Canonical list of every Edge Function secret this codebase reads, and
// which feature it backs -- kept in sync BY HAND with
// supabase/functions/system-health/index.ts's SECRET_GROUPS (that function
// checks presence only and can't be queried without an admin session; this
// script's `status` command gets the same answer straight from `supabase
// secrets list`, which only needs CLI auth). If you add a new Edge Function
// secret, add it here too.
const SECRET_REGISTRY = [
  { name: "GROQ_API_KEY", feature: "AI assistant (campus-assistant)" },
  { name: "RESEND_API_KEY", feature: "Email delivery (send-email)" },
  { name: "RESEND_FROM", feature: "Email delivery (send-email) -- not secret, just the From header" },
  { name: "FAST2SMS_API_KEY", feature: "SMS delivery" },
  { name: "RAZORPAY_KEY_ID", feature: "Payments (create-razorpay-order, razorpay-refund, payment-reconciliation)" },
  { name: "RAZORPAY_KEY_SECRET", feature: "Payments (same as above)" },
  { name: "RAZORPAY_WEBHOOK_SECRET", feature: "Payments (razorpay-webhook -- the ONLY place an order becomes paid)" },
];

function projectFor(env) {
  return env === "production" ? PROD_PROJECT_REF : STAGING_PROJECT_REF;
}
function urlFor(env) {
  return env === "production" ? PROD_URL : STAGING_URL;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (const a of rest) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v ?? true;
    }
  }
  return { command, flags };
}

function resolveEnv(flags, { required = true } = {}) {
  const env = flags.env || (required ? undefined : "staging");
  if (!env) throw new Error("Pass --env=staging or --env=production.");
  if (env !== "staging" && env !== "production") {
    throw new Error(`Unknown --env=${env}. Use "staging" or "production".`);
  }
  if (env === "production" && !flags["yes-production"]) {
    throw new Error(
      "Refusing to touch PRODUCTION without --yes-production. Re-run with " +
      "--env=production --yes-production if that's really what you want."
    );
  }
  return env;
}

// --- masked terminal input -------------------------------------------------
// Node has no built-in password prompt. This is the standard workaround:
// intercept the readline instance's own output writer and print "*" per
// keystroke instead of the real character. Never logs, returns, or echoes
// the full value anywhere other than the variable it resolves to.
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let muted = false;
    // eslint-disable-next-line no-underscore-dangle
    rl._writeToOutput = (str) => {
      rl.output.write(muted ? "*".repeat(str.length) : str);
    };
    rl.question(question, (value) => {
      rl.close();
      process.stdout.write("\n");
      resolve(value.trim());
    });
    muted = true;
  });
}

function promptPlain(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (value) => {
      rl.close();
      resolve(value.trim());
    });
  });
}

// --- Supabase secrets propagation ------------------------------------------
// Writes NAME=value pairs to a throwaway env file and feeds it to
// `supabase secrets set --env-file`, rather than putting the value on the
// command line (shell history, process list) or piping it through this
// script's own stdout. Mirrors env-target.mjs's runProjectSql() pattern:
// temp file, try/finally cleanup.
function setSupabaseSecrets(projectRef, pairs) {
  const tmpFile = path.join(root, `_tmp_secrets_${Date.now()}.env`);
  const body = Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs.writeFileSync(tmpFile, body, { mode: 0o600 });
  try {
    execFileSync(
      "npx",
      ["supabase", "secrets", "set", "--env-file", tmpFile, "--project-ref", projectRef],
      { cwd: root, stdio: "pipe", shell: true }
    );
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

function listSupabaseSecrets(projectRef) {
  const out = execFileSync(
    "npx",
    ["supabase", "secrets", "list", "--project-ref", projectRef],
    { cwd: root, stdio: "pipe", shell: true }
  ).toString("utf8");
  // Digests only, never plaintext values -- safe to parse/print in full.
  // Without --output json this CLI version prints a single-line
  // `{"secrets": [...], "message": ""}` object; with it, a pretty-printed
  // bare array. Handle both rather than assuming one.
  const trimmed = out.trim();
  const jsonStart = trimmed.indexOf("{") === -1 ? trimmed.indexOf("[") : Math.min(...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((i) => i !== -1));
  const parsed = JSON.parse(trimmed.slice(jsonStart));
  return Array.isArray(parsed) ? parsed : parsed.secrets || [];
}

function verifyJustSet(projectRef, names, sinceMs = 3 * 60 * 1000) {
  const secrets = listSupabaseSecrets(projectRef);
  const byName = Object.fromEntries(secrets.map((s) => [s.name, s]));
  const results = names.map((name) => {
    const entry = byName[name];
    if (!entry) return { name, ok: false, reason: "not found in `supabase secrets list`" };
    const age = Date.now() - new Date(entry.updated_at).getTime();
    if (age > sinceMs) return { name, ok: false, reason: `updated_at is ${Math.round(age / 1000)}s ago -- doesn't look like it just changed` };
    return { name, ok: true };
  });
  return results;
}

// --- legacy-jwt (service_role) ---------------------------------------------
async function cmdLegacyJwt(flags) {
  const env = resolveEnv(flags);
  const projectRef = projectFor(env);
  const supabaseUrl = urlFor(env);
  const fileName = env === "production" ? ".service_role_key.local" : ".service_role_key.staging.local";
  const filePath = path.join(root, fileName);

  console.log(`\nRotating the legacy service_role JWT for ${env} (${projectRef}).`);
  console.log("Before this: roll it in the Supabase Dashboard -> Project Settings -> API -> Legacy API Keys.");
  console.log("Paste the NEW service_role key below (input is masked, never printed back):\n");

  const newKey = await promptHidden("service_role JWT> ");
  if (!newKey || newKey.length < 20) {
    throw new Error("That doesn't look like a JWT (too short). Aborting without writing anything.");
  }

  // Verify BEFORE touching the file on disk -- a bad paste (wrong value, or
  // the Dashboard roll hasn't finished propagating yet) must never corrupt
  // the working credential every other script/session on this machine
  // reads from this same file.
  console.log("Verifying the new key authenticates against the project before writing anything...");
  const res = await fetch(`${supabaseUrl}/rest/v1/campuses?select=id&limit=1`, {
    headers: { apikey: newKey, Authorization: `Bearer ${newKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Verification failed: ${supabaseUrl}/rest/v1/campuses returned ${res.status}. ` +
      `Either the pasted key is wrong, or the Dashboard roll hasn't finished propagating yet. ` +
      `${fileName} was NOT touched -- re-run once you've confirmed the right value.`
    );
  }
  console.log("Verified: the new key authenticates and reads the DB successfully.");

  fs.writeFileSync(filePath, newKey + "\n", { mode: 0o600 });
  console.log(`Wrote ${fileName} (used by scripts/env-target.mjs and tests/live/helpers/resolveServiceRoleKey.js).\n`);

  if (env === "production") {
    console.log("Two things this script cannot do for you:");
    console.log("  1. GitHub Actions repo secret PROD_SUPABASE_SERVICE_ROLE_KEY (backup.yml, storage-backup.yml) --");
    console.log("     if you have the gh CLI set up locally, run this yourself (reads the file, never your shell history):");
    console.log(`       gh secret set PROD_SUPABASE_SERVICE_ROLE_KEY < "${fileName}"`);
    console.log("     Otherwise: GitHub repo -> Settings -> Secrets and variables -> Actions -> PROD_SUPABASE_SERVICE_ROLE_KEY -> Update -- paste the same file's contents.");
    console.log("  2. Every deployed Edge Function's own SUPABASE_SERVICE_ROLE_KEY is Supabase's own auto-injected runtime var --");
    console.log("     it updates itself when you roll the key in the Dashboard. No redeploy needed, nothing else to do there.");
  } else {
    console.log("Staging has no GitHub Actions secret depending on this key (backup/storage-backup are production-only). Nothing else to do.");
  }
}

// --- generic "set N secrets on one project" flow ---------------------------
async function collectAndSet(env, fields, { generate } = {}) {
  const projectRef = projectFor(env);
  const pairs = {};
  for (const f of fields) {
    if (f.generate && generate) {
      pairs[f.name] = crypto.randomBytes(32).toString("hex");
      console.log(`Generated a new ${f.name} (shown once below -- you paste this exact value into the ${f.dashboard}):\n`);
      console.log(`  ${pairs[f.name]}\n`);
    } else if (f.secret === false) {
      pairs[f.name] = await promptPlain(`${f.name}${f.hint ? ` (${f.hint})` : ""}> `);
      if (!pairs[f.name] && f.default) pairs[f.name] = f.default;
    } else {
      pairs[f.name] = await promptHidden(`${f.name}> `);
    }
  }
  const missing = fields.filter((f) => !pairs[f.name] && !f.optional).map((f) => f.name);
  if (missing.length) throw new Error(`No value entered for: ${missing.join(", ")}. Aborting without changing anything.`);

  console.log(`\nSetting ${fields.map((f) => f.name).join(", ")} on ${env} (${projectRef})...`);
  setSupabaseSecrets(projectRef, Object.fromEntries(Object.entries(pairs).filter(([, v]) => v)));

  console.log("Verifying via `supabase secrets list` (digests only, never plaintext)...");
  const results = verifyJustSet(projectRef, Object.keys(pairs).filter((k) => pairs[k]));
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "FAIL"} ${r.name}${r.ok ? "" : ` -- ${r.reason}`}`);
  }
  if (results.some((r) => !r.ok)) {
    throw new Error("At least one secret did not verify as freshly set -- see FAIL lines above.");
  }
  console.log("\nEdge Function secrets take effect immediately -- no redeploy needed.");
}

async function cmdRazorpayKeys(flags) {
  const env = resolveEnv(flags);
  console.log(`\nRazorpay Dashboard -> Settings -> API Keys -> Regenerate ${env === "production" ? "Live" : "Test"} Key first (this replaces BOTH the Key ID and Key Secret together -- Razorpay doesn't let you rotate one without the other).`);
  console.log("Then paste both new values below:\n");
  await collectAndSet(env, [
    { name: "RAZORPAY_KEY_ID", secret: false, hint: "not secret on its own, but keep it paired with the new secret" },
    { name: "RAZORPAY_KEY_SECRET" },
  ]);
}

async function cmdRazorpayWebhookSecret(flags) {
  const env = resolveEnv(flags);
  console.log(`\nRAZORPAY_WEBHOOK_SECRET is not something Razorpay generates for you -- it's a shared secret YOU choose and paste into both sides (Razorpay's webhook config and this project's Edge Function secrets). Currently unset on production, so this is a first-time set, not a rotation.`);
  if (flags.generate) {
    await collectAndSet(env, [{ name: "RAZORPAY_WEBHOOK_SECRET", generate: true, dashboard: "Razorpay Dashboard -> Settings -> Webhooks -> (create/edit the endpoint) -> Secret field" }], { generate: true });
  } else {
    console.log("Pass --generate to have this script mint a strong random value for you (recommended), or paste one you already chose:\n");
    await collectAndSet(env, [{ name: "RAZORPAY_WEBHOOK_SECRET" }]);
  }
  console.log("\nDon't forget the other half: Razorpay Dashboard -> Settings -> Webhooks -> set the endpoint to");
  console.log(`  https://${projectFor(env)}.functions.supabase.co/razorpay-webhook`);
  console.log("subscribed to payment.authorized / payment.captured / payment.failed, with the SAME secret value pasted into the Secret field.");
}

async function cmdGroqApiKey(flags) {
  const env = resolveEnv(flags);
  console.log(`\nconsole.groq.com -> API Keys -> Create/regenerate a key first. Then paste it below:\n`);
  await collectAndSet(env, [{ name: "GROQ_API_KEY" }]);
}

async function cmdResend(flags) {
  const env = resolveEnv(flags);
  console.log(`\nresend.com -> API Keys -> Create/regenerate a key first. RESEND_API_KEY is currently UNSET on production -- this is a first-time set, not a rotation (email delivery has been silently returning 503 GATEWAY_NOT_CONFIGURED until now, logged to error_logs, not visibly broken to users since nothing depends on email synchronously).\n`);
  await collectAndSet(env, [
    { name: "RESEND_API_KEY" },
    { name: "RESEND_FROM", secret: false, optional: true, hint: 'e.g. "CampusOS <notifications@yourdomain>", leave blank to keep the send-email fallback (CampusOS <onboarding@resend.dev>)' },
  ]);
}

async function cmdFast2sms(flags) {
  const env = resolveEnv(flags);
  console.log(`\nBonus target, not one of the three named in the rotation task but flagged alongside Resend in SECURITY.md. www.fast2sms.com dashboard -> API Keys. Currently unset on production -- SMS delivery is silently disabled, same as email above.\n`);
  await collectAndSet(env, [{ name: "FAST2SMS_API_KEY" }]);
}

// --- status ------------------------------------------------------------
async function cmdStatus(flags) {
  const which = flags.env || "both";
  const envs = which === "both" ? ["staging", "production"] : [which];
  for (const env of envs) {
    const projectRef = projectFor(env);
    console.log(`\n=== ${env} (${projectRef}) ===`);
    let secrets;
    try {
      secrets = listSupabaseSecrets(projectRef);
    } catch (e) {
      console.log(`  Could not list secrets (${e.message.split("\n")[0]}) -- are you logged in? \`npx supabase login\``);
      continue;
    }
    const byName = Object.fromEntries(secrets.map((s) => [s.name, s]));
    for (const { name, feature } of SECRET_REGISTRY) {
      const entry = byName[name];
      const mark = entry ? "SET  " : "MISSING";
      const when = entry ? `(updated ${entry.updated_at})` : "";
      console.log(`  ${mark} ${name.padEnd(24)} ${feature}${when ? `  ${when}` : ""}`);
    }
    const svcFile = path.join(root, env === "production" ? ".service_role_key.local" : ".service_role_key.staging.local");
    console.log(`  ${fs.existsSync(svcFile) ? "SET  " : "MISSING"} ${path.basename(svcFile).padEnd(24)} legacy service_role JWT (local file, scripts/env-target.mjs)`);
  }
  console.log("");
}

const COMMANDS = {
  status: cmdStatus,
  "legacy-jwt": cmdLegacyJwt,
  "razorpay-keys": cmdRazorpayKeys,
  "razorpay-webhook-secret": cmdRazorpayWebhookSecret,
  "groq-api-key": cmdGroqApiKey,
  resend: cmdResend,
  "fast2sms-api-key": cmdFast2sms,
};

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const fn = COMMANDS[command];
  if (!fn) {
    console.error(`Usage: node scripts/rotate-credentials.mjs <${Object.keys(COMMANDS).join("|")}> [--env=staging|production] [--yes-production]`);
    process.exit(1);
  }
  try {
    await fn(flags);
  } catch (e) {
    console.error(`\nERROR: ${e.message}`);
    process.exit(1);
  }
}

main();
