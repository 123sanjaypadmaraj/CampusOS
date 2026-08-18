// scripts/print-file-cleanup.mjs
//
// Fallback runner for the print-file-cleanup Edge Function ("Automatic file
// expiry" + "Delete collected documents", Phase 6 printing security
// checklist). Real scheduling can go through pg_cron+pg_net directly against
// the function URL (see that function's header for the exact `cron.schedule`
// call) -- this script does the same HTTP call by hand, for a manual run or
// any external scheduler (e.g. a GitHub Actions cron, same as backup.yml
// already does for backup-retention.mjs) if pg_cron/pg_net/Vault aren't set
// up on a given project.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/print-file-cleanup.mjs

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/print-file-cleanup.mjs");
  process.exit(1);
}

async function main() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/print-file-cleanup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`print-file-cleanup -> ${res.status}: ${JSON.stringify(body)}`);
  }
  console.log(`Checked ${body.checked} due job(s): deleted ${body.deleted}, failed ${body.failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
