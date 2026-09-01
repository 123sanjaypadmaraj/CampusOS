// Pre-flight gate for .github/workflows/deploy.yml -- the 6 repo secrets the
// workflow needs (docs/DEPLOYMENT.md "CI/CD secrets") have never all been
// set at once, so the workflow has never had a real end-to-end run. Rather
// than let a missing/malformed secret surface as a cryptic failure 3-4
// minutes into "Deploy edge functions to staging" or worse, mid-way through
// production, this runs FIRST (see the `validate-secrets` job) and fails
// fast with one clear reason per secret.
//
// "Well-formed" here means "matches the shape this project's real values
// have" (see the SPECS table below, each entry says where its shape comes
// from), not "is guaranteed to be a live, working credential" -- the only
// way to prove that is the deploy actually succeeding. A secret that's
// present, right-shaped, and still wrong (revoked, wrong project, typoed
// mid-string) will still fail later in the run; this only catches the class
// of mistake that's obvious without calling out anywhere: empty value,
// wrong secret pasted into the wrong slot, stray whitespace/quotes from a
// copy-paste, truncated paste, wrong key type (e.g. a service_role key
// pasted where the anon/publishable key belongs).
//
// Usage:
//   node scripts/validate-deploy-secrets.mjs
// Reads the 6 secrets from the environment (that's how deploy.yml invokes
// it -- see the `validate-secrets` job). To sanity-check a value by hand
// before pasting it into GitHub, export just that one var and run this:
//   VERCEL_PROJECT_ID=prj_xxx node scripts/validate-deploy-secrets.mjs
// (the other 5 will report MISSING -- that's fine, only the one you set is
// under test).
//
// Exit 0 if every secret that IS set is well-formed AND every secret is
// present; exit 1 otherwise, with every problem listed (not just the
// first), so a single run tells you everything left to fix.
import { pathToFileURL } from "node:url";

// Never print a secret's raw value -- GitHub Actions masks registered
// secrets in logs, but a hand-rolled substring of one isn't guaranteed to
// match what the masker is watching for. This shows just enough to
// eyeball "did I paste the right thing" without reproducing the secret.
function preview(value) {
  if (value.length <= 10) return `${value.slice(0, 2)}***(${value.length} chars)`;
  return `${value.slice(0, 6)}...${value.slice(-2)} (${value.length} chars)`;
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

const SPECS = [
  {
    name: "SUPABASE_ACCESS_TOKEN",
    where: "Supabase Dashboard -> Account -> Access Tokens (same token backup.yml already uses -- reuse it)",
    check(v) {
      if (/\s/.test(v)) return "contains whitespace -- likely a copy-paste artifact";
      if (!/^sbp_/.test(v)) return 'does not start with "sbp_" -- Supabase personal access tokens always do';
      if (v.length < 20) return "too short to be a real token (truncated paste?)";
      return null;
    },
  },
  {
    name: "VERCEL_TOKEN",
    where: "Vercel -> Account Settings -> Tokens",
    check(v) {
      if (/\s/.test(v)) return "contains whitespace -- likely a copy-paste artifact";
      if (!/^[A-Za-z0-9]+$/.test(v)) return "contains characters other than letters/digits -- Vercel tokens don't";
      if (v.length < 20) return "too short to be a real token (truncated paste?)";
      return null;
    },
  },
  {
    name: "VERCEL_ORG_ID",
    where: "`.vercel/project.json` after `vercel link` locally, or Vercel project Settings -> General",
    check(v) {
      if (/\s/.test(v)) return "contains whitespace -- likely a copy-paste artifact";
      if (!/^team_[A-Za-z0-9]+$/.test(v) && !/^[A-Za-z0-9]{20,}$/.test(v)) {
        return 'doesn\'t look like a Vercel org ID (expected "team_..." for a team scope, which is what this project deploys under -- see docs/DEPLOYMENT.md)';
      }
      return null;
    },
  },
  {
    name: "VERCEL_PROJECT_ID",
    where: "Same source as VERCEL_ORG_ID (`.vercel/project.json` or project Settings -> General)",
    check(v) {
      if (/\s/.test(v)) return "contains whitespace -- likely a copy-paste artifact";
      if (!/^prj_[A-Za-z0-9]+$/.test(v)) return 'does not start with "prj_" -- Vercel project IDs always do';
      return null;
    },
  },
  {
    name: "STAGING_SUPABASE_ANON_KEY",
    where: "Supabase Dashboard -> staging project (qmfmziilgkktwnqoxakk) -> Project Settings -> API -> anon/publishable key",
    check(v) {
      if (/\s/.test(v)) return "contains whitespace -- likely a copy-paste artifact";
      if (!/^sb_publishable_/.test(v)) {
        return v.startsWith("eyJ")
          ? 'looks like a legacy JWT-format key, not this project\'s current "sb_publishable_..." format -- double-check you copied the anon/publishable key, not an old rotated one'
          : 'does not start with "sb_publishable_" -- check you copied the anon/publishable key, not the service_role key (which must NEVER go in a repo secret used by a frontend build)';
      }
      if (v.length < 30) return "too short to be a real key (truncated paste?)";
      return null;
    },
  },
  {
    name: "STAGING_E2E_ACCOUNTS",
    where: "Generate locally with `node scripts/print-ci-staging-accounts-secret.mjs` (never through an agent session -- it prints real passwords). See docs/DEPLOYMENT.md \"CI/CD secrets\".",
    check(v) {
      let parsed;
      try {
        parsed = JSON.parse(v);
      } catch (err) {
        return `not valid JSON: ${err.message}`;
      }
      if (!Array.isArray(parsed)) return "valid JSON but not an array";
      if (parsed.length === 0) return "an empty array -- the live-check suite needs at least one account to sign in as";
      const problems = [];
      parsed.forEach((entry, i) => {
        if (typeof entry !== "object" || entry === null) {
          problems.push(`entry ${i} is not an object`);
          return;
        }
        if (typeof entry.email !== "string" || !entry.email) problems.push(`entry ${i} missing "email"`);
        else if (!isEmail(entry.email)) problems.push(`entry ${i}'s email "${entry.email}" doesn't look like an email`);
        if (typeof entry.password !== "string" || !entry.password) problems.push(`entry ${i} missing "password"`);
      });
      if (problems.length > 0) return problems.join("; ");
      return null;
    },
  },
];

function validateAll(env) {
  return SPECS.map((spec) => {
    const value = env[spec.name];
    if (value === undefined || value === "") {
      return { name: spec.name, status: "MISSING", detail: `not set -- see ${spec.where}` };
    }
    const problem = spec.check(value);
    if (problem) {
      return { name: spec.name, status: "MALFORMED", detail: `${problem} (got: ${preview(value)})` };
    }
    return { name: spec.name, status: "OK", detail: preview(value) };
  });
}

function report(results) {
  const nameWidth = Math.max(...SPECS.map((s) => s.name.length));
  for (const r of results) {
    const badge = r.status === "OK" ? "[ok]     " : r.status === "MISSING" ? "[MISSING]" : "[BAD]    ";
    console.log(`${badge} ${r.name.padEnd(nameWidth)}  ${r.detail}`);
  }
  const failing = results.filter((r) => r.status !== "OK");
  console.log("");
  if (failing.length === 0) {
    console.log(`All ${results.length} deploy secrets present and well-formed.`);
  } else {
    console.log(
      `${failing.length}/${results.length} deploy secret(s) not ready: ${failing.map((r) => r.name).join(", ")}`
    );
    console.log("See docs/DEPLOYMENT.md \"CI/CD secrets\" for exactly how to generate each one.");
  }
  return failing.length === 0;
}

// Exported for scripts/deploy-dry-run.mjs, which calls these directly
// against fake secrets rather than shelling out to this file twice (once
// to prove well-formed fakes pass, once to prove a deliberately-broken one
// is caught) -- see that script's header.
export { validateAll, report, SPECS };

// Only run as a CLI when invoked directly (`node scripts/validate-deploy-secrets.mjs`),
// not when imported. pathToFileURL handles Windows drive-letter paths
// correctly, unlike a hand-rolled file:// comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = validateAll(process.env);
  const ok = report(results);
  process.exit(ok ? 0 : 1);
}
