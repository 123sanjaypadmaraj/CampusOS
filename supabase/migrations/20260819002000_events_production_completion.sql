-- =============================================================================
-- 0151: EVENTS -- production completion pass.
-- Registration/capacity/waitlist/QR-ticket generation/reminders/duplicate
-- check-in prevention were already shipped (0005, 0019, 0150). What was
-- still missing for a real event-management system:
--   * approval workflow between "draft" and "published" (any club officer
--     can currently self-publish straight to the whole campus)
--   * organizer access to their own event's roster/check-in (RLS only ever
--     granted that to the 'events.checkin' permission or an admin, not to
--     the club leaders who actually run the event -- get_club_dashboard
--     could already show them due to SECURITY DEFINER, but nothing let
--     them check students in or see who registered)
--   * event feedback
--   * event moderation (content_reports/moderate_content never grew an
--     'event' branch)
--   * a cover-image bucket (events.cover_image_url has existed since 0005
--     with nothing that ever wrote to it)
-- Paid events / refunds are explicitly out of scope -- events have no price
-- column and no payment integration today.
-- =============================================================================

-- =========================================================
-- 1. APPROVAL WORKFLOW
-- =========================================================

alter table public.events add column if not exists approval_status text not null default 'approved';
alter table public.events add column if not exists rejection_reason text;
alter table public.events add column if not exists certificates_enabled boolean not null default false;

do $$ begin
  alter table public.events drop constraint if exists events_approval_status_check;
  alter table public.events add constraint events_approval_status_check
    check (approval_status in ('pending','approved','rejected'));
exception when others then null; end $$;

-- Backfill: every event that already exists predates this column and was
-- effectively pre-approved (it's already live), so the default of
-- 'approved' above is correct for them without a separate update.

-- events created/edited by a plain club officer (organizer_id = auth.uid()
-- or a club leadership role, neither of which implies 'events.create')
-- start life 'pending' and need a campus admin/moderator to approve them
-- before events_read will surface them to students -- see the RLS change
-- below. Staff who hold 'events.create' (or are admins) are trusted to
-- self-approve, same as before this migration existed.
create or replace function public.events_approval_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privileged boolean;
begin
  v_privileged := public.has_permission(auth.uid(), 'events.create') or public.current_user_is_admin();

  if v_privileged then
    new.approval_status := 'approved';
    new.rejection_reason := null;
  elsif TG_OP = 'INSERT' then
    new.approval_status := 'pending';
    new.rejection_reason := null;
  else
    -- Non-privileged organizer editing their own event: once it's been
    -- reviewed, changing anything an attendee actually relies on sends it
    -- back for re-review instead of quietly keeping stale approval on
    -- materially different content (a bait-and-switch vector otherwise --
    -- get approved as a free workshop, then edit the time/place after).
    if old.approval_status in ('approved','rejected') and (
      new.title is distinct from old.title or
      new.event_date is distinct from old.event_date or
      new.description is distinct from old.description or
      new.capacity is distinct from old.capacity or
      new.place is distinct from old.place
    ) then
      new.approval_status := 'pending';
      new.rejection_reason := null;
    else
      new.approval_status := old.approval_status;
      new.rejection_reason := old.rejection_reason;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists events_approval_guard_trg on public.events;
create trigger events_approval_guard_trg before insert or update on public.events
  for each row execute function public.events_approval_guard();

-- A pending/rejected event must never become visible to students just
-- because 'published' happens to be true -- both gates now have to agree.
drop policy if exists "events_read" on public.events;
create policy "events_read" on public.events for select to anon, authenticated
  using (published and approval_status = 'approved');

-- The organizer, that event's club leadership, event-privileged staff and
-- moderators/admins still need to see their own event while it's pending/
-- rejected/unpublished -- multiple permissive policies on the same command
-- OR together, so this simply adds to events_read rather than replacing it.
drop policy if exists "events_admin_read" on public.events;
create policy "events_admin_read" on public.events for select to authenticated
  using (
    organizer_id = auth.uid()
    or public.is_club_leader(auth.uid(), club_id)
    or public.has_permission(auth.uid(), 'events.create')
    or public.has_permission(auth.uid(), 'moderation.act')
    or public.current_user_is_admin()
  );

create or replace function public.set_event_approval(p_event_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
begin
  if not (public.has_permission(v_user, 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to approve events';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found';
  end if;

  update public.events
    set approval_status = p_decision,
        rejection_reason = case when p_decision = 'rejected' then nullif(trim(p_reason), '') else null end
    where id = p_event_id;

  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (v_user, 'event', p_event_id, case when p_decision = 'approved' then 'approve' else 'reject' end, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'event.approval.' || p_decision, 'event', p_event_id::text, p_reason);

  if v_event.organizer_id is not null then
    perform public.create_notification(
      v_event.organizer_id,
      case when p_decision = 'approved' then 'Event approved: ' || v_event.title else 'Event needs changes: ' || v_event.title end,
      case when p_decision = 'approved' then 'Your event is now visible to students once published.'
        else coalesce(nullif(trim(p_reason), ''), 'A campus admin sent this event back for changes.') end,
      'event', 'event', p_event_id::text,
      'event_approval_' || p_event_id::text || '_' || p_decision
    );
  end if;
end;
$$;

grant execute on function public.set_event_approval(uuid, text, text) to authenticated;

-- =========================================================
-- 2. ORGANIZER ROSTER + CHECK-IN AUTHORIZATION
-- =========================================================

-- checkin_event_ticket() only ever trusted 'events.checkin' or an admin --
-- a club's own event_manager/president running their own event's door
-- couldn't check anyone in without a campus-wide RBAC grant. Widen it to
-- also trust that event's actual organizer/club leadership, same as
-- events_write already does for editing the event itself.
create or replace function public.checkin_event_ticket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.event_tickets;
  v_event public.events;
  v_reg public.event_registrations;
begin
  select * into v_ticket from public.event_tickets where token = p_token for update;
  if not found then
    raise exception 'TICKET_INVALID';
  end if;

  select * into v_event from public.events where id = v_ticket.event_id;

  if not (
    public.has_permission(v_user, 'events.checkin') or public.current_user_is_admin()
    or v_event.organizer_id = v_user or public.is_club_leader(v_user, v_event.club_id)
  ) then
    raise exception 'Not authorized to check in attendees';
  end if;

  if v_ticket.checked_in_at is not null then
    raise exception 'TICKET_ALREADY_USED';
  end if;

  select * into v_reg from public.event_registrations where id = v_ticket.registration_id;

  update public.event_tickets set checked_in_at = now(), checked_in_by = v_user where id = v_ticket.id;
  insert into public.event_attendance (event_id, user_id) values (v_ticket.event_id, v_reg.user_id)
    on conflict (event_id, user_id) do nothing;

  return jsonb_build_object('event_id', v_ticket.event_id, 'user_id', v_reg.user_id, 'name', v_reg.contact_name);
end;
$$;

-- One call for an organizer's roster tab: confirmed registrants + the
-- waitlist, each with contact details, ticket token and check-in status.
-- SECURITY DEFINER so it can return other people's registrations without
-- opening that up via RLS on event_registrations/event_waitlist generally.
create or replace function public.get_event_roster(p_event_id uuid)
returns table (
  registration_id uuid,
  user_id uuid,
  name text,
  usn text,
  email text,
  phone text,
  status text,
  waitlist_position integer,
  ticket_token text,
  checked_in_at timestamptz,
  registered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;

  if not (
    v_event.organizer_id = v_user or public.is_club_leader(v_user, v_event.club_id)
    or public.has_permission(v_user, 'events.checkin') or public.current_user_is_admin()
  ) then
    raise exception 'Not authorized to view this event roster';
  end if;

  return query
    select * from (
      select r.id as registration_id, r.user_id, r.contact_name as name, r.contact_usn as usn,
        r.contact_email as email, r.contact_phone as phone,
        'confirmed'::text as status, null::integer as waitlist_position,
        t.token as ticket_token, t.checked_in_at, r.registered_at
      from public.event_registrations r
      left join public.event_tickets t on t.registration_id = r.id
      where r.event_id = p_event_id and r.status = 'confirmed'
      union all
      select null::uuid as registration_id, w.user_id, w.contact_name as name, w.contact_usn as usn,
        w.contact_email as email, w.contact_phone as phone,
        'waitlisted'::text as status, w.position as waitlist_position,
        null::text as ticket_token, null::timestamptz as checked_in_at, w.created_at as registered_at
      from public.event_waitlist w
      where w.event_id = p_event_id
    ) roster
    order by status asc, waitlist_position asc nulls last, registered_at asc;
end;
$$;

grant execute on function public.get_event_roster(uuid) to authenticated;

-- =========================================================
-- 3. EVENT FEEDBACK
-- =========================================================

create table if not exists public.event_feedback (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique(event_id, user_id)
);

alter table public.event_feedback enable row level security;

create policy "event_feedback_read" on public.event_feedback for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.events e where e.id = event_feedback.event_id
        and (e.organizer_id = auth.uid() or public.is_club_leader(auth.uid(), e.club_id))
    )
    or public.current_user_is_admin()
  );
-- writes only via submit_event_feedback() -- no insert/update/delete policy,
-- same convention as event_registrations (comment there: "writes only via
-- register_for_event()/cancel_event_registration()").

create or replace function public.submit_event_feedback(p_event_id uuid, p_rating integer, p_comment text default null)
returns public.event_feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.event_feedback;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  if not exists (select 1 from public.event_attendance where event_id = p_event_id and user_id = v_user) then
    raise exception 'FEEDBACK_REQUIRES_ATTENDANCE: only checked-in attendees can leave feedback';
  end if;

  insert into public.event_feedback (event_id, user_id, rating, comment)
    values (p_event_id, v_user, p_rating, nullif(trim(p_comment), ''))
    on conflict (event_id, user_id) do update
      set rating = excluded.rating, comment = excluded.comment, created_at = now()
    returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_event_feedback(uuid, integer, text) to authenticated;

create index if not exists event_feedback_event_idx on public.event_feedback(event_id);

-- =========================================================
-- 4. events_with_counts -- add check-in + feedback aggregates. Appends
-- columns only (create or replace view can't reorder/drop existing ones),
-- so every existing .select() against it keeps working unchanged.
-- =========================================================

-- CREATE OR REPLACE VIEW can't be used here: this migration added new
-- columns to public.events earlier (approval_status etc.), so `e.*` now
-- expands to more columns than the live view has, which shifts where the
-- trailing `attendees` alias would land -- Postgres rejects that as
-- renaming an existing output column. Drop and recreate instead; nothing
-- else is defined as a view on top of events_with_counts (only functions/
-- queries select from it, which isn't a hard DROP dependency).
drop view if exists public.events_with_counts;
create view public.events_with_counts as
select e.*,
  (select count(*) from public.event_registrations r where r.event_id = e.id and r.status = 'confirmed') as attendees,
  (select count(*) from public.event_attendance a where a.event_id = e.id) as checked_in_count,
  (select round(avg(f.rating)::numeric, 2) from public.event_feedback f where f.event_id = e.id) as avg_rating,
  (select count(*) from public.event_feedback f where f.event_id = e.id) as feedback_count
from public.events e;

-- get_club_dashboard's events array predates approval/certificates/cover
-- image/check-in-count -- extend it so the club dashboard can show all of
-- that without a second round trip.
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
        'name', p.name, 'usn', p.usn, 'course', p.course, 'avatar_url', p.avatar_url
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
    )
  ) into v_result;

  if v_result is null or (v_result->'club') = 'null'::jsonb then
    raise exception 'Club not found';
  end if;

  return v_result;
end;
$$;

-- =========================================================
-- 5. MODERATION -- extend the existing generic content_reports/
-- moderate_content/get_report_context flow (0006/0034) with an 'event'
-- target type instead of building a parallel system.
-- =========================================================

do $$ begin
  alter table public.content_reports drop constraint if exists content_reports_target_type_check;
  alter table public.content_reports add constraint content_reports_target_type_check
    check (target_type in ('post','comment','marketplace_listing','lost_found_item','profile','conversation','event'));
exception when others then null; end $$;

create or replace function public.get_report_context(p_target_type text, p_target_id uuid, p_reporter_id uuid default null)
returns table (owner_id uuid, owner_name text, snippet text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  if p_target_type = 'post' then
    return query
      select p.author_id, pr.name, coalesce(p.title, left(p.content, 140))
      from public.posts p join public.profiles pr on pr.id = p.author_id
      where p.id = p_target_id;
  elsif p_target_type = 'comment' then
    return query
      select c.author_id, pr.name, left(c.content, 140)
      from public.comments c join public.profiles pr on pr.id = c.author_id
      where c.id = p_target_id;
  elsif p_target_type = 'marketplace_listing' then
    return query
      select m.seller_id, pr.name, m.title
      from public.marketplace_listings m join public.profiles pr on pr.id = m.seller_id
      where m.id = p_target_id;
  elsif p_target_type = 'lost_found_item' then
    return query
      select l.user_id, pr.name, l.title
      from public.lost_found_items l join public.profiles pr on pr.id = l.user_id
      where l.id = p_target_id;
  elsif p_target_type = 'profile' then
    return query
      select pr.id, pr.name, pr.bio
      from public.profiles pr
      where pr.id = p_target_id;
  elsif p_target_type = 'conversation' then
    return query
      select pr.id, pr.name, coalesce(lm.body, case when lm.attachment_path is not null then '📷 Photo' else '(no messages yet)' end)
      from public.conversation_participants cp
      join public.profiles pr on pr.id = cp.user_id
      left join lateral (
        select body, attachment_path from public.messages m
        where m.conversation_id = p_target_id order by m.created_at desc limit 1
      ) lm on true
      where cp.conversation_id = p_target_id and cp.user_id = coalesce(p_reporter_id, cp.user_id)
      limit 1;
  elsif p_target_type = 'event' then
    return query
      select e.organizer_id, pr.name, e.title
      from public.events e left join public.profiles pr on pr.id = e.organizer_id
      where e.id = p_target_id;
  end if;
end;
$$;

create or replace function public.moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new_status text;
begin
  if not (public.has_permission(v_user, 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to moderate content';
  end if;

  v_new_status := case p_action when 'approve' then 'visible' when 'hide' then 'hidden' when 'remove' then 'removed' else null end;

  if v_new_status is not null then
    if p_target_type = 'post' then
      update public.posts set status = v_new_status where id = p_target_id;
    elsif p_target_type = 'comment' then
      update public.comments set status = v_new_status where id = p_target_id;
    elsif p_target_type = 'marketplace_listing' then
      if p_action in ('hide', 'remove') then
        update public.marketplace_listings set status = 'removed' where id = p_target_id;
      elsif p_action = 'approve' then
        update public.marketplace_listings set status = 'active' where id = p_target_id and status = 'removed';
      end if;
    elsif p_target_type = 'lost_found_item' then
      if p_action in ('hide', 'remove') then
        update public.lost_found_items set status = 'archived' where id = p_target_id and status = 'open';
      elsif p_action = 'approve' then
        update public.lost_found_items set status = 'open', expires_at = now() + interval '21 days'
          where id = p_target_id and status = 'archived';
      end if;
    elsif p_target_type = 'event' then
      -- 'hide' pulls it off the public feed without touching registrations
      -- (organizer can fix and republish). 'remove' additionally cancels
      -- registration so nobody shows up to something that's being pulled
      -- for cause. 'approve' un-hides -- it does NOT grant approval_status
      -- (that's set_event_approval's job, a separate gate).
      if p_action in ('hide', 'remove') then
        update public.events set published = false where id = p_target_id;
        if p_action = 'remove' then
          update public.events set registration_status = 'CANCELLED' where id = p_target_id;
        end if;
      elsif p_action = 'approve' then
        update public.events set published = true where id = p_target_id;
      end if;
    end if;
  end if;

  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (v_user, p_target_type, p_target_id, p_action, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'moderation.' || p_action, p_target_type, p_target_id::text, p_reason);
end;
$$;

-- =========================================================
-- 6. COVER IMAGE STORAGE -- same convention as club-gallery/club-files
-- (20260815001100): public bucket, path `${event_id}/${filename}`, write
-- gated on being that event's organizer/club leadership or event-privileged
-- staff/admin.
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-covers', 'event-covers', true, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "event_covers_storage_read" on storage.objects;
create policy "event_covers_storage_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'event-covers');

drop policy if exists "event_covers_storage_write" on storage.objects;
create policy "event_covers_storage_write" on storage.objects for all to authenticated
  using (bucket_id = 'event-covers' and (
    exists (
      select 1 from public.events e where e.id::text = (storage.foldername(name))[1]
        and (e.organizer_id = auth.uid() or public.is_club_leader(auth.uid(), e.club_id))
    )
    or public.has_permission(auth.uid(), 'events.create') or public.current_user_is_admin()
  ))
  with check (bucket_id = 'event-covers' and (
    exists (
      select 1 from public.events e where e.id::text = (storage.foldername(name))[1]
        and (e.organizer_id = auth.uid() or public.is_club_leader(auth.uid(), e.club_id))
    )
    or public.has_permission(auth.uid(), 'events.create') or public.current_user_is_admin()
  ));
