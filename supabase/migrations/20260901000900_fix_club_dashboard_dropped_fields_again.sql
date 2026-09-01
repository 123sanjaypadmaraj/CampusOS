-- =============================================================================
-- get_club_dashboard(): restore the fields silently dropped by two
-- consecutive copy-paste redefinitions.
--
-- 20260831000200_club_dashboard_registration_export_fields.sql shipped the
-- complete function (11 top-level keys: club, my_role, members, events,
-- member_growth, applications, documents, gallery, announcements, meetings,
-- membership_history -- plus email/phone on members and applications) and
-- its own header warned this exact mistake had already happened once
-- (20260826000100's predecessor silently dropped 6 keys).
--
-- It happened again anyway, twice: 20260831000800_paid_events.sql based its
-- `create or replace function get_club_dashboard` on a stale pre-000200
-- copy (only adding `price` to the events subquery) despite its own comment
-- claiming "everything else in this jsonb_build_object is unchanged" --
-- silently reverting `applications`, `documents`, `gallery`,
-- `announcements`, `meetings`, `membership_history`, and `year`/`email`/
-- `phone` on `members`. 20260831001400_event_payouts.sql then built on
-- *that* already-broken copy (adding `payout_status`/`payout_net_amount`),
-- carrying the loss forward instead of restoring it.
--
-- Net effect, confirmed live on both staging (live-check-club-cms.mjs) and
-- production (this migration was applied to both before the gap was
-- caught): every club owner's dashboard has been silently missing its
-- Applications, Documents, Gallery, Announcements, Meetings, and Membership
-- History tabs' data since 20260831000800 first shipped -- no error, just
-- empty arrays, exactly the failure mode the 000200 header warned about.
--
-- Fix: rebuild the full function from 000200's complete version, folding in
-- every subsequent real addition (events.price from paid_events,
-- payout_status/payout_net_amount from event_payouts) rather than starting
-- from either broken intermediate copy. No fields removed, several
-- restored.
-- =============================================================================

create or replace function public.get_club_dashboard(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_my_role text;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select role into v_my_role from public.club_members where club_id = p_club_id and user_id = v_user;

  if coalesce(v_my_role, 'member') = 'member'
     and not (public.has_permission(v_user, 'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage this club';
  end if;

  select jsonb_build_object(
    'club', (select to_jsonb(c) from public.clubs_with_counts c where c.id = p_club_id),
    'my_role', coalesce(v_my_role, 'admin'),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'user_id', m.user_id, 'role', m.role, 'joined_at', m.joined_at,
        'name', p.name, 'usn', p.usn, 'course', p.course, 'year', p.year,
        'email', p.email, 'phone', p.phone, 'avatar_url', p.avatar_url
      ) order by m.joined_at), '[]'::jsonb)
      from public.club_members m join public.profiles p on p.id = m.user_id
      where m.club_id = p_club_id
    ),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'category', e.category, 'event_date', e.event_date,
        'place', e.place, 'capacity', e.capacity, 'attendees', e.attendees, 'price', e.price,
        'checked_in_count', e.checked_in_count, 'avg_rating', e.avg_rating, 'feedback_count', e.feedback_count,
        'registration_status', e.registration_status, 'published', e.published,
        'approval_status', e.approval_status, 'rejection_reason', e.rejection_reason,
        'certificates_enabled', e.certificates_enabled, 'cover_image_url', e.cover_image_url,
        'payout_status', ep.status, 'payout_net_amount', ep.net_amount
      ) order by e.event_date desc), '[]'::jsonb)
      from public.events_with_counts e
      left join public.event_payouts ep on ep.event_id = e.id
      where e.club_id = p_club_id
    ),
    'member_growth', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'new_members', cnt) order by d), '[]'::jsonb)
      from (
        select date_trunc('day', joined_at)::date as d, count(*) as cnt
        from public.club_members
        where club_id = p_club_id and joined_at >= now() - interval '30 days'
        group by 1
      ) t
    ),
    'applications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'message', a.message, 'status', a.status,
        'created_at', a.created_at, 'name', p.name, 'usn', p.usn, 'course', p.course, 'year', p.year,
        'email', p.email, 'phone', p.phone
      ) order by a.created_at desc), '[]'::jsonb)
      from public.club_applications a join public.profiles p on p.id = a.user_id
      where a.club_id = p_club_id and a.status = 'pending'
    ),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'title', d.title, 'description', d.description, 'file_path', d.file_path,
        'category', d.category, 'created_at', d.created_at, 'uploaded_by_name', p.name
      ) order by d.created_at desc), '[]'::jsonb)
      from public.club_documents d left join public.profiles p on p.id = d.uploaded_by
      where d.club_id = p_club_id
    ),
    'gallery', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'image_url', g.image_url, 'caption', g.caption, 'created_at', g.created_at
      ) order by g.created_at desc), '[]'::jsonb)
      from public.club_gallery g where g.club_id = p_club_id
    ),
    'announcements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'body', a.body, 'pinned', a.pinned, 'created_at', a.created_at,
        'author_name', p.name
      ) order by a.pinned desc, a.created_at desc), '[]'::jsonb)
      from public.club_announcements a left join public.profiles p on p.id = a.created_by
      where a.club_id = p_club_id
    ),
    'meetings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mt.id, 'title', mt.title, 'meeting_date', mt.meeting_date, 'notes', mt.notes,
        'present', (select count(*) from public.club_meeting_attendance ca where ca.meeting_id = mt.id and ca.status = 'present'),
        'absent', (select count(*) from public.club_meeting_attendance ca where ca.meeting_id = mt.id and ca.status = 'absent'),
        'excused', (select count(*) from public.club_meeting_attendance ca where ca.meeting_id = mt.id and ca.status = 'excused'),
        'marked', (select count(*) from public.club_meeting_attendance ca where ca.meeting_id = mt.id)
      ) order by mt.meeting_date desc), '[]'::jsonb)
      from public.club_meetings mt where mt.club_id = p_club_id
    ),
    'membership_history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id, 'user_id', h.user_id, 'event_type', h.event_type, 'role', h.role,
        'previous_role', h.previous_role, 'created_at', h.created_at, 'name', p.name
      ) order by h.created_at desc), '[]'::jsonb)
      from (select * from public.club_membership_history where club_id = p_club_id order by created_at desc limit 50) h
      left join public.profiles p on p.id = h.user_id
    )
  ) into v_result;

  if v_result is null or (v_result->'club') = 'null'::jsonb then
    raise exception 'Club not found';
  end if;

  return v_result;
end;
$$;
