// Phase 7 (Reliability at scale) -- realtime reconnect-storm test. The last
// open item from the phase-7 audit: static code review found every channel
// site in the app (src/services/*.js) cleans up correctly via
// supabase.removeChannel() and none of them hand-roll reconnect logic (they
// all rely on @supabase/realtime-js's own vendored Phoenix client, which
// auto-rejoins channels when its socket reopens -- see RealtimeChannel.js /
// RealtimeClient.js). That's a sound design, but nobody had actually forced
// a reconnect storm against a live project to confirm it holds up. This does.
//
// What it simulates: N independent browser-tab-like clients (own realtime
// websocket each), all subscribed to the same public postgres_changes
// channels the app actually opens (posts/events/food/clubs/marketplace/
// lost_found -- see subscribeToX() in src/services/mvpService.js), then
// forces repeated network-drop-and-reconnect cycles across all of them at
// once (jittered, not perfectly synchronized -- like everyone's phone
// regaining wifi within the same few hundred ms) and measures whether every
// channel comes back to SUBSCRIBED, how long that takes, and whether
// anything gets stuck in CHANNEL_ERROR/TIMED_OUT instead of recovering.
//
// Deliberately modest scale: this is testing reconnect *correctness*, not
// re-running the throughput ceiling search from loadtest-throughput.mjs.
// Default 20 clients x 6 channels = 120 concurrent channels across 20
// sockets, well under Supabase's free-tier realtime connection limits.
//
// Read-only (postgres_changes subscriptions only, no writes, no error_logs
// rows written -- this script observes channel status client-side via its
// own callback rather than going through the app's logClientError()).
// Defaults to staging; refuses production without --env=production
// --yes-production (see scripts/env-target.mjs).
//
// Usage: node scripts/loadtest-realtime-reconnect.mjs
//        node scripts/loadtest-realtime-reconnect.mjs --clients=30 --rounds=6

import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, target } = resolveTarget();

const args = process.argv.slice(2);
const argNum = (name, def) => {
  const raw = args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  return raw ? Number(raw) : def;
};

const N_CLIENTS = argNum("clients", 20);
const ROUNDS = argNum("rounds", 5);
const INITIAL_SUBSCRIBE_TIMEOUT_MS = 20000;
const RECOVERY_TIMEOUT_MS = 20000;
const PAUSE_BETWEEN_ROUNDS_MS = 1500;

// Same tables the app's real public channels subscribe to (mvpService.js:
// subscribeToPosts/Events/Food/Clubs/Marketplace/LostFound). Channel *names*
// are test-scoped (not the production topic strings) purely so nothing here
// is confused with real traffic if inspected mid-run -- the table/RLS/
// replication wiring being exercised is identical either way, since that's
// keyed off the postgres_changes subscription, not the channel topic.
const CHANNEL_SPECS = [
  { key: "posts", tables: ["posts", "post_likes", "comments"] },
  { key: "events", tables: ["events", "event_registrations"] },
  { key: "food", tables: ["canteens", "food_items"] },
  { key: "clubs", tables: ["clubs", "club_members"] },
  { key: "marketplace", tables: ["marketplace_listings"] },
  { key: "lost_found", tables: ["lost_found_items"] },
];

function makeClient(id) {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { params: { eventsPerSecond: 10 } },
  });

  const channels = CHANNEL_SPECS.map((spec) => {
    const record = { key: spec.key, status: null, transitions: [], lastError: null };
    let ch = supabase.channel(`storm-test:${id}:${spec.key}`);
    for (const table of spec.tables) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, () => {});
    }
    ch.subscribe((status, err) => {
      record.status = status;
      record.transitions.push({ status, t: Date.now(), err: err?.message });
      if (err) record.lastError = err.message;
    });
    record.channel = ch;
    return record;
  });

  return { id, supabase, channels };
}

function allSubscribed(client) {
  return client.channels.every((c) => c.status === "SUBSCRIBED");
}

function anyErroredOrTimedOut(client) {
  return client.channels.some((c) => c.status === "CHANNEL_ERROR" || c.status === "TIMED_OUT");
}

async function waitUntil(predicate, timeoutMs, pollMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return { ok: true, ms: Date.now() - start };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, ms: Date.now() - start };
}

async function main() {
  console.log(`[realtime-storm] target: ${target}`);
  console.log(`[realtime-storm] ${N_CLIENTS} clients x ${CHANNEL_SPECS.length} channels each = ${N_CLIENTS * CHANNEL_SPECS.length} concurrent channels, ${ROUNDS} storm rounds\n`);

  const clients = Array.from({ length: N_CLIENTS }, (_, i) => makeClient(i));

  console.log("[realtime-storm] waiting for initial subscribe...");
  const initial = await waitUntil(() => clients.every(allSubscribed), INITIAL_SUBSCRIBE_TIMEOUT_MS);
  const initialFailed = clients.filter((c) => !allSubscribed(c));
  console.log(
    `[realtime-storm] initial subscribe: ${initial.ok ? "all clients up" : `${clients.length - initialFailed.length}/${clients.length} up`} in ${initial.ms}ms` +
    (initialFailed.length ? `  (stuck: ${initialFailed.map((c) => `client${c.id}[${c.channels.filter((ch) => ch.status !== "SUBSCRIBED").map((ch) => `${ch.key}:${ch.status}`).join(",")}]`).join(" ")})` : "")
  );

  const roundReports = [];
  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n[realtime-storm] round ${round}/${ROUNDS}: dropping ${clients.length} client sockets (jittered)...`);
    const dropStart = Date.now();

    // Force-close the raw websocket transport underneath each client, for
    // every client near-simultaneously but with a small random stagger, like
    // a real wifi-flap event doesn't land on every device in the exact same
    // millisecond. Deliberately NOT calling the client's own disconnect()/
    // connect() API pair here: disconnect() is an *intentional* disconnect
    // (it sets closeWasClean and disables the library's own reconnect timer,
    // requiring an explicit connect() call to come back -- and connect() is
    // a synchronous no-op while disconnect()'s promise is still settling, an
    // easy way to accidentally simulate "app code that forgot to reconnect,"
    // not a real network blip). Closing the transport directly triggers the
    // same onConnClose() a genuine dropped connection would, which schedules
    // the vendored Phoenix client's own reconnectTimer -- exactly the
    // automatic-backoff path real users hit and that this test exists to
    // verify, with no explicit reconnect call from this script at all.
    await Promise.all(
      clients.map(async (c) => {
        await new Promise((r) => setTimeout(r, Math.random() * 300));
        // Reset per-round transition log so recovery can be measured cleanly,
        // but keep the running total for the final error tally.
        c._roundStartTransitions = c.channels.map((ch) => ch.transitions.length);
        try {
          c.supabase.realtime.socketAdapter.getSocket().conn?.close();
        } catch (err) {
          console.warn(`[realtime-storm] couldn't force-close client${c.id}'s socket: ${err.message}`);
        }
      })
    );

    const recovery = await waitUntil(() => clients.every(allSubscribed), RECOVERY_TIMEOUT_MS);
    const stillDown = clients.filter((c) => !allSubscribed(c));
    const errored = clients.filter(anyErroredOrTimedOut);

    const report = {
      round,
      recovered: recovery.ok,
      recoveryMs: recovery.ms,
      stillDownCount: stillDown.length,
      erroredCount: errored.length,
    };
    roundReports.push(report);

    console.log(
      `[realtime-storm] round ${round}: ${recovery.ok ? "all recovered" : `${clients.length - stillDown.length}/${clients.length} recovered`} ` +
      `in ${recovery.ms}ms, ${errored.length} client(s) saw CHANNEL_ERROR/TIMED_OUT during recovery` +
      (stillDown.length ? `  (still down: client${stillDown.map((c) => c.id).join(",client")})` : "")
    );

    if (round < ROUNDS) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_ROUNDS_MS));
    void dropStart;
  }

  console.log("\n[realtime-storm] cleaning up...");
  await Promise.all(
    clients.map(async (c) => {
      try {
        await c.supabase.removeAllChannels();
      } catch (err) {
        console.warn(`[realtime-storm] cleanup warning for client${c.id}: ${err.message}`);
      }
    })
  );

  const allRecovered = roundReports.every((r) => r.recovered);
  const totalErrored = roundReports.reduce((a, r) => a + r.erroredCount, 0);
  console.log(`\n[realtime-storm] === ${allRecovered ? "PASS" : "FAIL"} ===`);
  console.log(`[realtime-storm] initial subscribe: ${initial.ok ? "clean" : "had stragglers"} (${initial.ms}ms)`);
  console.log(`[realtime-storm] ${ROUNDS} rounds: ${roundReports.filter((r) => r.recovered).length}/${ROUNDS} fully recovered within ${RECOVERY_TIMEOUT_MS}ms; ${totalErrored} client-rounds saw a transient CHANNEL_ERROR/TIMED_OUT en route to recovery`);
  console.log(`[realtime-storm] recovery times: ${roundReports.map((r) => `${r.recoveryMs}ms`).join(", ")}`);

  process.exitCode = allRecovered ? 0 : 1;
  // The realtime client's heartbeat timers keep the event loop alive even
  // after removeAllChannels(); force exit once everything above is done.
  setTimeout(() => process.exit(process.exitCode), 250);
}

main().catch((err) => {
  console.error("[realtime-storm] fatal:", err);
  process.exit(1);
});
