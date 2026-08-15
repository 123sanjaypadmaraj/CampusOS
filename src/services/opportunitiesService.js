import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Opportunities board -- real data (doc §109)
|--------------------------------------------------------------------------
| Backed by supabase/migrations/20260815000200_opportunities_board.sql.
| Was entirely fake before: hardcoded `opportunities`/`mentors` arrays in
| src/App.jsx, "View"/"Mentor request" both just fired a notify() toast.
| Opportunities/mentors are admin-curated (current_user_is_admin() gates
| writes); students apply/request through the RPCs below.
*/

function throwIfError(error) {
  if (error) throw error;
}

/* ===================== STUDENT-FACING ===================== */

export async function getOpportunities(campusId) {
  let query = supabase.from("opportunities").select("*").eq("active", true);
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query.order("deadline", { ascending: true, nullsFirst: false });
  throwIfError(error);
  return data || [];
}

export async function getMentors(campusId) {
  let query = supabase.from("mentors").select("*").eq("active", true);
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query.order("name");
  throwIfError(error);
  return data || [];
}

export async function applyToOpportunity(opportunityId, message) {
  const { data, error } = await supabase.rpc("apply_to_opportunity", {
    p_opportunity_id: opportunityId,
    p_message: message || null,
  });
  throwIfError(error);
  return data;
}

export async function getMyApplications(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("opportunity_applications")
    .select("opportunity_id, status, created_at")
    .eq("user_id", userId);
  throwIfError(error);
  return data || [];
}

export async function requestMentor(mentorId, message) {
  const { data, error } = await supabase.rpc("request_mentor", {
    p_mentor_id: mentorId,
    p_message: message || null,
  });
  throwIfError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}

/* ===================== ADMIN ===================== */

export async function listOpportunitiesAdmin(campusId) {
  let query = supabase.from("opportunities").select("*, opportunity_applications(id)").order("created_at", { ascending: false });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function createOpportunity({ campusId, company, role, type, description, tags, deadline, applyUrl }) {
  const { data: authData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      campus_id: campusId,
      posted_by: authData?.user?.id || null,
      company,
      role,
      type,
      description: description || "",
      tags: tags || [],
      deadline: deadline || null,
      apply_url: applyUrl || null,
    })
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function updateOpportunity(id, patch) {
  const { data, error } = await supabase.from("opportunities").update(patch).eq("id", id).select().single();
  throwIfError(error);
  return data;
}

export async function deleteOpportunity(id) {
  const { error } = await supabase.from("opportunities").delete().eq("id", id);
  throwIfError(error);
}

export async function listOpportunityApplicants(opportunityId) {
  const { data, error } = await supabase
    .from("opportunity_applications")
    .select("*, profiles(name, course, year, email)")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

export async function setApplicationStatus(id, status) {
  const { error } = await supabase.from("opportunity_applications").update({ status }).eq("id", id);
  throwIfError(error);
}

export async function listMentorsAdmin(campusId) {
  let query = supabase.from("mentors").select("*").order("created_at", { ascending: false });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function createMentor({ campusId, name, role, skills, bio, contactEmail, profileId }) {
  const { data: authData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("mentors")
    .insert({
      campus_id: campusId,
      added_by: authData?.user?.id || null,
      name,
      role,
      skills: skills || [],
      bio: bio || null,
      contact_email: contactEmail || null,
      profile_id: profileId || null,
    })
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function updateMentor(id, patch) {
  const { data, error } = await supabase.from("mentors").update(patch).eq("id", id).select().single();
  throwIfError(error);
  return data;
}

export async function deleteMentor(id) {
  const { error } = await supabase.from("mentors").delete().eq("id", id);
  throwIfError(error);
}

export async function listMentorRequestsAdmin() {
  const { data, error } = await supabase
    .from("mentor_requests")
    .select("*, profiles(name, course), mentors(name)")
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}
