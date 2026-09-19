// Data layer for the club self-service leadership dashboard. Distinct from
// src/features/admin/api.js's club functions (those are admin-only, gated
// by current_user_is_admin()/'clubs.manage'): everything here is usable by
// any club's own owner/president/vice_president/secretary/coordinator/
// treasurer/event_manager, per the RLS + RPCs added in
// supabase/migrations/20260814004800_club_self_service.sql and
// supabase/migrations/20260815001100_club_cms_complete.sql (applications/
// recruitment, documents, gallery, announcements, meeting attendance,
// membership history).

import { supabase } from "../../lib/supabase";

function throwIfError(error) {
  if (error) throw error;
}

function safeFileName(name) {
  return (name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Powers the "Manage club" entry point on the Clubs Hub -- which clubs (if
// any) does the signed-in user lead, and in what role.
export async function getMyClubLeadership() {
  const { data, error } = await supabase.rpc("get_my_club_leadership");
  throwIfError(error);
  return data || [];
}

// One call for the whole dashboard: club profile, full roster (with
// names), every event regardless of published state, and a 30-day
// member-growth trend. See get_club_dashboard() for why this is one RPC
// rather than several client-side joins.
export async function getClubDashboard(clubId) {
  const { data, error } = await supabase.rpc("get_club_dashboard", { p_club_id: clubId });
  throwIfError(error);
  return data;
}

export async function updateClubProfile(clubId, { name, category, description, logoUrl }) {
  const { data, error } = await supabase
    .from("clubs")
    .update({
      name: name?.trim(),
      category: category?.trim() || "",
      description: description?.trim() || "",
      logo_url: logoUrl?.trim() || null,
    })
    .eq("id", clubId)
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function upsertClubEvent(clubId, event, organizerId) {
  const payload = {
    campus_id: event.campus_id,
    club_id: clubId,
    title: event.title,
    category: event.category || "Club Event",
    description: event.description || "",
    event_date: event.event_date,
    place: event.place || "",
    capacity: event.capacity ? Number(event.capacity) : null,
    price: event.price !== "" && event.price != null ? Number(event.price) : null,
    published: event.published !== false,
  };
  if (!event.id) payload.organizer_id = organizerId;

  const query = event.id
    ? supabase.from("events").update(payload).eq("id", event.id)
    : supabase.from("events").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return data;
}

export async function setClubEventPublished(eventId, published) {
  const { error } = await supabase.from("events").update({ published }).eq("id", eventId);
  throwIfError(error);
}

export async function cancelClubEvent(eventId) {
  const { error } = await supabase.from("events").update({ registration_status: "CANCELLED", published: false }).eq("id", eventId);
  throwIfError(error);
}

// Once an organizer turns this on, checked-in attendees can download a
// certificate from their own Activity tab (client-generated, see
// EventCertificateButton in App.jsx -- nothing is rendered/stored server-side).
export async function setEventCertificatesEnabled(eventId, enabled) {
  const { error } = await supabase.from("events").update({ certificates_enabled: enabled }).eq("id", eventId);
  throwIfError(error);
}

export async function setClubMemberRole(memberId, role) {
  const { data, error } = await supabase.rpc("set_club_member_role", { p_member_id: memberId, p_role: role });
  throwIfError(error);
  return data;
}

export async function removeClubMember(memberId) {
  const { error } = await supabase.rpc("remove_club_member", { p_member_id: memberId });
  throwIfError(error);
}

/* =========================================================================
   RECRUITMENT + APPLICATIONS
========================================================================= */

// Owner/president-only (enforced by the same clubs_write RLS updateClubProfile
// already relies on) -- toggles how the "Join" button on the Clubs Hub behaves.
export async function updateClubRecruitment(clubId, { recruitmentMode, recruitmentMessage }) {
  const { data, error } = await supabase
    .from("clubs")
    .update({ recruitment_mode: recruitmentMode, recruitment_message: recruitmentMessage?.trim() || null })
    .eq("id", clubId)
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function applyToClub(clubId, message) {
  const { data, error } = await supabase.rpc("apply_to_club", { p_club_id: clubId, p_message: message || null });
  throwIfError(error);
  return data;
}

export async function cancelClubApplication(applicationId) {
  const { error } = await supabase.rpc("cancel_club_application", { p_application_id: applicationId });
  throwIfError(error);
}

export async function reviewClubApplication(applicationId, decision, note) {
  const { data, error } = await supabase.rpc("review_club_application", {
    p_application_id: applicationId, p_decision: decision, p_note: note || null,
  });
  throwIfError(error);
  return data;
}

// Powers the "Applied — pending" state on the Clubs Hub card for the
// signed-in student, across every club at once.
export async function getMyClubApplications(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("club_applications")
    .select("id, club_id, status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

/* =========================================================================
   DOCUMENTS -- private 'club-files' bucket, path `${clubId}/${filename}`.
========================================================================= */

export async function uploadClubDocument(clubId, { title, description, category }, file, uploadedBy) {
  if (!file) throw new Error("Choose a file to upload.");
  const path = `${clubId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from("club-files")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" });
  throwIfError(uploadError);

  const { data, error } = await supabase
    .from("club_documents")
    .insert({
      club_id: clubId, title: title?.trim() || file.name, description: description?.trim() || "",
      category: category?.trim() || "", file_path: path, uploaded_by: uploadedBy,
    })
    .select()
    .single();
  throwIfError(error);
  return data;
}

// Signed link, briefly valid -- 'club-files' is a private bucket, so there's
// no permanent public URL to store or embed.
export async function getClubDocumentUrl(path) {
  const { data, error } = await supabase.storage.from("club-files").createSignedUrl(path, 300);
  throwIfError(error);
  return data?.signedUrl;
}

export async function deleteClubDocument(document) {
  const { error: dbError } = await supabase.from("club_documents").delete().eq("id", document.id);
  throwIfError(dbError);
  if (document.file_path) {
    await supabase.storage.from("club-files").remove([document.file_path]);
  }
}

/* =========================================================================
   GALLERY -- public 'club-gallery' bucket, path `${clubId}/${filename}`.
========================================================================= */

export async function uploadClubGalleryImage(clubId, caption, file, uploadedBy) {
  if (!file) throw new Error("Choose a photo to upload.");
  const path = `${clubId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from("club-gallery")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg" });
  throwIfError(uploadError);

  const { data: pub } = supabase.storage.from("club-gallery").getPublicUrl(path);

  const { data, error } = await supabase
    .from("club_gallery")
    .insert({ club_id: clubId, image_url: pub?.publicUrl, caption: caption?.trim() || "", uploaded_by: uploadedBy })
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function deleteClubGalleryItem(item) {
  const { error } = await supabase.from("club_gallery").delete().eq("id", item.id);
  throwIfError(error);
}

/* =========================================================================
   ANNOUNCEMENTS -- club-scoped, distinct from admin's campus-wide feed.
========================================================================= */

// audience: 'members' (default -- only this club's roster is notified) or
// 'all_students' (every student on the club's campus is notified too). The
// channel thread delivered into Messages stays members-only either way --
// see the migration's header comment for why.
export async function publishClubAnnouncement(clubId, { title, body, pinned, audience }) {
  const { data, error } = await supabase.rpc("publish_club_announcement", {
    p_club_id: clubId, p_title: title, p_body: body || null, p_pinned: pinned || false,
    p_audience: audience || "members",
  });
  throwIfError(error);
  return data;
}

export async function setClubAnnouncementPinned(announcementId, pinned) {
  const { error } = await supabase.from("club_announcements").update({ pinned }).eq("id", announcementId);
  throwIfError(error);
}

export async function deleteClubAnnouncement(announcementId) {
  const { error } = await supabase.from("club_announcements").delete().eq("id", announcementId);
  throwIfError(error);
}

/* =========================================================================
   MEETINGS & ATTENDANCE -- distinct from event check-in; these are
   internal club meetings, not published campus events.
========================================================================= */

export async function upsertClubMeeting(clubId, meeting, createdBy) {
  const payload = {
    club_id: clubId, title: meeting.title, meeting_date: meeting.meeting_date, notes: meeting.notes || "",
  };
  if (!meeting.id) payload.created_by = createdBy;
  const query = meeting.id
    ? supabase.from("club_meetings").update(payload).eq("id", meeting.id)
    : supabase.from("club_meetings").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return data;
}

export async function deleteClubMeeting(meetingId) {
  const { error } = await supabase.from("club_meetings").delete().eq("id", meetingId);
  throwIfError(error);
}

// entries: [{ user_id, status }]
export async function markMeetingAttendance(meetingId, entries) {
  const { data, error } = await supabase.rpc("mark_meeting_attendance", { p_meeting_id: meetingId, p_entries: entries });
  throwIfError(error);
  return data || [];
}

export async function getMeetingAttendance(meetingId) {
  const { data, error } = await supabase.from("club_meeting_attendance").select("*").eq("meeting_id", meetingId);
  throwIfError(error);
  return data || [];
}

/* =========================================================================
   PAYOUTS -- self-service reconciliation for a paid event. Payout GENERATION
   is admin-only (generate_event_payout/mark_event_payout_paid, see
   supabase/migrations/20260831001400_event_payouts.sql) -- this is read-only
   for the club, same posture as vendor payouts (src/features/vendor/api.js).
========================================================================= */

// Itemized (one row per paid registration + one per completed refund) for a
// single event -- lets a club officer check their own numbers at any time,
// not just after an admin generates a payout.
export async function getEventSettlementReport(eventId) {
  const { data, error } = await supabase.rpc("event_settlement_report", { p_event_id: eventId });
  throwIfError(error);
  return data || [];
}

export async function getClubEventPayouts(clubId) {
  const { data, error } = await supabase
    .from("event_payouts")
    .select("*, events(title, event_date)")
    .eq("club_id", clubId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

/* =========================================================================
   EVENT MANAGER -- participants (in-app registrants + Google Forms / CSV
   imports), teams and attendance for one event. Backed by
   supabase/migrations/20260919000100_event_participants_teams.sql: the tables
   have RLS on with no policies, so every read and write here is an RPC that
   re-checks the caller is that event's organizer / club leadership / staff.
========================================================================= */

const PAGE_SIZE = 1000; // PostgREST's default max rows per response
const IMPORT_CHUNK = 500; // the RPC accepts at most 2000; stay well under

// Turns the RPCs' "CODE: message" exceptions into just the message.
export function describeEventManagerError(err) {
  const msg = (err && err.message) || "";
  const m = msg.match(/^(?:PARTICIPANT_INVALID|DUPLICATE_PARTICIPANT|TEAM_INVALID|TEAM_DUPLICATE|IMPORT_INVALID|IMPORT_TOO_LARGE):\s*(.+)$/);
  return m ? m[1] : msg || "Something went wrong";
}

// Mirrors confirmed in-app registrations into the participants list and
// pulls ticket check-ins across. Safe to call repeatedly.
export async function syncEventParticipants(eventId) {
  const { data, error } = await supabase.rpc("sync_event_participants", { p_event_id: eventId });
  throwIfError(error);
  return data; // { added, linked }
}

export async function listEventParticipants(eventId) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc("get_event_participants", { p_event_id: eventId })
      .range(from, from + PAGE_SIZE - 1);
    throwIfError(error);
    const page = data || [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

export async function listEventTeams(eventId) {
  const { data, error } = await supabase.rpc("get_event_teams", { p_event_id: eventId });
  throwIfError(error);
  return data || [];
}

// rows: output of buildImportRows(). Re-importing an updated sheet merges into
// existing participants (matched on email, then USN) rather than duplicating.
export async function importEventParticipants(eventId, rows) {
  const total = { inserted: 0, updated: 0, skipped: 0, teams_created: 0 };
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
    const { data, error } = await supabase.rpc("import_event_participants", {
      p_event_id: eventId,
      p_rows: rows.slice(i, i + IMPORT_CHUNK),
    });
    throwIfError(error);
    for (const k of Object.keys(total)) total[k] += Number(data?.[k] || 0);
  }
  return total;
}

// participantId null => add. `fields` may hold name/usn/email/phone/
// department/year/notes/team_id; on edit only the keys present change.
export async function saveEventParticipant(eventId, participantId, fields) {
  const { data, error } = await supabase.rpc("upsert_event_participant", {
    p_event_id: eventId,
    p_participant_id: participantId || null,
    p_fields: fields,
  });
  throwIfError(error);
  return data;
}

export async function deleteEventParticipants(eventId, ids) {
  const { data, error } = await supabase.rpc("delete_event_participants", { p_event_id: eventId, p_ids: ids });
  throwIfError(error);
  return Number(data || 0);
}

export async function setParticipantsAttendance(eventId, ids, attended) {
  const { data, error } = await supabase.rpc("set_participants_attendance", {
    p_event_id: eventId,
    p_ids: ids,
    p_attended: !!attended,
  });
  throwIfError(error);
  return Number(data || 0);
}

export async function createEventTeams(eventId, names) {
  const { data, error } = await supabase.rpc("create_event_teams", { p_event_id: eventId, p_names: names });
  throwIfError(error);
  return data || [];
}

export async function updateEventTeam(teamId, name, notes) {
  const { data, error } = await supabase.rpc("update_event_team", { p_team_id: teamId, p_name: name, p_notes: notes || null });
  throwIfError(error);
  return data;
}

export async function deleteEventTeam(teamId) {
  const { error } = await supabase.rpc("delete_event_team", { p_team_id: teamId });
  throwIfError(error);
}

// assignments: [{ participant_id, team_id }] -- team_id null un-assigns.
export async function assignParticipantsToTeams(eventId, assignments) {
  let changed = 0;
  for (let i = 0; i < assignments.length; i += 2000) {
    const { data, error } = await supabase.rpc("assign_participants_to_teams", {
      p_event_id: eventId,
      p_assignments: assignments.slice(i, i + 2000),
    });
    throwIfError(error);
    changed += Number(data || 0);
  }
  return changed;
}
