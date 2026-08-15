// One-off live verification script (not part of the automated suite) --
// exercises the recommendation engine (doc §108: recommend_food/
// recommend_events/recommend_clubs/recommend_opportunities,
// dismiss_recommendation, profiles.personalization_enabled) directly
// against a real Supabase project using real signed-in sessions. Prints
// PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-recommendations.mjs                 (staging)
//        node scripts/live-check-recommendations.mjs --env=production --yes-production

import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY } = resolveTarget();

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

async function main() {
  console.log("=== Recommendation engine (doc §108) ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", "Sanjay@123");
  const alice = await signIn("e2e.alice@nhce.edu.in", "TestPass!2026Alice");

  // Anonymous call is rejected -- every recommend_*() RPC requires auth.uid().
  const anon = client();
  const { error: anonErr } = await anon.rpc("recommend_food", { p_limit: 3 });
  check("recommend_food rejects an unauthenticated caller", !!anonErr, anonErr?.message);

  // --- Seed real signal data for Alice so scoring has something to score.
  // clubs/opportunities are admin-curated (RLS), so admin seeds those;
  // Alice self-joins the club (club_members_join_self) and self-organizes
  // the event (events_write allows organizer_id = auth.uid() regardless of
  // club leadership) exactly like a real student would. ---
  const { data: profileBefore } = await alice.sb.from("profiles").select("campus_id, skills, course, year").eq("id", alice.userId).single();
  check("Alice's profile is readable", !!profileBefore?.campus_id, profileBefore);
  const campusId = profileBefore.campus_id;

  const marker = `LiveCheckRec ${Date.now()}`;

  const { data: club, error: clubErr } = await admin.sb
    .from("clubs")
    .insert({ campus_id: campusId, name: marker + " Club", category: "Technology" })
    .select()
    .single();
  check("Seed: club created (admin)", !clubErr && !!club?.id, clubErr);

  const { error: joinErr } = await alice.sb.from("club_members").insert({ club_id: club.id, user_id: alice.userId, role: "member" });
  check("Alice can self-join the club", !joinErr, joinErr?.message);

  const { data: event, error: eventErr } = await alice.sb
    .from("events")
    .insert({
      campus_id: campusId, club_id: club.id, organizer_id: alice.userId, title: marker + " Event", category: "Technology",
      event_date: new Date(Date.now() + 3 * 86400000).toISOString(), published: true, registration_status: "OPEN",
    })
    .select()
    .single();
  check("Seed: event self-organized by Alice under that club", !eventErr && !!event?.id, eventErr);

  const oldSkills = profileBefore.skills || [];
  const testSkill = `LiveCheckSkill${Date.now()}`;
  await alice.sb.from("profiles").update({ skills: [...oldSkills, testSkill], personalization_enabled: true }).eq("id", alice.userId);

  const { data: opp, error: oppErr } = await admin.sb
    .from("opportunities")
    .insert({ campus_id: campusId, company: marker, role: "Tester", type: "Internship", tags: [testSkill], posted_by: admin.userId })
    .select()
    .single();
  check("Seed: opportunity created (admin) matching Alice's new skill", !oppErr && !!opp?.id, oppErr);

  // --- recommend_events: should surface the event via the club match. ---
  const { data: eventRecs, error: eventRecsErr } = await alice.sb.rpc("recommend_events", { p_limit: 25 });
  check("recommend_events succeeds", !eventRecsErr, eventRecsErr?.message);
  const foundEvent = eventRecs?.find((e) => e.id === event.id);
  check("recommend_events surfaces the event from Alice's own club, with a club-based reason", !!foundEvent && /club/i.test(foundEvent.reason), foundEvent);

  // --- recommend_clubs: should NOT surface a club Alice already joined. ---
  const { data: clubRecs, error: clubRecsErr } = await alice.sb.rpc("recommend_clubs", { p_limit: 100 });
  check("recommend_clubs succeeds", !clubRecsErr, clubRecsErr?.message);
  check("recommend_clubs excludes a club Alice already joined", !clubRecs?.some((c) => c.id === club.id), clubRecs?.find((c) => c.id === club.id));

  // --- recommend_opportunities: should surface the skill-matched one, and exclude it once applied. ---
  const { data: oppRecs, error: oppRecsErr } = await alice.sb.rpc("recommend_opportunities", { p_limit: 25 });
  check("recommend_opportunities succeeds", !oppRecsErr, oppRecsErr?.message);
  const foundOpp = oppRecs?.find((o) => o.id === opp.id);
  check("recommend_opportunities surfaces the skill-matched opportunity with 'Matches your skills'", foundOpp?.reason === "Matches your skills", foundOpp);

  await alice.sb.rpc("apply_to_opportunity", { p_opportunity_id: opp.id, p_message: "test" });
  const { data: oppRecsAfterApply } = await alice.sb.rpc("recommend_opportunities", { p_limit: 25 });
  check("recommend_opportunities excludes an opportunity Alice already applied to", !oppRecsAfterApply?.some((o) => o.id === opp.id), oppRecsAfterApply?.find((o) => o.id === opp.id));

  // --- recommend_food: just needs to succeed and return well-shaped rows (menu content is real seed data, not something this script controls). ---
  const { data: foodRecs, error: foodRecsErr } = await alice.sb.rpc("recommend_food", { p_limit: 5 });
  check("recommend_food succeeds", !foodRecsErr, foodRecsErr?.message);
  check("recommend_food rows have a reason and a canteen name", !foodRecs?.length || (typeof foodRecs[0].reason === "string" && typeof foodRecs[0].canteen_name === "string"), foodRecs?.[0]);

  // --- dismiss_recommendation: the event should disappear from future calls. ---
  const { error: dismissErr } = await alice.sb.rpc("dismiss_recommendation", { p_entity_type: "event", p_entity_id: event.id });
  check("dismiss_recommendation succeeds", !dismissErr, dismissErr?.message);
  const { data: eventRecsAfterDismiss } = await alice.sb.rpc("recommend_events", { p_limit: 25 });
  check("A dismissed event no longer appears in recommend_events", !eventRecsAfterDismiss?.some((e) => e.id === event.id), eventRecsAfterDismiss?.find((e) => e.id === event.id));

  const { error: badDismissErr } = await alice.sb.rpc("dismiss_recommendation", { p_entity_type: "not_a_real_type", p_entity_id: event.id });
  check("dismiss_recommendation rejects an unknown entity_type", !!badDismissErr, badDismissErr?.message);

  // A different student cannot read Alice's dismissals (RLS, self-only select).
  const bob = await signIn("e2e.bob@nhce.edu.in", "TestPass!2026Bob");
  const { data: bobReadsAliceDismissals } = await bob.sb.from("recommendation_dismissals").select("*").eq("user_id", alice.userId);
  check("A different student cannot read Alice's dismissals (RLS)", (bobReadsAliceDismissals || []).length === 0, bobReadsAliceDismissals);

  // --- Personalization toggle: off should still return results, with a generic (not skill-matched) reason. ---
  await alice.sb.from("profiles").update({ personalization_enabled: false }).eq("id", alice.userId);
  const { data: oppRecsOff, error: oppRecsOffErr } = await alice.sb.rpc("recommend_opportunities", { p_limit: 25 });
  check("recommend_opportunities still returns results with personalization off", !oppRecsOffErr, oppRecsOffErr?.message);
  check("With personalization off, reasons are generic, not skill/activity-based", !(oppRecsOff || []).some((o) => o.reason === "Matches your skills" || /often apply/.test(o.reason)), oppRecsOff);

  // Restore Alice's profile to how this script found it.
  await alice.sb.from("profiles").update({ skills: oldSkills, personalization_enabled: true }).eq("id", alice.userId);

  // --- Cleanup: this test data has no value once verified. ---
  await admin.sb.from("opportunity_applications").delete().eq("opportunity_id", opp.id).eq("user_id", alice.userId);
  await admin.sb.from("opportunities").delete().eq("id", opp.id);
  await alice.sb.from("events").delete().eq("id", event.id);
  await alice.sb.from("club_members").delete().eq("club_id", club.id).eq("user_id", alice.userId);
  await admin.sb.from("clubs").delete().eq("id", club.id);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
