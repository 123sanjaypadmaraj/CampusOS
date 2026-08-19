-- =============================================================================
-- SUPPORT FAQ / HELP CENTRE (module 42 continued). Gives students somewhere
-- to self-serve an answer before filing a ticket -- nothing like this exists
-- anywhere in the schema yet (confirmed by repo-wide grep before writing
-- this). Deliberately simple: a flat list of Q&A rows grouped by category,
-- no versioning/voting. Writes are gated by the same support.manage
-- permission as ticket triage rather than a new permission -- it's the same
-- college_admin/super_admin pool maintaining both, and the base support
-- migration's own header already decided against growing the permission
-- surface for this feature area.
-- =============================================================================

create table if not exists public.support_faqs (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  category text not null default 'general'
    check (category in ('account', 'payment', 'technical', 'general', 'other')),
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- campus_id null = shown to every campus (a platform-wide FAQ entry), same
-- "null campus_id means global" convention as support_tickets.campus_id and
-- resources/campus_settings elsewhere in this schema.
create index if not exists support_faqs_campus_idx on public.support_faqs(campus_id, category, sort_order);

drop trigger if exists support_faqs_set_updated_at on public.support_faqs;
create trigger support_faqs_set_updated_at
before update on public.support_faqs
for each row execute function public.set_updated_at();

alter table public.support_faqs enable row level security;

-- Read: anyone, even signed-out (self-serve help should not require login),
-- but only active rows and only entries that are global or match their own
-- campus. anon gets the same policy so the help centre works pre-login.
drop policy if exists "support_faqs_read" on public.support_faqs;
create policy "support_faqs_read" on public.support_faqs for select to anon, authenticated
  using (
    is_active
    and (
      campus_id is null
      or campus_id = (select p.campus_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists "support_faqs_admin_read" on public.support_faqs;
create policy "support_faqs_admin_read" on public.support_faqs for select to authenticated
  using (public.has_permission(auth.uid(), 'support.manage') or public.current_user_is_admin());

-- =========================================================
-- RPC: admin_upsert_support_faq -- same upsert-by-nullable-id shape as
-- admin_upsert_resource (20260819000400_resource_management.sql).
-- =========================================================

create or replace function public.admin_upsert_support_faq(
  p_id uuid,
  p_campus_id uuid,
  p_category text,
  p_question text,
  p_answer text,
  p_sort_order integer,
  p_is_active boolean
)
returns public.support_faqs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.support_faqs;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if not (public.has_permission(v_user, 'support.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the help centre';
  end if;
  if p_question is null or trim(p_question) = '' then
    raise exception 'A question is required';
  end if;
  if p_answer is null or trim(p_answer) = '' then
    raise exception 'An answer is required';
  end if;
  if p_category not in ('account', 'payment', 'technical', 'general', 'other') then
    raise exception 'Invalid category';
  end if;

  if p_id is not null then
    update public.support_faqs set
      campus_id = p_campus_id,
      category = p_category,
      question = trim(p_question),
      answer = trim(p_answer),
      sort_order = coalesce(p_sort_order, sort_order),
      is_active = coalesce(p_is_active, is_active)
    where id = p_id
    returning * into v_row;

    if not found then
      raise exception 'FAQ entry not found';
    end if;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
    values (v_user, 'support_faq.update', 'support_faq', p_id::text, to_jsonb(v_row));
  else
    insert into public.support_faqs (campus_id, category, question, answer, sort_order, is_active, created_by)
    values (p_campus_id, p_category, trim(p_question), trim(p_answer), coalesce(p_sort_order, 0), coalesce(p_is_active, true), v_user)
    returning * into v_row;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
    values (v_user, 'support_faq.create', 'support_faq', v_row.id::text, to_jsonb(v_row));
  end if;

  return v_row;
end;
$$;

revoke all on function public.admin_upsert_support_faq(uuid, uuid, text, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_upsert_support_faq(uuid, uuid, text, text, text, integer, boolean) to authenticated;

create or replace function public.admin_delete_support_faq(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.support_faqs;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if not (public.has_permission(v_user, 'support.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the help centre';
  end if;

  select * into v_row from public.support_faqs where id = p_id;
  if not found then
    raise exception 'FAQ entry not found';
  end if;

  delete from public.support_faqs where id = p_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value)
  values (v_user, 'support_faq.delete', 'support_faq', p_id::text, to_jsonb(v_row));
end;
$$;

revoke all on function public.admin_delete_support_faq(uuid) from public, anon;
grant execute on function public.admin_delete_support_faq(uuid) to authenticated;
