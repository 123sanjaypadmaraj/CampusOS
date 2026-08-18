// Live verification script for the "Community & discovery depth" features
// (club self-service CMS, marketplace seller ratings, admin/vendor
// analytics) -- not a throwaway, kept alongside the other
// scripts/setup-*.mjs scripts for future re-runs. Environment-aware (see
// docs/ENVIRONMENTS.md): defaults to staging, same as every other script in
// this directory. Uses real accounts (e2e.alice/bob/carol, the admin
// account, the Udupi vendor account -- password reset to a known value if
// needed, see docs/ENVIRONMENTS.md) and the service_role key only to seed/
// clean up fixtures that RLS wouldn't otherwise let a plain student create
// (a fresh club with a real owner).
//
// Usage: node scripts/live-check-community-discovery.mjs
//        node scripts/live-check-community-discovery.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();

// Udupi's password isn't a fixed constant -- see the identical comment in
// live-check-food-hardening.mjs. Read it from the shared credentials file
// (kept in sync by live-check-store-variants-stock.mjs's admin-API reset)
// instead of a hardcoded value that goes stale the moment that runs.
const vendorCredsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";
const vendorCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", vendorCredsFile), "utf8"));
const VENDOR_PASSWORD = vendorCreds.find((v) => v.vendor === "Udupi Canteen")?.password;
if (!VENDOR_PASSWORD || VENDOR_PASSWORD.startsWith("(")) {
  throw new Error(`This script's Udupi vendor password isn't known in ${vendorCredsFile} for ${target} runs.`);
}

const ALICE = { email: "e2e.alice@nhce.edu.in", password: "TestPass!2026Alice" };
const BOB = { email: "e2e.bob@nhce.edu.in", password: "TestPass!2026Bob" };
const CAROL = { email: "e2e.carol@nhce.edu.in", password: "TestPass!2026Carol" };
const ADMIN = { email: "1nh25cs265@usn.campusos.internal", password: "Sanjay@123" };
const UDUPI_VENDOR = { email: "udupi.canteen@nhce.edu.in", password: VENDOR_PASSWORD };

let passCount = 0;
let failCount = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  [pass] ${label}`);
    passCount++;
  } else {
    console.log(`  [FAIL] ${label}${extra ? ` -- ${JSON.stringify(extra)}` : ""}`);
    failCount++;
  }
}

async function signIn({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

function client(token) {
  const headers = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${token}` };
  return {
    async rpc(name, args = {}) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
    async patch(table, filter, body) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
    async post(table, body) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
    async get(table, query) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
  };
}

const svc = client(SERVICE_ROLE_KEY);

async function main() {
  console.log("Signing in test accounts…");
  const alice = await signIn(ALICE);
  const bob = await signIn(BOB);
  const carol = await signIn(CAROL);
  const admin = await signIn(ADMIN);
  const vendor = await signIn(UDUPI_VENDOR);
  const aliceC = client(alice.token);
  const bobC = client(bob.token);
  const carolC = client(carol.token);
  const adminC = client(admin.token);
  const vendorC = client(vendor.token);

  const { data: campuses } = await svc.get("campuses", "select=id,slug&slug=eq.nhce&limit=1");
  const campusId = campuses[0].id;

  /* ===================== CLUB SELF-SERVICE ===================== */
  console.log("\n=== Club self-service CMS ===");

  // Clean up any leftover fixture from a previous run, then seed a fresh
  // club with alice as owner and bob as a plain member (service role
  // bypasses RLS -- this is the one place raw inserts are appropriate,
  // mirroring scripts/setup-test-users.mjs's own convention).
  const { data: existingClub } = await svc.get("clubs", "select=id&name=eq.E2E Test Club");
  if (existingClub?.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/clubs?id=eq.${existingClub[0].id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  }
  // events.club_id is ON DELETE SET NULL, not CASCADE (deliberate -- a real
  // student's saved/registered event shouldn't vanish just because the club
  // that hosted it later got deleted), so deleting the club above does NOT
  // delete its "E2E Club Meetup" event below -- it's orphaned with
  // club_id=null instead. Previously nothing cleaned that orphan up, and
  // since events.event_date is `date` (not timestamptz) on staging, any two
  // runs on the same calendar day collided on the (campus_id, title,
  // event_date) unique constraint. Clean up any leftover event by title too.
  const { data: existingEvent } = await svc.get("events", "select=id&title=eq.E2E Club Meetup");
  if (existingEvent?.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${existingEvent[0].id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  }
  const { data: clubRows } = await svc.post("clubs", { campus_id: campusId, name: "E2E Test Club", category: "Testing", description: "seeded by live-check script" });
  const clubId = clubRows[0].id;
  await svc.post("club_members", { club_id: clubId, user_id: alice.userId, role: "owner" });
  await svc.post("club_members", { club_id: clubId, user_id: bob.userId, role: "member" });

  const leadership = await aliceC.rpc("get_my_club_leadership");
  check("get_my_club_leadership lists the seeded club for alice", leadership.ok && leadership.data.some((r) => r.club_id === clubId), leadership.data);

  const dashboard = await aliceC.rpc("get_club_dashboard", { p_club_id: clubId });
  check("get_club_dashboard succeeds for the owner", dashboard.ok, dashboard.data);
  check("dashboard reports my_role=owner", dashboard.data?.my_role === "owner", dashboard.data?.my_role);
  check("dashboard roster has 2 members", dashboard.data?.members?.length === 2, dashboard.data?.members);

  // The bug this migration fixes: before it, USING passed for an
  // owner/president but WITH CHECK never did, so this PATCH always 400'd.
  const editClub = await aliceC.patch("clubs", `id=eq.${clubId}`, { description: "edited by the owner via RLS" });
  check("club owner can now actually save an edit (RLS with-check bug fixed)", editClub.ok && editClub.data?.[0]?.description === "edited by the owner via RLS", editClub);

  const bobEditAttempt = await bobC.patch("clubs", `id=eq.${clubId}`, { description: "bob should not be able to do this" });
  check("a plain member is still blocked from editing the club", !bobEditAttempt.ok || bobEditAttempt.data?.length === 0, bobEditAttempt);

  const newEvent = await aliceC.post("events", {
    campus_id: campusId, club_id: clubId, title: "E2E Club Meetup", category: "Club Event",
    event_date: new Date(Date.now() + 86400000).toISOString(), organizer_id: alice.userId,
  });
  check("club owner can create an event for their club", newEvent.ok, newEvent.data);
  const eventId = newEvent.data?.[0]?.id;

  const promote = await aliceC.rpc("set_club_member_role", { p_member_id: (await svc.get("club_members", `select=id&club_id=eq.${clubId}&user_id=eq.${bob.userId}`)).data[0].id, p_role: "secretary" });
  check("owner can promote a member to a leadership role", promote.ok, promote.data);

  const ownerMemberRow = (await svc.get("club_members", `select=id&club_id=eq.${clubId}&user_id=eq.${alice.userId}`)).data[0];
  const demoteLastOwner = await aliceC.rpc("set_club_member_role", { p_member_id: ownerMemberRow.id, p_role: "member" });
  check("cannot demote the last owner (CLUB_LAST_OWNER guard)", !demoteLastOwner.ok, demoteLastOwner.data);

  // Clean up the fixture. The event first (club_id is SET NULL, not
  // CASCADE, on club delete -- see the comment above where this event was
  // pre-cleaned) so no orphan is left for the next run to collide with.
  if (eventId) {
    await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${eventId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  }
  await fetch(`${SUPABASE_URL}/rest/v1/clubs?id=eq.${clubId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  console.log("  (cleaned up E2E Test Club fixture)");

  /* ===================== MARKETPLACE SELLER RATINGS ===================== */
  console.log("\n=== Marketplace seller-rating depth ===");

  const { data: oldListings } = await svc.get("marketplace_listings", "select=id&title=eq.E2E Test Widget");
  for (const l of oldListings || []) {
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_listings?id=eq.${l.id}`, { method: "DELETE", headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
    // Previously unchecked -- a silent failure here (e.g. the now-fixed
    // undeletable-rated-listing trigger bug) let stale fixtures accumulate
    // across runs and inflate seller_rating_summary's count. Surface it loudly.
    if (!delRes.ok) console.log(`  [warn] cleanup: failed to delete stale listing ${l.id}: ${delRes.status} ${await delRes.text()}`);
  }
  const listing = await aliceC.post("marketplace_listings", { campus_id: campusId, seller_id: alice.userId, title: "E2E Test Widget", price: 100, category: "Other" });
  check("alice can create a listing", listing.ok, listing.data);
  const listingId = listing.data[0].id;

  const soldToBob = await aliceC.rpc("mark_listing_sold", { p_listing_id: listingId, p_buyer_id: bob.userId });
  check("alice can mark the listing sold to bob", soldToBob.ok && soldToBob.data?.buyer_id === bob.userId, soldToBob.data);

  const carolRatesAlice = await carolC.rpc("submit_seller_rating", { p_seller_id: alice.userId, p_listing_id: listingId, p_rating: 5 });
  check("carol (not the buyer) is REJECTED by the eligibility trigger", !carolRatesAlice.ok, carolRatesAlice.data);

  const unratedBeforeBob = await bobC.rpc("get_my_unrated_purchases");
  check("bob's unrated-purchases list includes this listing before rating", unratedBeforeBob.ok && unratedBeforeBob.data.some((p) => p.listing_id === listingId), unratedBeforeBob.data);

  const bobRatesAlice = await bobC.rpc("submit_seller_rating", { p_seller_id: alice.userId, p_listing_id: listingId, p_rating: 5, p_comment: "Great seller!" });
  check("bob (the real buyer) CAN rate alice", bobRatesAlice.ok, bobRatesAlice.data);

  const unratedAfterBob = await bobC.rpc("get_my_unrated_purchases");
  check("the listing drops off bob's unrated-purchases list after rating", unratedAfterBob.ok && !unratedAfterBob.data.some((p) => p.listing_id === listingId), unratedAfterBob.data);

  const summary = await bobC.get("seller_rating_summary", `select=*&seller_id=eq.${alice.userId}`);
  check("seller_rating_summary reflects the new rating", summary.ok && Number(summary.data?.[0]?.avg_rating) === 5 && Number(summary.data?.[0]?.rating_count) === 1, summary.data);

  console.log("  (leaving E2E Test Widget listing + rating for manual inspection is unnecessary; cleaning up)");
  // Deleting the listing only nulls seller_ratings.listing_id (ON DELETE SET
  // NULL, not CASCADE -- ratings are meant to be a permanent record) -- the
  // rating row itself survives forever unless deleted explicitly, which
  // previously nothing did. seller_rating_summary aggregates ALL of a
  // seller's rows regardless of listing_id, so across repeated runs against
  // this same shared alice/bob fixture, rating_count silently climbed by 1
  // every time (2, then 3, ...) and permanently broke the "count === 1"
  // assertion below for good, not just for the run that happened to leave a
  // stale row. Delete the rating this run created too, by id (captured
  // before the listing/FK-null happens), so the fixture is fully isolated.
  const ratingId = bobRatesAlice.data?.id;
  if (ratingId) {
    await fetch(`${SUPABASE_URL}/rest/v1/seller_ratings?id=eq.${ratingId}`, { method: "DELETE", headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
  }
  const finalDelRes = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_listings?id=eq.${listingId}`, { method: "DELETE", headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
  if (!finalDelRes.ok) console.log(`  [warn] cleanup: failed to delete ${listingId}: ${finalDelRes.status} ${await finalDelRes.text()}`);

  /* ===================== ANALYTICS ===================== */
  console.log("\n=== Analytics (DAU/GMV/AOV/SLA) ===");

  const ping = await aliceC.rpc("touch_activity");
  check("touch_activity succeeds for a signed-in user", ping.ok, ping.data);

  const dau = await adminC.rpc("admin_dau_series", { p_days: 7 });
  check("admin_dau_series returns 7 rows and today includes alice", dau.ok && dau.data?.length === 7 && dau.data[dau.data.length - 1].dau >= 1, dau.data);

  const wau = await adminC.rpc("admin_active_users_window", { p_days: 7 });
  check("admin_active_users_window returns a sane count", wau.ok && Number(wau.data) >= 1, wau.data);

  const gmv = await adminC.rpc("admin_gmv_series", { p_days: 30 });
  check("admin_gmv_series returns rows with gmv/orders_count/aov shape", gmv.ok && gmv.data?.length === 30 && "aov" in (gmv.data[0] || {}), gmv.data?.[0]);

  const topCanteens = await adminC.rpc("admin_top_canteens_gmv", { p_days: 30 });
  check("admin_top_canteens_gmv returns canteen rows", topCanteens.ok && Array.isArray(topCanteens.data), topCanteens.data);

  const sla = await adminC.rpc("admin_sla_summary", { p_days: 30 });
  check("admin_sla_summary returns both food_order and ticket domains", sla.ok && sla.data?.some((r) => r.domain === "food_order") && sla.data?.some((r) => r.domain === "ticket"), sla.data);

  const studentDenied = await aliceC.rpc("admin_dau_series", { p_days: 7 });
  check("a plain student is denied analytics.read", !studentDenied.ok, studentDenied.data);

  const vendorGmv = await vendorC.rpc("vendor_gmv_series", { p_days: 30 });
  check("vendor_gmv_series works for the Udupi canteen vendor", vendorGmv.ok && vendorGmv.data?.length === 30, vendorGmv.data?.[0]);

  const vendorSla = await vendorC.rpc("vendor_sla_summary", { p_days: 30 });
  check("vendor_sla_summary returns a food_order row for the canteen vendor", vendorSla.ok && vendorSla.data?.[0]?.domain === "food_order", vendorSla.data);

  const studentVendorDenied = await aliceC.rpc("vendor_gmv_series", { p_days: 30 });
  check("a plain student (no canteen/print shop) is rejected by vendor_gmv_series", !studentVendorDenied.ok, studentVendorDenied.data);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
