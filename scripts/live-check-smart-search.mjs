// One-off live verification script (not part of the automated suite) --
// exercises Smart Search (doc §72 / "17. Smart Search":
// supabase/migrations/20260816000200_smart_search.sql +
// 20260816000300_fix_global_search_overload.sql) directly against a real
// Supabase project using real signed-in sessions. Prints PASS/FAIL per
// assertion.
//
// Usage: node scripts/live-check-smart-search.mjs                 (staging)
//        node scripts/live-check-smart-search.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, root, target } = resolveTarget();

// Admin's password isn't a fixed constant either -- see setup-admin-account.mjs's
// header for why (an earlier version hardcoded adminPassword() here; compromised).
const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
function adminPassword() {
  const p = path.join(root, "scripts", adminCredsFile);
  if (!fs.existsSync(p)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first (the account already exists, so a plain run won't write this file).`);
  return JSON.parse(fs.readFileSync(p, "utf8")).password;
}
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const e2ePassword = (email) => {
  const password = e2eCreds.find((r) => r.email === email)?.password;
  if (!password) throw new Error(`No password known for ${email} in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
  return password;
};


let passCount = 0;
let failCount = 0;
function check(label, cond, extra) {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}${extra ? " -- " + JSON.stringify(extra) : ""}`);
  }
}

function client() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

async function search(sb, query, opts = {}) {
  const { data, error } = await sb.rpc("global_search", { p_query: query, p_limit: opts.limit ?? 8, p_types: opts.types ?? null });
  if (error) throw error;
  return data || [];
}

async function main() {
  console.log("=== Smart Search (doc §72) ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));

  const { data: profileBefore } = await alice.sb.from("profiles").select("campus_id").eq("id", alice.userId).single();
  const campusId = profileBefore.campus_id;
  const marker = `SmartSearch${Date.now()}`;

  // --- Anonymous callers are rejected (authenticated-only, unchanged from before) ---
  const anon = client();
  const { error: anonErr } = await anon.rpc("global_search", { p_query: "test", p_limit: 5 });
  check("An unauthenticated caller is rejected", !!anonErr, anonErr?.message);

  // --- Seed one of each new entity type, tagged with the marker ---
  const { data: canteen } = await admin.sb.from("canteens").insert({ campus_id: campusId, name: marker + " Canteen", subtitle: "Test vendor" }).select().single();
  const { data: store } = await admin.sb.from("stores").insert({ campus_id: campusId, name: marker + " Store", category: "General", subtitle: "Test store" }).select().single();
  const { data: storeItem } = await admin.sb.from("store_items").insert({ store_id: store.id, name: marker + " Notebook", description: "Ruled notebook" }).select().single();
  const { data: opportunity } = await admin.sb.from("opportunities").insert({ campus_id: campusId, company: marker + " Corp", role: "Intern", description: "A test internship", tags: ["testing"] }).select().single();
  const { data: existingLocation } = await admin.sb.from("locations").select("id, name").limit(1).maybeSingle();

  // --- Basic cross-type search finds every seeded entity. Uses an exact
  // entity_id match (not "whichever row of that type came back first") --
  // markers are Date.now()-based and generated seconds apart across a
  // debugging session, so typo-tolerant similarity can legitimately pull
  // in a leftover row from an earlier run with a near-identical marker. ---
  const results = await search(alice.sb, marker);
  check("Finds the seeded canteen (vendor)", results.some((r) => r.entity_type === "canteen" && r.entity_id === canteen.id), results.filter((r) => r.entity_type === "canteen"));
  check("Finds the seeded store (vendor)", results.some((r) => r.entity_type === "store_vendor" && r.entity_id === store.id), results.filter((r) => r.entity_type === "store_vendor"));
  check("Finds the seeded store item", results.some((r) => r.entity_type === "store_item" && r.entity_id === storeItem.id), results.filter((r) => r.entity_type === "store_item"));
  check("Finds the seeded opportunity", results.some((r) => r.entity_type === "opportunity" && r.entity_id === opportunity.id), results.filter((r) => r.entity_type === "opportunity"));

  // --- Typo tolerance: a misspelled marker still finds the canteen via similarity fallback ---
  const typoMarker = marker.slice(0, -3) + "xzq"; // corrupt the last 3 chars, e.g. "...123" -> "...1xzq"
  const typoResults = await search(alice.sb, typoMarker);
  check("A typo'd query still finds the seeded canteen via similarity fallback", typoResults.some((r) => r.entity_id === canteen.id), typoResults.map((r) => r.entity_type));

  // A truly unrelated query should NOT match at all (typo tolerance isn't matching everything).
  const unrelated = await search(alice.sb, "zzznomatchxyzqwerty987");
  check("A genuinely unrelated query returns nothing", unrelated.length === 0, unrelated);

  // --- Filters: p_types narrows to just the requested entity type(s) ---
  const filtered = await search(alice.sb, marker, { types: ["opportunity"] });
  check("p_types=['opportunity'] returns only opportunities", filtered.length > 0 && filtered.every((r) => r.entity_type === "opportunity"), filtered.map((r) => r.entity_type));

  // --- Locations: searches the REAL pre-existing locations table (not a duplicate) ---
  if (existingLocation) {
    const locResults = await search(alice.sb, existingLocation.name.slice(0, 6), { types: ["location"] });
    check("Locations search hits the real locations table", locResults.some((r) => r.entity_id === existingLocation.id), locResults);
  } else {
    check("Locations search hits the real locations table", false, "no rows in public.locations to test against");
  }

  // --- Personalization: a club whose category matches one of Alice's own club
  // memberships should out-rank an otherwise-identical club in a different category ---
  const { data: aliceClub } = await admin.sb.from("clubs").insert({ campus_id: campusId, name: marker + " Alice Home Club", category: "Technology" }).select().single();
  const { data: aliceMemberRow } = await alice.sb.from("club_members").insert({ club_id: aliceClub.id, user_id: alice.userId, role: "member" }).select().single();

  const { data: matchClub } = await admin.sb.from("clubs").insert({ campus_id: campusId, name: marker + " Boost Alpha", category: "Technology", description: "shared description text" }).select().single();
  const { data: nonMatchClub } = await admin.sb.from("clubs").insert({ campus_id: campusId, name: marker + " Boost Beta", category: "Cultural", description: "shared description text" }).select().single();

  const boostResults = await search(alice.sb, marker + " Boost", { types: ["club"] });
  const matchRow = boostResults.find((r) => r.entity_id === matchClub.id);
  const nonMatchRow = boostResults.find((r) => r.entity_id === nonMatchClub.id);
  check(
    "A club sharing a category with Alice's own club ranks above an equivalent club that doesn't",
    !!matchRow && !!nonMatchRow && matchRow.rank > nonMatchRow.rank,
    { matchRank: matchRow?.rank, nonMatchRank: nonMatchRow?.rank }
  );

  // Bob (no shared club category) should NOT see the same boost.
  const boostResultsBob = await search(bob.sb, marker + " Boost", { types: ["club"] });
  const matchRowBob = boostResultsBob.find((r) => r.entity_id === matchClub.id);
  const nonMatchRowBob = boostResultsBob.find((r) => r.entity_id === nonMatchClub.id);
  check(
    "Bob (not a member of any matching-category club) sees roughly equal ranks",
    !!matchRowBob && !!nonMatchRowBob && Math.abs(matchRowBob.rank - nonMatchRowBob.rank) < 0.02,
    { matchRank: matchRowBob?.rank, nonMatchRank: nonMatchRowBob?.rank }
  );

  // --- Recent searches ---
  await admin.sb.from("search_history").delete().eq("user_id", alice.userId); // clean slate for a deterministic check
  const { error: logErr } = await alice.sb.rpc("log_search", { p_query: marker + " first search" });
  check("log_search succeeds", !logErr, logErr?.message);
  await alice.sb.rpc("log_search", { p_query: marker + " second search" });
  await alice.sb.rpc("log_search", { p_query: marker + " second search" }); // repeat -- should bump, not duplicate

  const { data: recent, error: recentErr } = await alice.sb.rpc("get_recent_searches", { p_limit: 10 });
  check("get_recent_searches returns both distinct queries, newest first", !recentErr && recent?.[0]?.query === marker + " second search" && recent?.[1]?.query === marker + " first search", recent);
  check("Repeating the same search doesn't create a duplicate row", recent?.length === 2, recent);

  const { error: bobRecentErr, data: bobRecent } = await bob.sb.rpc("get_recent_searches", { p_limit: 10 });
  check("Bob's recent searches don't include Alice's (self-scoped)", !bobRecentErr && !(bobRecent || []).some((r) => r.query.startsWith(marker)), bobRecent);

  const { error: clearErr } = await alice.sb.rpc("clear_recent_searches");
  const { data: afterClear } = await alice.sb.rpc("get_recent_searches", { p_limit: 10 });
  check("clear_recent_searches empties Alice's history", !clearErr && (afterClear || []).length === 0, afterClear);

  // --- Trending suggestions: Bob's searches show up for Alice (same campus), not for Bob himself ---
  await bob.sb.rpc("log_search", { p_query: marker + " trending term" });
  const { data: suggestionsForAlice } = await alice.sb.rpc("get_search_suggestions", { p_limit: 20 });
  check("Trending suggestions surface another student's recent search", (suggestionsForAlice || []).some((s) => s.query === marker + " trending term"), suggestionsForAlice);
  const { data: suggestionsForBob } = await bob.sb.rpc("get_search_suggestions", { p_limit: 20 });
  check("Trending suggestions exclude the caller's own searches", !(suggestionsForBob || []).some((s) => s.query === marker + " trending term"), suggestionsForBob);

  // --- Cleanup ---
  await admin.sb.from("search_history").delete().in("query", [marker + " trending term"]);
  await alice.sb.from("club_members").delete().eq("id", aliceMemberRow.id);
  await admin.sb.from("clubs").delete().in("id", [aliceClub.id, matchClub.id, nonMatchClub.id]);
  await admin.sb.from("opportunities").delete().eq("id", opportunity.id);
  await admin.sb.from("store_items").delete().eq("id", storeItem.id);
  await admin.sb.from("stores").delete().eq("id", store.id);
  await admin.sb.from("canteens").delete().eq("id", canteen.id);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
