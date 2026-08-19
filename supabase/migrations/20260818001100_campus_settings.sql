-- =============================================================================
-- Configuration / campus settings (AdminCMS pass, part 4/5). `campuses` has
-- been admin-writable via RLS (`campuses_write`, 20260814001100) since the
-- very first migration, but nothing in this repo has ever actually written
-- to it outside of the dev seed insert -- there is no UI anywhere. Adds a
-- couple of concrete, real fields (support contact info, since every other
-- "contact support" surface in this app -- SOS, tickets, appeals -- has
-- nowhere campus-specific to point to) plus a generic `settings jsonb` for
-- anything not worth its own column yet, same "typed columns for what's
-- concrete, jsonb for what isn't yet" convention as `service_requests.
-- details`/`ai_feedback` elsewhere in this schema.
--
-- Write goes through an RPC rather than relying on `campuses_write` RLS
-- alone, for the same reason the AI-hardening pass gave for `ai_knowledge`:
-- "RPC gate, don't rely on role-only RLS alone for anything worth an audit
-- trail" -- campus-wide config changes are exactly that.
-- =============================================================================

alter table public.campuses add column if not exists support_email text;
alter table public.campuses add column if not exists support_phone text;
alter table public.campuses add column if not exists settings jsonb not null default '{}'::jsonb;

create or replace function public.admin_update_campus(
  p_campus_id uuid,
  p_name text default null,
  p_domain text default null,
  p_timezone text default null,
  p_active boolean default null,
  p_support_email text default null,
  p_support_phone text default null,
  p_settings jsonb default null
)
returns public.campuses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old public.campuses;
  v_new public.campuses;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to edit campus settings';
  end if;

  select * into v_old from public.campuses where id = p_campus_id for update;
  if not found then
    raise exception 'Campus not found';
  end if;

  update public.campuses set
    name = coalesce(nullif(trim(p_name), ''), name),
    domain = case when p_domain is not null then nullif(trim(p_domain), '') else domain end,
    timezone = coalesce(nullif(trim(p_timezone), ''), timezone),
    active = coalesce(p_active, active),
    support_email = case when p_support_email is not null then nullif(trim(p_support_email), '') else support_email end,
    support_phone = case when p_support_phone is not null then nullif(trim(p_support_phone), '') else support_phone end,
    settings = coalesce(p_settings, settings)
  where id = p_campus_id
  returning * into v_new;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_user, 'campus.settings.update', 'campus', p_campus_id::text,
          to_jsonb(v_old), to_jsonb(v_new));

  return v_new;
end;
$$;

grant execute on function public.admin_update_campus(uuid, text, text, text, boolean, text, text, jsonb) to authenticated;
