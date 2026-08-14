-- =============================================================================
-- 0030: MAKE ACCOUNT SUSPENSION ACTUALLY DO SOMETHING
-- =============================================================================
-- admin_set_user_status() (0029) can flip profiles.status to 'suspended',
-- and search_people()/get_people_you_may_know()/cohort groups already
-- filter on status='active' so a suspended student stops showing up in
-- directories -- but nothing stopped a suspended account from placing
-- orders, posting, registering for events, booking resources, printing,
-- listing on the marketplace, reporting lost & found items, joining clubs
-- or filing service tickets. "Suspend" was cosmetic beyond hide-from-search.
--
-- A single BEFORE INSERT trigger, not per-table RLS/RPC edits: several of
-- these writes go through SECURITY DEFINER RPCs (create_food_order,
-- register_for_event, create_booking, create_print_job) that bypass RLS
-- entirely by design, so an RLS-only fix would miss them. A trigger fires
-- regardless of whether the INSERT came from a plain RLS-governed client
-- insert or from inside a SECURITY DEFINER function, making this the one
-- place that actually covers every path.

create or replace function public.reject_if_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_status text;
begin
  v_user := case TG_TABLE_NAME
    when 'posts' then new.author_id
    when 'comments' then new.author_id
    when 'marketplace_listings' then new.seller_id
    else new.user_id
  end;

  if v_user is null then
    return new;
  end if;

  select status into v_status from public.profiles where id = v_user;

  if v_status = 'suspended' then
    raise exception 'ACCOUNT_SUSPENDED: your account has been suspended and cannot do this. Contact a campus admin.';
  end if;

  return new;
end;
$$;

do $$
declare
  t text;
  col text;
  tables_and_cols text[][] := array[
    array['orders','user_id'],
    array['bookings','user_id'],
    array['print_jobs','user_id'],
    array['event_registrations','user_id'],
    array['event_waitlist','user_id'],
    array['posts','author_id'],
    array['comments','author_id'],
    array['marketplace_listings','seller_id'],
    array['lost_found_items','user_id'],
    array['service_requests','user_id'],
    array['club_members','user_id']
  ];
  pair text[];
begin
  foreach pair slice 1 in array tables_and_cols loop
    t := pair[1];
    execute format('drop trigger if exists %I on public.%I', t || '_reject_if_suspended', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.reject_if_suspended()',
      t || '_reject_if_suspended', t
    );
  end loop;
end $$;
