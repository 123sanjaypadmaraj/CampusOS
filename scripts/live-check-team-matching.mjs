// One-off live verification script (not part of the automated suite) --
// exercises Project / Team Matching (doc §22:
// supabase/migrations/20260817000200_team_matching.sql) directly against a
// real Supabase project using real signed-in sessions. Prints PASS/FAIL per
// assertion.
//
// Usage: node scripts/live-check-team-matching.mjs                 (staging)
//        node scripts/live-check-team-matching.mjs --env=production --yes-production

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
    console.log(`  FAIL  ${label}${extra !== undefined ? " -- " + JSON.stringify(extra) : ""}`);
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
  console.log("=== Project / Team Matching (doc §22) ===");
  const alice = await signIn("e2e.alice@nhce.edu.in", "TestPass!2026Alice");
  const bob = await signIn("e2e.bob@nhce.edu.in", "TestPass!2026Bob");
  const carol = await signIn("e2e.carol@nhce.edu.in", "TestPass!2026Carol");

  const { data: profileBefore } = await alice.sb.from("profiles").select("campus_id").eq("id", alice.userId).single();
  const campusId = profileBefore.campus_id;
  const marker = `TeamMatch${Date.now()}`;

  const createdTeamIds = [];
  async function createTeam(sb, overrides = {}) {
    const { data, error } = await sb.rpc("create_project_team", {
      p_title: `${marker} ${overrides.p_title || "Team"}`,
      p_description: "Live-check team",
      p_category: "Hackathon",
      p_context: null,
      p_skills_have: ["Node.js"],
      p_skills_needed: overrides.p_skills_needed || ["React"],
      p_max_members: overrides.p_max_members ?? 4,
      p_deadline: null,
      p_external_link: null,
    });
    if (error) throw error;
    createdTeamIds.push(data.id);
    return data;
  }

  // --- Save + restore Bob's and Carol's skills/open_to_projects so the
  // skill-matching checks below have known state, without permanently
  // altering their real e2e profiles. ---
  const { data: bobProfileBefore } = await bob.sb.from("profiles").select("skills, open_to_projects").eq("id", bob.userId).single();
  const { data: carolProfileBefore } = await carol.sb.from("profiles").select("skills, open_to_projects").eq("id", carol.userId).single();

  try {
    // --- Anonymous callers are rejected ---
    const anon = client();
    const { error: anonErr } = await anon.rpc("list_project_teams", { p_campus_id: campusId });
    check("An unauthenticated caller is rejected by list_project_teams", !!anonErr, anonErr?.message);
    const { error: anonCreateErr } = await anon.rpc("create_project_team", { p_title: "Nope" });
    check("An unauthenticated caller is rejected by create_project_team", !!anonCreateErr, anonCreateErr?.message);

    // --- Create + browse: a team is its own recruitment post ---
    const team = await createTeam(alice.sb, { p_title: "Alpha", p_max_members: 3, p_skills_needed: ["React", "Embedded Systems"] });
    check("create_project_team returns a real row with the owner set", team.owner_id === alice.userId, team);

    const myTeams = await alice.sb.rpc("get_my_teams").then((r) => r.data);
    check("The owner sees the new team in get_my_teams with role=owner", myTeams.some((t) => t.id === team.id && t.role === "owner"), myTeams);

    const browse = await alice.sb.rpc("list_project_teams", { p_campus_id: campusId, p_status: "recruiting", p_search: marker }).then((r) => r.data);
    check("list_project_teams finds the new team by search", browse.some((t) => t.id === team.id), browse.map((t) => t.title));

    // --- Applications: Bob applies, Alice reviews ---
    const app = await bob.sb.rpc("apply_to_team", { p_team_id: team.id, p_message: "I know React" }).then((r) => { if (r.error) throw r.error; return r.data; });
    check("Bob's application is recorded as pending", app.status === "pending", app);

    const { error: dupAppErr } = await bob.sb.rpc("apply_to_team", { p_team_id: team.id });
    check("A second pending application from the same student is rejected", !!dupAppErr, dupAppErr?.message);

    const { error: carolReviewErr } = await carol.sb.rpc("review_team_application", { p_application_id: app.id, p_decision: "accepted" });
    check("A non-owner cannot review someone else's application", !!carolReviewErr, carolReviewErr?.message);

    const reviewed = await alice.sb.rpc("review_team_application", { p_application_id: app.id, p_decision: "accepted" }).then((r) => { if (r.error) throw r.error; return r.data; });
    check("The owner can accept the application", reviewed.status === "accepted", reviewed);

    const detailAfterAccept = await alice.sb.rpc("get_project_team", { p_team_id: team.id }).then((r) => { if (r.error) throw r.error; return r.data; });
    check("Bob now appears in the team roster", detailAfterAccept.members.some((m) => m.user_id === bob.userId), detailAfterAccept.members);

    // --- Capacity enforcement (max_members=3, owner + bob = 2; one more accept reaches 3/full) ---
    const capApp = await carol.sb.rpc("apply_to_team", { p_team_id: team.id }).then((r) => { if (r.error) throw r.error; return r.data; });
    const capReview = await alice.sb.rpc("review_team_application", { p_application_id: capApp.id, p_decision: "accepted" }).then((r) => { if (r.error) throw r.error; return r.data; });
    const teamAfterFull = await alice.sb.rpc("get_project_team", { p_team_id: team.id }).then((r) => r.data);
    check("The team auto-flips to 'full' once max_members is reached", teamAfterFull.team.status === "full", teamAfterFull.team.status);
    check("Carol's accept succeeded (was the 3rd/last slot)", capReview.status === "accepted", capReview);

    const dave = alice; // reuse alice's own session to attempt a 4th application (rejected either way -- she's already the owner)
    const { error: ownerApplyErr } = await dave.sb.rpc("apply_to_team", { p_team_id: team.id });
    check("The owner cannot apply to their own team", !!ownerApplyErr, ownerApplyErr?.message);

    // A genuinely new 4th applicant against a FULL team should be rejected outright.
    const { error: notRecruitingErr } = await bob.sb.rpc("apply_to_team", { p_team_id: team.id });
    check("Applying to a full/non-recruiting team is rejected", !!notRecruitingErr, notRecruitingErr?.message);

    // --- Invitations: Alice invites Carol to a fresh team, Carol accepts ---
    const inviteTeam = await createTeam(alice.sb, { p_title: "Beta", p_max_members: 2 });
    const invite = await alice.sb.rpc("invite_to_team", { p_team_id: inviteTeam.id, p_invitee_id: carol.userId, p_message: "Join us" }).then((r) => { if (r.error) throw r.error; return r.data; });
    check("invite_to_team records a pending invitation", invite.status === "pending", invite);

    const { error: nonOwnerInviteErr } = await bob.sb.rpc("invite_to_team", { p_team_id: inviteTeam.id, p_invitee_id: carol.userId });
    check("A non-owner cannot send invitations for this team", !!nonOwnerInviteErr, nonOwnerInviteErr?.message);

    const myInvites = await carol.sb.rpc("get_my_team_invitations").then((r) => r.data);
    check("Carol sees the pending invitation in get_my_team_invitations", myInvites.some((i) => i.id === invite.id), myInvites);

    const responded = await carol.sb.rpc("respond_to_team_invitation", { p_invitation_id: invite.id, p_decision: "accepted" }).then((r) => { if (r.error) throw r.error; return r.data; });
    check("Carol can accept her own invitation", responded.status === "accepted", responded);

    const inviteTeamDetail = await alice.sb.rpc("get_project_team", { p_team_id: inviteTeam.id }).then((r) => r.data);
    check("Carol is now a member after accepting the invitation", inviteTeamDetail.members.some((m) => m.user_id === carol.userId), inviteTeamDetail.members);
    check("Team auto-flips to 'full' via invitation-accept too (max_members=2)", inviteTeamDetail.team.status === "full", inviteTeamDetail.team.status);

    // --- Decline path on a separate team ---
    const declineTeam = await createTeam(alice.sb, { p_title: "Gamma" });
    const declineInvite = await alice.sb.rpc("invite_to_team", { p_team_id: declineTeam.id, p_invitee_id: bob.userId }).then((r) => r.data);
    const declined = await bob.sb.rpc("respond_to_team_invitation", { p_invitation_id: declineInvite.id, p_decision: "declined" }).then((r) => { if (r.error) throw r.error; return r.data; });
    check("Bob can decline an invitation", declined.status === "declined", declined);
    const declineTeamDetail = await alice.sb.rpc("get_project_team", { p_team_id: declineTeam.id }).then((r) => r.data);
    check("A declined invitee is NOT added as a member", !declineTeamDetail.members.some((m) => m.user_id === bob.userId), declineTeamDetail.members);

    // --- Membership management: remove + leave ---
    const mgmtTeam = await createTeam(alice.sb, { p_title: "Delta", p_max_members: 5 });
    const mgmtApp = await bob.sb.rpc("apply_to_team", { p_team_id: mgmtTeam.id }).then((r) => r.data);
    await alice.sb.rpc("review_team_application", { p_application_id: mgmtApp.id, p_decision: "accepted" });

    const { error: removeOwnerErr } = await alice.sb.rpc("remove_team_member", { p_team_id: mgmtTeam.id, p_user_id: alice.userId });
    check("The owner cannot be removed from their own team", !!removeOwnerErr, removeOwnerErr?.message);

    const { error: ownerLeaveErr } = await alice.sb.rpc("leave_team", { p_team_id: mgmtTeam.id });
    check("The owner cannot leave their own team (must delete instead)", !!ownerLeaveErr, ownerLeaveErr?.message);

    await alice.sb.rpc("remove_team_member", { p_team_id: mgmtTeam.id, p_user_id: bob.userId });
    const mgmtAfterRemove = await alice.sb.rpc("get_project_team", { p_team_id: mgmtTeam.id }).then((r) => r.data);
    check("remove_team_member actually removes the member", !mgmtAfterRemove.members.some((m) => m.user_id === bob.userId), mgmtAfterRemove.members);

    const mgmtApp2 = await bob.sb.rpc("apply_to_team", { p_team_id: mgmtTeam.id }).then((r) => r.data);
    await alice.sb.rpc("review_team_application", { p_application_id: mgmtApp2.id, p_decision: "accepted" });
    const { error: leaveErr } = await bob.sb.rpc("leave_team", { p_team_id: mgmtTeam.id });
    check("A regular member can leave the team", !leaveErr, leaveErr?.message);

    // --- Skill matching: get_team_candidates ranks a matching, opted-in student ---
    await bob.sb.from("profiles").update({ skills: ["React", "Node.js"], open_to_projects: true }).eq("id", bob.userId);
    await carol.sb.from("profiles").update({ skills: ["Figma"], open_to_projects: false }).eq("id", carol.userId);

    const matchTeam = await createTeam(alice.sb, { p_title: "Epsilon", p_skills_needed: ["React", "Embedded Systems"], p_max_members: 6 });
    const candidates = await alice.sb.rpc("get_team_candidates", { p_team_id: matchTeam.id }).then((r) => { if (r.error) throw r.error; return r.data; });
    check("A React-skilled, open-to-projects student appears as a candidate", candidates.some((c) => c.id === bob.userId && c.match_score >= 1), candidates.map((c) => ({ id: c.id, score: c.match_score })));
    check("A student who is NOT open to projects is excluded from candidates", !candidates.some((c) => c.id === carol.userId), candidates.map((c) => c.id));

    const { error: candidatesAuthErr } = await bob.sb.rpc("get_team_candidates", { p_team_id: matchTeam.id });
    check("A non-owner cannot view candidates for someone else's team", !!candidatesAuthErr, candidatesAuthErr?.message);

    const bobBrowse = await bob.sb.rpc("list_project_teams", { p_campus_id: campusId, p_status: "recruiting", p_search: marker }).then((r) => r.data);
    const matchRow = bobBrowse.find((t) => t.id === matchTeam.id);
    check("list_project_teams ranks a skill-overlapping team with match_score >= 1 for Bob", !!matchRow && matchRow.match_score >= 1, matchRow);

    // --- Delete cleans up ---
    const { error: nonOwnerDeleteErr } = await bob.sb.rpc("delete_project_team", { p_team_id: matchTeam.id });
    check("A non-owner cannot delete the team", !!nonOwnerDeleteErr, nonOwnerDeleteErr?.message);
  } finally {
    // Restore Bob's/Carol's real profile fields.
    await bob.sb.from("profiles").update({ skills: bobProfileBefore.skills, open_to_projects: bobProfileBefore.open_to_projects }).eq("id", bob.userId);
    await carol.sb.from("profiles").update({ skills: carolProfileBefore.skills, open_to_projects: carolProfileBefore.open_to_projects }).eq("id", carol.userId);

    // Clean up every team this run created (owner-only deletes, all owned by alice).
    for (const teamId of createdTeamIds) {
      try {
        await alice.sb.rpc("delete_project_team", { p_team_id: teamId });
      } catch {
        // best-effort cleanup
      }
    }
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
