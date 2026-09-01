// Dry-run harness for .github/workflows/deploy.yml -- exercises the real
// pipeline LOGIC (every `run:` shell step in the `validate-secrets`,
// `deploy-staging`, and `deploy-production` jobs) against fake secrets and
// fake `supabase`/`vercel`/`npm` CLIs, with no network access and no real
// credentials, so the shell script inside the workflow can be proven
// correct before it's ever run against real infrastructure.
//
// It works by READING .github/workflows/deploy.yml itself (via js-yaml) and
// running each job's actual `run:` text through bash, with a mock `npx`
// (dispatches `supabase ...` calls), `npm` (no-ops the one `install -g
// vercel@latest` call), `vercel`, and `curl` prepended to PATH -- see
// buildMockBin() below for exactly what each one fakes. Reading the real
// YAML instead of hand-reimplementing the steps means this can never
// silently drift out of sync with the workflow the way a parallel
// reimplementation could (that drift is exactly how the NO_VERIFY_JWT_FUNCTIONS
// bug happened in the first place -- see the "function-group completeness"
// check below, which guards against a repeat).
//
// Deliberately NOT covered: the `staging-live-check` job. That job needs a
// real deployed staging site and real Playwright browsers hitting it --
// there's no meaningful way to fake it without just not testing anything,
// so it isn't in scope here. It has its own coverage: it's the *same*
// `tests/live/**` suite that already runs by hand against staging today.
//
// Usage:
//   node scripts/deploy-dry-run.mjs
// Exit 0 if every simulated job's every step exits 0 and every invariant
// check passes; exit 1 with a clear reason otherwise. No flags, no network
// calls, no real secrets -- safe to run anywhere, including as a normal CI
// job on every push (see .github/workflows/ci.yml's `deploy-dry-run` job).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { validateAll } from "./validate-deploy-secrets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "deploy.yml");
const FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase", "functions");

let failures = 0;
function fail(msg) {
  failures += 1;
  console.error(`\n[FAIL] ${msg}`);
}
function ok(msg) {
  console.log(`[ok] ${msg}`);
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------------------
// 1. Fake secrets -- well-formed per validate-deploy-secrets.mjs's own rules,
//    so this dry run doubles as proof the validator's specs and its own
//    "shape of a real value" reasoning agree with each other.
// ---------------------------------------------------------------------------
const FAKE_SECRETS = {
  SUPABASE_ACCESS_TOKEN: `sbp_${"f".repeat(40)}`,
  VERCEL_TOKEN: "DryRunFakeVercelToken00",
  VERCEL_ORG_ID: "team_DryRunFakeOrgId0000",
  VERCEL_PROJECT_ID: "prj_DryRunFakeProjectId0",
  STAGING_SUPABASE_ANON_KEY: `sb_publishable_${"f".repeat(30)}`,
  STAGING_E2E_ACCOUNTS: JSON.stringify([{ email: "dryrun@example.com", password: "dry-run-fake", label: "Dry Run" }]),
};

section("Self-check: fake secrets validate as well-formed");
{
  const results = validateAll(FAKE_SECRETS);
  const bad = results.filter((r) => r.status !== "OK");
  if (bad.length > 0) {
    fail(
      `The fake secrets this harness generates don't pass validate-deploy-secrets.mjs's own checks: ${bad
        .map((r) => `${r.name} (${r.detail})`)
        .join("; ")} -- fix FAKE_SECRETS above or the validator's SPECS, they've drifted apart.`
    );
  } else {
    ok(`all ${results.length} fake secrets pass validate-deploy-secrets.mjs`);
  }
}

section("Self-check: validator actually rejects a broken secret (not a rubber stamp)");
{
  const broken = { ...FAKE_SECRETS, VERCEL_PROJECT_ID: "not-a-real-project-id", STAGING_E2E_ACCOUNTS: "not json" };
  const results = validateAll(broken);
  const caught = results.filter((r) => r.status !== "OK").map((r) => r.name);
  const expected = ["VERCEL_PROJECT_ID", "STAGING_E2E_ACCOUNTS"];
  const missedExpected = expected.filter((n) => !caught.includes(n));
  if (missedExpected.length > 0) {
    fail(`validate-deploy-secrets.mjs failed to catch deliberately-broken value(s): ${missedExpected.join(", ")}`);
  } else {
    ok(`validator correctly rejects malformed ${expected.join(" and ")}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Parse the real workflow file.
// ---------------------------------------------------------------------------
section("Parsing .github/workflows/deploy.yml");
if (!fs.existsSync(WORKFLOW_PATH)) {
  fail(`${WORKFLOW_PATH} does not exist`);
  finishAndExit();
}
const workflowText = fs.readFileSync(WORKFLOW_PATH, "utf8");
let doc;
try {
  doc = yaml.load(workflowText);
} catch (err) {
  fail(`deploy.yml is not valid YAML: ${err.message}`);
  finishAndExit();
}
ok("deploy.yml parses as valid YAML");

const topEnv = doc.env || {};

// ---------------------------------------------------------------------------
// 3. Function-group completeness -- the actual bug class found and fixed
//    live 24 Aug (readiness-audit phase 04): a function silently missing
//    from every group here would deploy with the WRONG verify_jwt setting
//    with nothing catching it until a real caller failed in production.
//    Checked structurally against the real supabase/functions/ directory,
//    not against a second hand-maintained list, so it can't itself drift.
// ---------------------------------------------------------------------------
section("Invariant: every real Edge Function is in exactly one deploy group");
{
  const realFunctions = fs
    .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_shared")
    .map((e) => e.name)
    .sort();

  const otherFns = String(topEnv.OTHER_FUNCTIONS || "").trim().split(/\s+/).filter(Boolean);
  const noVerifyFns = String(topEnv.NO_VERIFY_JWT_FUNCTIONS || "").trim().split(/\s+/).filter(Boolean);
  const webhookFn = "razorpay-webhook"; // deployed on its own line, --no-verify-jwt, see workflow

  const allGrouped = [...otherFns, ...noVerifyFns, webhookFn];
  const seen = new Map();
  for (const fn of allGrouped) seen.set(fn, (seen.get(fn) || 0) + 1);

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  const missing = realFunctions.filter((fn) => !seen.has(fn));
  const nonexistent = allGrouped.filter((fn) => !realFunctions.includes(fn));

  if (duplicates.length > 0) {
    fail(`Function(s) listed in more than one deploy group (would deploy twice, or with conflicting flags): ${duplicates.join(", ")}`);
  }
  if (missing.length > 0) {
    fail(
      `Function(s) that exist in supabase/functions/ but aren't in OTHER_FUNCTIONS, NO_VERIFY_JWT_FUNCTIONS, or the razorpay-webhook line -- they would NEVER be deployed by this workflow: ${missing.join(", ")}`
    );
  }
  if (nonexistent.length > 0) {
    fail(`Deploy group(s) reference a function directory that doesn't exist (typo, or deleted without updating deploy.yml): ${nonexistent.join(", ")}`);
  }
  if (duplicates.length === 0 && missing.length === 0 && nonexistent.length === 0) {
    ok(`all ${realFunctions.length} real functions accounted for exactly once (${otherFns.length} verified-JWT, ${noVerifyFns.length} no-verify-jwt, 1 webhook)`);
  }
}

// ---------------------------------------------------------------------------
// 4. Template-expression resolution -- mirrors what the Actions runner does
//    before handing a `run:` block to the shell: substitute every
//    `${{ ... }}`. Anything this resolver doesn't recognize is a workflow
//    change the harness hasn't been taught about yet, so it fails loudly
//    instead of running a script bash would see literal `${{ ... }}` text
//    in (which would just fail anyway, but with a confusing error).
// ---------------------------------------------------------------------------
// No repo Variables (Settings -> Secrets and variables -> Actions ->
// Variables) are configured yet -- deploy.yml's own PROD_URL comment says
// so ("Unset today"). Leaving this empty is deliberate: it makes the dry
// run exercise the real current fallback branch of `vars.X || 'literal'`
// expressions, not a made-up value. Add an entry here if a real repo
// Variable gets set and deploy.yml starts depending on its actual value.
const FAKE_VARS = {};

function resolveOperand(operand, { stepOutputs }) {
  const trimmed = operand.trim();
  let m;
  if ((m = trimmed.match(/^'([^']*)'$/))) return m[1]; // string literal
  if ((m = trimmed.match(/^secrets\.([A-Z0-9_]+)$/))) {
    const value = FAKE_SECRETS[m[1]];
    if (value === undefined) throw new Error(`No fake value defined for secrets.${m[1]} -- add it to FAKE_SECRETS.`);
    return value;
  }
  if ((m = trimmed.match(/^vars\.([A-Z0-9_]+)$/))) {
    return FAKE_VARS[m[1]] ?? ""; // unset repo variable -- GitHub Actions treats this as an empty string
  }
  if ((m = trimmed.match(/^steps\.([\w-]+)\.outputs\.([\w-]+)$/))) {
    const [, stepId, outKey] = m;
    const value = stepOutputs[stepId]?.[outKey];
    if (value === undefined) {
      throw new Error(`\${{ steps.${stepId}.outputs.${outKey} }} referenced before step "${stepId}" produced it (or that output was never captured).`);
    }
    return value;
  }
  return undefined; // caller decides how to report an unrecognized operand
}

// Mirrors what the Actions runner does before handing a `run:` block to the
// shell: substitute every `${{ ... }}`. Anything this resolver doesn't
// recognize is a workflow change the harness hasn't been taught about yet,
// so it fails loudly instead of running a script bash would see literal
// `${{ ... }}` text in (which would just fail anyway, but with a
// confusing error).
function resolveTemplate(str, { stepOutputs }) {
  return str.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (whole, expr) => {
    // Only need to handle a simple left-to-right `||` fallback chain (as
    // used by PROD_URL) -- not full GitHub Actions expression syntax.
    const operands = expr.split("||");
    for (const operand of operands) {
      const value = resolveOperand(operand, { stepOutputs });
      if (value) return value;
      if (value === undefined) {
        throw new Error(
          `Unrecognized template expression "${whole}" -- deploy-dry-run.mjs's resolveTemplate() doesn't know how to fake this. ` +
            `If deploy.yml legitimately changed, teach resolveTemplate()/resolveOperand() the new expression before trusting this dry run again.`
        );
      }
      // value === "" (falsy but recognized, e.g. an unset vars.X) -- fall through to the next `||` operand
    }
    return ""; // every operand resolved to empty -- matches real Actions' `||` semantics
  });
}

// ---------------------------------------------------------------------------
// 5. Mock CLIs. Shadowing `npx`/`npm`/`vercel`/`curl` on PATH (rather than
//    only shadowing e.g. `supabase`) is deliberate -- `npx supabase ...`
//    resolves through npx's own cache/registry logic before it ever
//    consults PATH for a same-named binary, so a PATH-only `supabase` shim
//    is silently ignored. Shadowing `npx` itself is the one interception
//    point that's reliable regardless of what's cached locally.
// ---------------------------------------------------------------------------
function buildMockBin(scratchDir) {
  const binDir = path.join(scratchDir, "mockbin");
  fs.mkdirSync(binDir, { recursive: true });
  const bundleStateDir = path.join(scratchDir, "bundle-state");
  fs.mkdirSync(bundleStateDir, { recursive: true });

  function write(name, contents) {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, contents, { mode: 0o755 });
  }

  write(
    "npx",
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "supabase" ]; then
  shift
  if [ "$1" = "db" ] && [ "$2" = "push" ]; then
    echo "mock: applied migrations ($*)"
    exit 0
  fi
  if [ "$1" = "functions" ] && [ "$2" = "deploy" ]; then
    echo "mock: deployed functions ($*)"
    exit 0
  fi
  echo "deploy-dry-run mock npx: unhandled 'supabase $*'" >&2
  exit 1
fi
echo "deploy-dry-run mock npx: unhandled command '$*' -- only 'supabase' is mocked (deploy-staging/deploy-production don't call anything else via npx)" >&2
exit 1
`
  );

  write(
    "npm",
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "install" ] && [ "$2" = "-g" ] && [ "$3" = "vercel@latest" ]; then
  echo "mock: installed vercel globally (no-op)"
  exit 0
fi
echo "deploy-dry-run mock npm: unhandled command '$*' -- only 'install -g vercel@latest' is mocked" >&2
exit 1
`
  );

  // vercel build/deploy needs to produce a real (fake) content-hashed bundle
  // file so the workflow's own `ls .vercel/output/static/assets/index-*.js`
  // + curl-grep verification logic runs unmodified. The bundle name is
  // randomized per invocation (like a real content hash would be) and
  // written to bundleStateDir so the mock `curl` step later can serve a
  // page containing the SAME name -- proving the two steps are wired
  // together correctly, not just independently "successful".
  write(
    "vercel",
    `#!/usr/bin/env bash
set -euo pipefail
cmd="$1"
case "$cmd" in
  pull)
    echo "mock: pulled vercel env ($*)"
    ;;
  build)
    mkdir -p .vercel/output/static/assets
    hash=$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
    bundle="index-\${hash}.js"
    : > ".vercel/output/static/assets/\${bundle}"
    if [[ "$*" == *"--prod"* ]]; then
      echo "\${bundle}" > "${bundleStateDir.replace(/\\/g, "/")}/production.txt"
    else
      echo "\${bundle}" > "${bundleStateDir.replace(/\\/g, "/")}/staging.txt"
    fi
    echo "mock: built ($*)"
    ;;
  deploy)
    if [[ "$*" == *"--prod"* ]]; then
      echo "https://campusos-dryrun-prod-fake.vercel.app"
    else
      echo "https://campusos-dryrun-staging-fake.vercel.app"
    fi
    ;;
  alias)
    echo "mock: aliased ($*)" >&2
    ;;
  *)
    echo "deploy-dry-run mock vercel: unhandled subcommand '$cmd'" >&2
    exit 1
    ;;
esac
`
  );

  // curl only needs to fake the two "is the new bundle live" checks. It
  // reads back whatever bundle name the mock `vercel build` for that
  // environment just wrote, so a real wiring bug (e.g. checking staging's
  // bundle against production's URL) would show up as a mismatch here
  // exactly like it would against the real site.
  write(
    "curl",
    `#!/usr/bin/env bash
set -euo pipefail
url="\${@: -1}"
if [[ "$url" == *"campusos-staging.vercel.app"* ]]; then
  bundle=$(cat "${bundleStateDir.replace(/\\/g, "/")}/staging.txt" 2>/dev/null || echo "MISSING")
elif [[ "$url" == *"campusos-amber.vercel.app"* ]]; then
  bundle=$(cat "${bundleStateDir.replace(/\\/g, "/")}/production.txt" 2>/dev/null || echo "MISSING")
else
  echo "deploy-dry-run mock curl: unrecognized URL '$url'" >&2
  exit 1
fi
echo "<html><script src=\\"/assets/\${bundle}\\"></script></html>"
`
  );

  // fs.writeFileSync's `mode` option isn't reliably honored as a real
  // POSIX executable bit on every platform/filesystem (notably Windows +
  // git-bash/MSYS) -- an explicit `chmod +x` guarantees bash will actually
  // execute these as commands rather than failing with "Permission denied"
  // on some machines and not others.
  const chmod = spawnSync("bash", ["-c", `chmod +x "${binDir.replace(/\\/g, "/")}"/*`]);
  if (chmod.status !== 0) {
    throw new Error(`Failed to chmod +x the mock bin dir: ${chmod.stderr}`);
  }

  return { binDir };
}

// ---------------------------------------------------------------------------
// 6. Step runner -- executes one job's `run:` steps in order, in a scratch
//    cwd, with the mock bin dir prepended to PATH and fake secrets injected
//    exactly where the real workflow injects them (top-level env on every
//    step, step-level env only on the steps that declare it).
// ---------------------------------------------------------------------------
function runJob(jobName, job, scratchRoot) {
  section(`Simulating job "${jobName}"`);
  const scratchDir = fs.mkdtempSync(path.join(scratchRoot, `${jobName}-`));

  // Mirrors what `actions/checkout@v4` (the first step of every real job
  // here) actually does: populate the job's cwd with the repo content.
  // Copies the actual working tree (not `git archive HEAD`) so a dry run
  // exercises whatever's on disk right now, including uncommitted changes
  // to deploy.yml/this script itself -- exactly what you want to prove
  // sound BEFORE committing it, not just what was already committed.
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vercel", "android", "ios", "playwright-report", "test-results"]);
  fs.cpSync(REPO_ROOT, scratchDir, {
    recursive: true,
    filter: (src) => !SKIP_DIRS.has(path.basename(src)),
  });

  const { binDir } = buildMockBin(scratchDir);
  const stepOutputs = {};
  let jobFailed = false;

  for (const step of job.steps || []) {
    if (!step.run) continue; // uses: steps (checkout/setup-node/upload-artifact) -- nothing to execute
    const label = step.name || step.run.slice(0, 40);

    let runText, stepEnv;
    try {
      runText = resolveTemplate(step.run, { stepOutputs });
      stepEnv = {};
      for (const [k, v] of Object.entries(step.env || {})) {
        stepEnv[k] = resolveTemplate(String(v), { stepOutputs });
      }
    } catch (err) {
      fail(`[${jobName} / ${label}] ${err.message}`);
      jobFailed = true;
      break;
    }

    const resolvedTopEnv = {};
    for (const [k, v] of Object.entries(topEnv)) {
      try {
        resolvedTopEnv[k] = resolveTemplate(String(v), { stepOutputs });
      } catch (err) {
        fail(`[${jobName} / ${label}] resolving workflow-level env "${k}": ${err.message}`);
        jobFailed = true;
      }
    }
    if (jobFailed) break;

    const githubOutputFile = path.join(scratchDir, `output-${Buffer.from(label).toString("hex").slice(0, 12)}.txt`);
    fs.writeFileSync(githubOutputFile, "");

    const result = spawnSync("bash", ["-c", runText], {
      cwd: scratchDir,
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        HOME: process.env.HOME || process.env.USERPROFILE,
        ...resolvedTopEnv,
        ...stepEnv,
        GITHUB_OUTPUT: githubOutputFile,
      },
      encoding: "utf8",
    });

    if (result.status !== 0) {
      fail(`[${jobName} / ${label}] exited ${result.status}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
      jobFailed = true;
      break;
    }
    ok(`[${jobName}] ${label}`);

    if (step.id) {
      const outputs = {};
      for (const line of fs.readFileSync(githubOutputFile, "utf8").split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
      }
      stepOutputs[step.id] = outputs;
    }
  }

  if (!jobFailed) ok(`job "${jobName}" completed with every run-step exiting 0`);
  return !jobFailed;
}

// ---------------------------------------------------------------------------
// 7. Run it.
// ---------------------------------------------------------------------------
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "campusos-deploy-dry-run-"));
try {
  for (const jobName of ["validate-secrets", "deploy-staging", "deploy-production"]) {
    const job = doc.jobs?.[jobName];
    if (!job) {
      fail(`deploy.yml has no job named "${jobName}" -- did it get renamed? Update this script's job list.`);
      continue;
    }
    runJob(jobName, job, scratchRoot);
  }
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
}

finishAndExit();

function finishAndExit() {
  console.log("");
  if (failures > 0) {
    console.log(`deploy-dry-run: ${failures} check(s) failed. See [FAIL] lines above.`);
    process.exit(1);
  }
  console.log("deploy-dry-run: all checks passed. The pipeline logic itself is sound --");
  console.log("the only remaining unknown is whether the 6 real secrets are valid live");
  console.log("credentials, which only a real run against real infrastructure proves.");
  process.exit(0);
}
