// scripts/backup-retention.mjs
//
// Prunes the `backups` storage bucket down to a fixed retention policy
// (see docs/DISASTER_RECOVERY.md), separately per --kind:
//
//   db      (daily cadence, .github/workflows/backup.yml): last 14 daily
//           snapshots, plus the newest in each of the last 8 ISO weeks,
//           plus the newest in each of the last 12 calendar months.
//   storage (weekly cadence, .github/workflows/storage-backup.yml): last
//           8 snapshots (~2 months), plus the newest in each of the last
//           6 calendar months. No separate weekly tier -- redundant when
//           the source cadence is already weekly.
//
// Either way: a mistake discovered a month later still has *something* to
// restore from, without keeping every dump/archive ever taken forever.
// Run right after a new backup uploads; safe to run standalone too
// (idempotent).
//
// Uses the Storage HTTP API directly with the service_role key, not
// `supabase storage rm` -- that CLI subcommand silently no-ops (confirmed
// live against a real object: reports {"deleted":[]} and makes no HTTP
// call at all) on Supabase CLI 2.114.0's --experimental storage commands.
// `supabase storage cp` (the upload half, in the backup workflows) works
// fine and needs no service_role key -- only listing/deleting for
// retention does.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-retention.mjs [--kind=db|storage] [--dry-run]

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");
const kindFlag = process.argv.find((a) => a.startsWith("--kind="))?.split("=")[1] || "db";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-retention.mjs [--kind=db|storage] [--dry-run]");
  process.exit(1);
}

const KINDS = {
  db: {
    prefix: "db/",
    re: /^db-(\d{4})-(\d{2})-(\d{2})\.sql\.gz$/,
    keepDaily: 14,
    keepWeekly: 8,
    keepMonthly: 12,
  },
  storage: {
    prefix: "storage/",
    re: /^storage-(\d{4})-(\d{2})-(\d{2})\.tar\.gz$/,
    keepDaily: 8, // "daily" tier == "last N snapshots" regardless of cadence
    keepWeekly: 0, // skip -- redundant, the source cadence is already weekly
    keepMonthly: 6,
  },
};

if (!KINDS[kindFlag]) {
  console.error(`Unknown --kind=${kindFlag}. Use "db" or "storage".`);
  process.exit(1);
}

const { prefix: PREFIX, re: FILENAME_RE, keepDaily: KEEP_DAILY, keepWeekly: KEEP_WEEKLY, keepMonthly: KEEP_MONTHLY } = KINDS[kindFlag];
const BUCKET = "backups";

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function storageFetch(pathname, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      ...options.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}: ${text}`);
  return data;
}

async function listBackups() {
  const objects = await storageFetch(`/object/list/${BUCKET}`, {
    method: "POST",
    body: JSON.stringify({ prefix: PREFIX, limit: 1000, sortBy: { column: "name", order: "desc" } }),
  });
  return objects
    .map((obj) => {
      const match = FILENAME_RE.exec(obj.name);
      if (!match) return null;
      const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
      return { name: obj.name, date };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date); // newest first
}

function computeKeepSet(backups) {
  const keep = new Set();

  backups.slice(0, KEEP_DAILY).forEach((b) => keep.add(b.name));

  const seenWeeks = new Set();
  for (const b of backups) {
    const key = isoWeekKey(b.date);
    if (seenWeeks.has(key)) continue;
    if (seenWeeks.size >= KEEP_WEEKLY) break;
    seenWeeks.add(key);
    keep.add(b.name);
  }

  const seenMonths = new Set();
  for (const b of backups) {
    const key = monthKey(b.date);
    if (seenMonths.has(key)) continue;
    if (seenMonths.size >= KEEP_MONTHLY) break;
    seenMonths.add(key);
    keep.add(b.name);
  }

  return keep;
}

async function main() {
  const backups = await listBackups();
  if (backups.length === 0) {
    console.log(`No ${kindFlag} backups found under ${BUCKET}/${PREFIX} -- nothing to prune.`);
    return;
  }

  const keep = computeKeepSet(backups);
  const toDelete = backups.filter((b) => !keep.has(b.name));

  console.log(`[${kindFlag}] ${backups.length} backups found, keeping ${keep.size}, deleting ${toDelete.length}.`);

  if (toDelete.length === 0) return;

  if (dryRun) {
    toDelete.forEach((b) => console.log(`[dry-run] would delete ${PREFIX}${b.name}`));
    return;
  }

  await storageFetch(`/object/${BUCKET}`, {
    method: "DELETE",
    body: JSON.stringify({ prefixes: toDelete.map((b) => `${PREFIX}${b.name}`) }),
  });
  toDelete.forEach((b) => console.log(`[deleted] ${PREFIX}${b.name}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
