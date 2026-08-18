-- =============================================================================
-- MESSAGE DELETE + PER-MESSAGE MODERATION
-- Closes two gaps found in the 2026-08-17 messaging verification pass:
-- (1) no user-facing way to delete/unsend a message at all, (2) a
-- conversation report could only Suspend-the-user or Dismiss -- there was no
-- way to remove the specific offending message (canModerateContent() in
-- AdminCMS.jsx only ever covered post/comment).
--
-- Soft delete, not hard delete: blank the content but keep the row + a
-- deleted_at/deleted_by marker, so the thread still renders a coherent
-- "This message was deleted/removed" placeholder in place instead of a gap
-- or a renumbered thread -- same reasoning as moderate_content()'s
-- hide/remove statuses for posts/comments, just applied to a table that has
-- no status column of its own.
-- =============================================================================

alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

-- messages_body_check (20260815001500) requires body-or-attachment; a
-- deleted message legitimately has neither once cleared, so exempt it.
do $$ begin
  alter table public.messages drop constraint if exists messages_body_check;
  alter table public.messages add constraint messages_body_check
    check (deleted_at is not null or ((length(btrim(body)) > 0 or attachment_path is not null) and length(body) <= 4000));
exception when others then null; end $$;

-- Sender can delete their own message at any time; a moderator
-- (moderation.act permission or admin) can remove anyone's message --
-- used from the conversation-report review flow. Both paths clear the
-- actual content (a real delete, not just a client-side hide) and stamp
-- who did it so the UI can tell "you deleted this" from "a moderator
-- removed this."
create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_msg public.messages;
  v_is_mod boolean;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_msg from public.messages where id = p_message_id;
  if v_msg.id is null then raise exception 'Message not found'; end if;
  if v_msg.deleted_at is not null then return; end if;

  v_is_mod := public.has_permission(v_user, 'moderation.act') or public.current_user_is_admin();

  if v_msg.sender_id <> v_user and not v_is_mod then
    raise exception 'Not authorized to delete this message';
  end if;

  update public.messages
    set body = '', attachment_path = null, deleted_at = now(), deleted_by = v_user
    where id = p_message_id;

  if v_is_mod and v_msg.sender_id <> v_user then
    insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
    values (v_user, 'message', p_message_id, 'remove', 'Removed from a reported conversation');
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
    values (v_user, 'moderation.remove', 'message', p_message_id::text, 'Removed from a reported conversation');
  end if;
end;
$$;

grant execute on function public.delete_message(uuid) to authenticated;
revoke execute on function public.delete_message(uuid) from public, anon;

-- Moderator-only read of a reported conversation's messages -- the caller
-- reviewing a report isn't a participant, so the plain
-- messages_read_participant RLS policy would otherwise block them entirely.
-- Same trust boundary as get_report_context() (moderation.act or admin).
create or replace function public.admin_get_conversation_messages(p_conversation_id uuid, p_limit integer default 50)
returns table (
  id uuid, sender_id uuid, sender_name text, body text, attachment_path text,
  deleted_at timestamptz, deleted_by uuid, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  return query
    select m.id, m.sender_id, pr.name, m.body, m.attachment_path, m.deleted_at, m.deleted_by, m.created_at
    from public.messages m
    join public.profiles pr on pr.id = m.sender_id
    where m.conversation_id = p_conversation_id
    order by m.created_at desc
    limit p_limit;
end;
$$;

grant execute on function public.admin_get_conversation_messages(uuid, integer) to authenticated;
revoke execute on function public.admin_get_conversation_messages(uuid, integer) from public, anon;
