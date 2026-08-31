# Scaling & Load Test Results

Phase 7 (reliability at scale) of the readiness roadmap. This doc is the
missing write-up for `scripts/loadtest-*.mjs` and `scripts/setup/cleanup-
loadtest-users.mjs` — the scripts themselves were built and run across
several sessions but the findings were only ever recorded in chat/memory.
This is the durable record.

All scripts default to **staging** and refuse production without
`--env=production --yes-production` (see `scripts/env-target.mjs`) — these
create real throwaway data and none of them need to run against prod to be
useful.

## Free-tier ceiling: ~800–1,600 concurrent connections

`scripts/loadtest-throughput.mjs` searched for the point where Supabase's
free-tier connection pooler starts rejecting/queuing. Result: the ceiling is
around 800–1,600 concurrent DB connections, not the ~6,000 the original
roadmap assumed the college's full student body would need simultaneously.
In practice this only matters at a true "everyone hits the app in the same
30 seconds" moment (e.g. an exam-result drop or an orientation-day mass
signup) — normal usage is nowhere near this. Upgrading the Supabase plan
before any planned mass-simultaneous event is the mitigation; no code change
closes this, it's a capacity ceiling of the plan tier.

## Realtime reconnect storm: clean

`scripts/loadtest-realtime-reconnect.mjs` forces N clients × 6
`postgres_changes` channels (posts/events/food/clubs/marketplace/lost_found)
through repeated network-drop-and-reconnect cycles at once. Every channel
returns to `SUBSCRIBED` after a forced drop; none stick in
`CHANNEL_ERROR`/`TIMED_OUT`. `@supabase/realtime-js`'s vendored Phoenix
client auto-rejoins on socket reopen and every call site in
`src/services/*.js` cleans up via `supabase.removeChannel()` — no hand-
rolled reconnect logic to get wrong. No fix needed; this is a clean bill of
health, re-run this script after any change to the realtime subscription
call sites.

## Food-stock oversell race: fixed

`scripts/loadtest-food-stock-race.mjs` fires concurrent orders against a
low-stock food item. Caught a real oversell bug (stock could go negative
under concurrent checkout) before this doc existed; the fix — an atomic
`decrement`-with-floor check in the ordering RPC rather than a read-then-
write — is what the script now confirms holds. Re-run after touching food
ordering.

## 100+ concurrent users, full-scenario: clean except one real finding

`scripts/setup-loadtest-users.mjs` + `scripts/loadtest-concurrent-scenario.mjs`
+ `scripts/cleanup-loadtest-users.mjs` are a three-part harness: provision a
disposable 110-account pool (`e2e.load###@nhce.edu.in`, namespaced so
cleanup can always find and remove every row it touched even across a crashed
run), fire real concurrent traffic across auth/posts/messaging/clubs/events/
lost&found/support, then tear everything down and verify zero rows remain.

Run against staging 2026-08-30/31 (110-user pool):

| Phase | Result |
|---|---|
| Auth: raw concurrent sign-in burst | **73.6% rejected** — GoTrue's own rate limiter (`429 over_request_rate_limit`), not the app |
| Auth: gentle backoff retry of the rejected ones | 100% recovered |
| Posts: concurrent create / concurrent like+comment on one shared post | 0% errors, no duplicate `(post_id, user_id)` like rows |
| Messaging: concurrent DM start+send, group create/send/react | 0% errors |
| Clubs: concurrent join | 0% errors, no duplicate membership rows |
| Events: concurrent register against a capacity set below pool size | 0% errors, **capacity respected exactly** (55 confirmed / 55 capacity, 0 oversold) — confirms the food-stock-race-era oversell fix pattern holds for event registration too |
| Lost & found / support tickets (subset) | 0% errors |

**The one real finding**: Supabase's Auth (GoTrue) rate limiter rejects the
majority of a true simultaneous sign-in burst once it's in the ~100-user
range on the free tier — independent of the app's own code, and separate
from the DB-connection ceiling above. This matters for any real-world
moment where a large cohort logs in within the same few seconds (first day
of orientation, a class all opening the app at the bell). **Mitigation is a
dashboard setting, not code**: raise the Auth rate limit in the Supabase
project's Auth settings (or accept that a burst login will see some users
retry within a couple seconds, which the app should already surface as a
normal transient error rather than a hard failure — verify this in the UI
before a real mass-onboarding event). Folded into
[go-live runbook step 2](https://claude.ai/code/artifact/a58c4ff2-1a75-41d6-a946-6057e8b239d7)
(CI/CD + secrets/dashboard settings) as a pre-launch checklist item.

## Running it yourself

```
node scripts/setup-loadtest-users.mjs --count=110
node scripts/loadtest-concurrent-scenario.mjs
node scripts/cleanup-loadtest-users.mjs   # verifies zero rows left, not just "ran"
```

Re-run the full battery (`loadtest-throughput`, `loadtest-realtime-reconnect`,
`loadtest-food-stock-race`, and this three-script scenario) before any
capacity-sensitive change: connection pooling config, realtime subscription
call sites, ordering/checkout/registration RPCs, or ahead of a planned mass-
onboarding event.
