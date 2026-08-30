-- =============================================================================
-- get_club_dashboard(): add email + phone to the 'members' and
-- 'applications' payloads.
--
-- Why: a club owner exporting their roster (new Export CSV/Excel buttons on
-- the Members and Applications tabs, src/features/clubs/ClubManage.jsx)
-- needs the contact details a student actually gave at registration/sign-up
-- (profiles.email is populated by handle_new_user() for every account,
-- profiles.phone by the student themselves) -- without it the export is
-- just names and USNs, which isn't enough to actually reach a new member.
--
-- This is a straight superset of the function 20260826000100 last defined
-- (that migration's own header explains why it exists: an earlier copy-paste
-- silently dropped 6 keys). Copied verbatim here except for the two added
-- fields, so as not to repeat that mistake.
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
        'place', e.place, 'capacity', e.capacity, 'attendees', e.attendees,
        'checked_in_count', e.checked_in_count, 'avg_rating', e.avg_rating, 'feedback_count', e.feedback_count,
        'registration_status', e.registration_status, 'published', e.published,
        'approval_status', e.approval_status, 'rejection_reason', e.rejection_reason,
        'certificates_enabled', e.certificates_enabled, 'cover_image_url', e.cover_image_url
      ) order by e.event_date desc), '[]'::jsonb)
      from public.events_with_counts e where e.club_id = p_club_id
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
