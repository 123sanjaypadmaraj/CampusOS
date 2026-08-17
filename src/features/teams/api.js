// Data layer for Project / Team Matching (doc §22): team creation, project
// posts (a team IS its own recruitment post -- see the migration header),
// find-teammates/skill matching, invitations, applications, team
// management. See supabase/migrations/20260817000100_team_matching.sql.

import { supabase } from "../../lib/supabase";

function throwIfError(error) {
  if (error) throw error;
}

export async function listProjectTeams(campusId, { status = "recruiting", category = null, search = null, limit = 30, cursor = null } = {}) {
  const { data, error } = await supabase.rpc("list_project_teams", {
    p_campus_id: campusId,
    p_status: status,
    p_category: category,
    p_search: search,
    p_limit: limit,
    p_cursor: cursor,
  });
  throwIfError(error);
  return data || [];
}

export async function getMyTeams() {
  const { data, error } = await supabase.rpc("get_my_teams");
  throwIfError(error);
  return data || [];
}

export async function getMyTeamInvitations() {
  const { data, error } = await supabase.rpc("get_my_team_invitations");
  throwIfError(error);
  return data || [];
}

export async function getProjectTeam(teamId) {
  const { data, error } = await supabase.rpc("get_project_team", { p_team_id: teamId });
  throwIfError(error);
  return data;
}

export async function getTeamCandidates(teamId, limit = 20) {
  const { data, error } = await supabase.rpc("get_team_candidates", { p_team_id: teamId, p_limit: limit });
  throwIfError(error);
  return data || [];
}

export async function createProjectTeam(team) {
  const { data, error } = await supabase.rpc("create_project_team", {
    p_title: team.title,
    p_description: team.description || "",
    p_category: team.category || "Project",
    p_context: team.context || null,
    p_skills_have: team.skillsHave || [],
    p_skills_needed: team.skillsNeeded || [],
    p_max_members: team.maxMembers || 4,
    p_deadline: team.deadline || null,
    p_external_link: team.externalLink || null,
  });
  throwIfError(error);
  return data;
}

export async function updateProjectTeam(teamId, updates) {
  const payload = {};
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.context !== undefined) payload.context = updates.context;
  if (updates.skillsHave !== undefined) payload.skills_have = updates.skillsHave;
  if (updates.skillsNeeded !== undefined) payload.skills_needed = updates.skillsNeeded;
  if (updates.maxMembers !== undefined) payload.max_members = updates.maxMembers;
  if (updates.deadline !== undefined) payload.deadline = updates.deadline;
  if (updates.externalLink !== undefined) payload.external_link = updates.externalLink;
  if (updates.status !== undefined) payload.status = updates.status;

  const { data, error } = await supabase.from("project_teams").update(payload).eq("id", teamId).select().single();
  throwIfError(error);
  return data;
}

export async function deleteProjectTeam(teamId) {
  const { error } = await supabase.rpc("delete_project_team", { p_team_id: teamId });
  throwIfError(error);
}

/* ===================== ADMIN ===================== */

// Every team for the campus, any status -- not list_project_teams()'s
// browse/find-teammates board (that ranks by the *caller's own* skill
// overlap and requires a status filter). Same shape as
// opportunitiesService.listOpportunitiesAdmin(): a plain table select
// (project_teams_read's RLS is `using (true)` for authenticated, so this
// works for any signed-in admin) with the roster/applicant counts embedded
// for a moderation list. Deletion re-uses deleteProjectTeam() above --
// delete_project_team() itself is the real authorization boundary
// (owner or moderation.act/admin), this call is just a browse surface.
export async function listProjectTeamsAdmin(campusId) {
  let query = supabase
    .from("project_teams")
    .select("*, profiles(name), project_team_members(id), project_team_applications(id)")
    .order("created_at", { ascending: false });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function applyToTeam(teamId, message) {
  const { data, error } = await supabase.rpc("apply_to_team", { p_team_id: teamId, p_message: message || null });
  throwIfError(error);
  return data;
}

export async function withdrawTeamApplication(applicationId) {
  const { data, error } = await supabase.rpc("withdraw_team_application", { p_application_id: applicationId });
  throwIfError(error);
  return data;
}

export async function reviewTeamApplication(applicationId, decision) {
  const { data, error } = await supabase.rpc("review_team_application", { p_application_id: applicationId, p_decision: decision });
  throwIfError(error);
  return data;
}

export async function inviteToTeam(teamId, inviteeId, message) {
  const { data, error } = await supabase.rpc("invite_to_team", { p_team_id: teamId, p_invitee_id: inviteeId, p_message: message || null });
  throwIfError(error);
  return data;
}

export async function cancelTeamInvitation(invitationId) {
  const { data, error } = await supabase.rpc("cancel_team_invitation", { p_invitation_id: invitationId });
  throwIfError(error);
  return data;
}

export async function respondToTeamInvitation(invitationId, decision) {
  const { data, error } = await supabase.rpc("respond_to_team_invitation", { p_invitation_id: invitationId, p_decision: decision });
  throwIfError(error);
  return data;
}

export async function removeTeamMember(teamId, userId) {
  const { error } = await supabase.rpc("remove_team_member", { p_team_id: teamId, p_user_id: userId });
  throwIfError(error);
}

export async function leaveTeam(teamId) {
  const { error } = await supabase.rpc("leave_team", { p_team_id: teamId });
  throwIfError(error);
}
