// Phase 7 (Reliability at scale) -- read-throughput ramp test.
//
// CampusOS's target is ~6,000 students, but both Supabase projects are on
// the free tier (see docs/DISASTER_RECOVERY.md), which caps concurrent
// Postgres/pooler and Realtime connections far below that. Rather than
// pretend we can simulate 6,000 literal concurrent connections against a
// free-tier project, this ramps concurrency up in steps against a realistic
// mix of read endpoints (the ones a browsing student's home/feed screens
// actually fire) until the error rate or latency clearly breaks down, and
// reports that as the project's actual sustainable ceiling right now.
//
// Read-only. Safe to run repeatedly. Defaults to staging; refuses production
// without --env=production --yes-production (see scripts/env-target.mjs).
//
// Usage: node scripts/loadtest-throughput.mjs
//        node scripts/loadtest-throughput.mjs --max=400 --waves=3

import fs from "node:fs";
import path from "node:path";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, target, sessionsFile } = resolveTarget();

const args = process.argv.slice(2);
const argNum = (name, def) => {
  const raw = args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  return raw ? Number(raw) : def;
};

const LEVELS = [10, 25, 50, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2200, 3000, 4000, 6000].filter((n) => n <= argNum("max", 800));
const WAVES_PER_LEVEL = argNum("waves", 3);
const ERROR_RATE_BREAK = 0.1; // stop escalating once a level's mean error rate crosses this
const LATENCY_BREAK_MS = 8000; // ...or mean latency crosses this
const PAUSE_BETWEEN_WAVES_MS = 500;
const PAUSE_BETWEEN_LEVELS_MS = 2000;

// A realistic mix: anonymous browsing (public tables, no auth) plus a couple
// of authenticated reads (notifications, get_my_access) using whichever real
// staging session is available -- students don't only ever browse signed out.
// scripts/.sessions.staging.json holds access tokens from whenever they were
// last seeded, which is long expired by the time this runs -- refresh via
// the stored refresh_token instead of assuming the access_token is live.
async function getFreshAuthHeaders() {
  try {
    const sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
    const first = Object.values(sessions)[0];
    const refreshToken = first?.session?.refresh_token;
    if (!refreshToken) return { apikey: ANON_KEY };
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) {
      console.warn(`[loadtest] token refresh failed, falling back to anon-only: ${JSON.stringify(body)}`);
      return { apikey: ANON_KEY };
    }
    return { apikey: ANON_KEY, Authorization: `Bearer ${body.access_token}` };
  } catch (err) {
    console.warn(`[loadtest] no usable session for authenticated requests (${err.message}), falling back to anon-only`);
    return { apikey: ANON_KEY };
  }
}
const authHeaders = await getFreshAuthHeaders();

const REQUESTS = [
  { name: "events list", url: `${SUPABASE_URL}/rest/v1/events?select=id,title&limit=10`, headers: { apikey: ANON_KEY } },
  { name: "food_items list", url: `${SUPABASE_URL}/rest/v1/food_items?select=id&limit=10`, headers: { apikey: ANON_KEY } },
  { name: "marketplace_listings list", url: `${SUPABASE_URL}/rest/v1/marketplace_listings?select=id&limit=10`, headers: { apikey: ANON_KEY } },
  { name: "canteens list", url: `${SUPABASE_URL}/rest/v1/canteens?select=id,name&limit=10`, headers: { apikey: ANON_KEY } },
  { name: "clubs list", url: `${SUPABASE_URL}/rest/v1/clubs?select=id&limit=10`, headers: { apikey: ANON_KEY } },
  { name: "notifications (auth)", url: `${SUPABASE_URL}/rest/v1/notifications?select=id&limit=1`, headers: authHeaders },
];

async function timedFetch(req) {
  const start = performance.now();
  try {
    const res = await fetch(req.url, { headers: req.headers });
    // Drain body so the connection is actually fully consumed, like a real client.
    await res.arrayBuffer().catch(() => {});
    const ms = performance.now() - start;
    return { ok: res.ok, status: res.status, ms };
  } catch (err) {
    const ms = performance.now() - start;
    return { ok: false, status: 0, ms, error: String(err?.message || err) };
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function runWave(concurrency) {
  const calls = Array.from({ length: concurrency }, (_, i) => REQUESTS[i % REQUESTS.length]);
  const results = await Promise.all(calls.map(timedFetch));
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok);
  const errorsByStatus = {};
  for (const e of errors) {
    const key = e.status === 0 ? `network:${e.error}` : `http:${e.status}`;
    errorsByStatus[key] = (errorsByStatus[key] || 0) + 1;
  }
  return {
    concurrency,
    errorRate: errors.length / results.length,
    mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies[latencies.length - 1],
    errorsByStatus,
  };
}

async function main() {
  console.log(`[loadtest] target: ${target}, requests/wave mix: ${REQUESTS.map((r) => r.name).join(", ")}`);
  console.log(`[loadtest] levels: ${LEVELS.join(", ")}  (${WAVES_PER_LEVEL} waves each)\n`);

  const report = { target, startedAt: new Date().toISOString(), levels: [] };
  let brokeAt = null;

  for (const concurrency of LEVELS) {
    const waves = [];
    for (let w = 0; w < WAVES_PER_LEVEL; w++) {
      waves.push(await runWave(concurrency));
      if (w < WAVES_PER_LEVEL - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_WAVES_MS));
    }
    const meanErrorRate = waves.reduce((a, w) => a + w.errorRate, 0) / waves.length;
    const meanLatency = waves.reduce((a, w) => a + w.mean, 0) / waves.length;
    const combinedErrors = {};
    for (const w of waves) for (const [k, v] of Object.entries(w.errorsByStatus)) combinedErrors[k] = (combinedErrors[k] || 0) + v;

    const levelResult = { concurrency, meanErrorRate, meanLatency, p95: Math.max(...waves.map((w) => w.p95)), errors: combinedErrors };
    report.levels.push(levelResult);

    const status = meanErrorRate > ERROR_RATE_BREAK || meanLatency > LATENCY_BREAK_MS ? "BREAKS DOWN" : "holds";
    console.log(
      `concurrency=${String(concurrency).padStart(4)}  errRate=${(meanErrorRate * 100).toFixed(1).padStart(5)}%  ` +
      `meanLatency=${meanLatency.toFixed(0).padStart(5)}ms  p95=${levelResult.p95.toFixed(0).padStart(5)}ms  -> ${status}` +
      (Object.keys(combinedErrors).length ? `  errors=${JSON.stringify(combinedErrors)}` : "")
    );

    if (status === "BREAKS DOWN") {
      brokeAt = concurrency;
      console.log(`\n[loadtest] error rate / latency threshold crossed at concurrency=${concurrency}. Stopping ramp.`);
      break;
    }
    await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_LEVELS_MS));
  }

  report.finishedAt = new Date().toISOString();
  report.brokeAt = brokeAt;
  report.sustainedCeiling = brokeAt ? report.levels[report.levels.length - 2]?.concurrency ?? null : LEVELS[LEVELS.length - 1];

  const outPath = path.join("scripts", `.loadtest-throughput-${target}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n[loadtest] sustained ceiling (last clean level): ${report.sustainedCeiling ?? "unknown"} concurrent requests`);
  console.log(`[loadtest] full report written to ${outPath}`);
}

main().catch((err) => {
  console.error("[loadtest] fatal:", err);
  process.exit(1);
});
