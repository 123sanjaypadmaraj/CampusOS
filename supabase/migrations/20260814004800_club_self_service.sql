-- =============================================================================
-- 0042: CLUB SELF-SERVICE CMS -- gives a club's own leadership (not just
-- admins) a real dashboard: edit the club profile, manage the roster,
-- run the club's own events, see basic club analytics.
-- =============================================================================
-- This surfaces (and fixes) a real pre-existing bug: "clubs_write" (0011)
-- already let a club owner/president through its USING clause, but its
-- WITH CHECK clause never repeated that exists-check -- Postgres requires
-- BOTH to pass for an UPDATE, so no club owner/president could ever
-- actually save a change to their own club before this. It just happened
-- to go unnoticed because the only caller so far (AdminCMS) always runs
-- as an admin, which passed WITH CHECK on its own.

create or replace function public.is_club_leader(p_user uuid, p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club and user_id = p_user
      and role in ('owner','president','vice_president','secretary','coordinator')
  );
$$;

create or replace function public.is_club_admin_role(p_user uuid, p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club and user_id = p_user and role in ('owner','president')
  );
$$;

drop policy if exists "clubs_write" on public.clubs;
create policy "clubs_write" on public.clubs for all to authenticated
  using (public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin()
    or public.is_club_admin_role(auth.uid(), clubs.id))
  with check (public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin()
    or public.is_club_admin_role(auth.uid(), clubs.id));

-- Club leaders (any non-member role) may create/edit/cancel their own
-- club's events, not just the person who happened to organize each one.
-- Read: leaders/organizers/admins can also see their own club's
-- unpublished/draft events, not only public ones (previously not even
-- admins could -- events_read had no admin bypass at all).
drop policy if exists "events_read" on public.events;
create policy "events_read" on public.events for select to anon, authenticated
  using (
    published
    or organizer_id = auth.uid()
    or public.is_club_leader(auth.uid(), club_id)
    or public.has_permission(auth.uid(),'events.create')
    or public.current_user_is_admin()
  );

drop policy if exists "events_write" on public.events;
create policy "events_write" on public.events for all to authenticated
  using (public.has_permission(auth.uid(),'events.create') or public.current_user_is_admin()
    or organizer_id = auth.uid() or public.is_club_leader(auth.uid(), club_id))
  with check (public.has_permission(auth.uid(),'events.create') or public.current_user_is_admin()
    or organizer_id = auth.uid() or public.is_club_leader(auth.uid(), club_id));

-- =========================================================
-- RPC: get_club_dashboard -- one call for the whole leadership dashboard
-- (club profile, roster with names, every event regardless of published
-- state, a 30-day member-growth trend). SECURITY DEFINER so it can safely
-- join profiles for the roster the same way get_report_context/
-- get_profile_snippets already do elsewhere, rather than depending on
-- profiles RLS extending to "any fellow club member can see your name".
-- =========================================================

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
        'registration_status', e.registration_status, 'published', e.published
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

grant execute on function public.get_club_dashboard(uuid) to authenticated;

-- =========================================================
-- RPC: set_club_member_role / remove_club_member -- the audited entry
-- points for roster management. Kept as RPCs rather than an RLS-only
-- UPDATE/DELETE policy specifically to enforce "never leave a club with
-- zero owners" in one place, and to log to audit_logs like every other
-- privileged mutation in this codebase.
-- =========================================================

create or replace function public.set_club_member_role(p_member_id uuid, p_role text)
returns public.club_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_member public.club_members;
  v_owner_count integer;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_role not in ('owner','president','vice_president','secretary','coordinator','member') then
    raise exception 'Invalid club role %', p_role;
  end if;

  select * into v_member from public.club_members where id = p_member_id for update;
  if not found then raise exception 'Member not found'; end if;

  if not (public.is_club_admin_role(v_user, v_member.club_id)
          or public.has_permission(v_user, 'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage this club''s roster';
  end if;

  if v_member.role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.club_members where club_id = v_member.club_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'CLUB_LAST_OWNER: a club must always have at least one owner -- promote someone else first';
    end if;
  end if;

  update public.club_members set role = p_role where id = p_member_id returning * into v_member;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'club_member.role.change', 'club_member', p_member_id::text, jsonb_build_object('role', p_role));

  return v_member;
end;
$$;

grant execute on function public.set_club_member_role(uuid, text) to authenticated;

create or replace function public.remove_club_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_member public.club_members;
  v_owner_count integer;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_member from public.club_members where id = p_member_id for update;
  if not found then raise exception 'Member not found'; end if;

  if not (v_member.user_id = v_user
          or public.is_club_admin_role(v_user, v_member.club_id)
          or public.has_permission(v_user, 'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to remove this member';
  end if;

  if v_member.role = 'owner' then
    select count(*) into v_owner_count from public.club_members where club_id = v_member.club_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'CLUB_LAST_OWNER: a club must always have at least one owner -- promote someone else first';
    end if;
  end if;

  delete from public.club_members where id = p_member_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_user, 'club_member.remove', 'club_member', p_member_id::text);
end;
$$;

grant execute on function public.remove_club_member(uuid) to authenticated;

-- =========================================================
-- RPC: get_my_club_leadership -- powers the "Manage club" entry point on
-- the Clubs Hub / Profile page without needing a wider club_members read.
-- =========================================================

create or replace function public.get_my_club_leadership()
returns table (club_id uuid, club_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, m.role
  from public.club_members m
  join public.clubs c on c.id = m.club_id
  where m.user_id = auth.uid() and m.role <> 'member';
$$;

grant execute on function public.get_my_club_leadership() to authenticated;
