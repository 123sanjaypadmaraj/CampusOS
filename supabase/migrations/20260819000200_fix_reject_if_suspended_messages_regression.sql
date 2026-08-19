-- =============================================================================
-- Fix a real regression in reject_if_suspended(), found by re-running
-- scripts/live-check-message-delete-notification-prefs.mjs and
-- scripts/live-check-marketplace-messaging.mjs against production during
-- the 2026-08-19 backlog-ship pass: every send_message() call failed with
-- "record \"new\" has no field \"user_id\"".
--
-- Root cause: 20260814004200_messaging.sql's version of this function added
-- an `elsif TG_TABLE_NAME = 'messages' then v_user := new.sender_id;`
-- branch (messages.sender_id, not .user_id -- same PL/pgSQL "only the
-- matching IF/ELSIF branch is compiled" reasoning as 20260814003100's own
-- fix comment). 20260818000500_email_domain_enforcement_and_account_
-- deletion.sql recreated this function to add 'deleted'-status handling but
-- was based on an earlier version and silently dropped the messages branch
-- -- a real "recreate from latest, not an earlier copy" miss. This
-- reintroduces it, keeping the 'deleted' handling.
-- =============================================================================

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
  if TG_TABLE_NAME = 'posts' or TG_TABLE_NAME = 'comments' then
    v_user := new.author_id;
  elsif TG_TABLE_NAME = 'marketplace_listings' then
    v_user := new.seller_id;
  elsif TG_TABLE_NAME = 'messages' then
    v_user := new.sender_id;
  else
    v_user := new.user_id;
  end if;

  if v_user is null then
    return new;
  end if;

  select status into v_status from public.profiles where id = v_user;

  if v_status = 'suspended' then
    raise exception 'ACCOUNT_SUSPENDED: your account has been suspended and cannot do this. Contact a campus admin.';
  end if;

  if v_status = 'deleted' then
    raise exception 'ACCOUNT_DELETED: this account has been deleted and cannot do this.';
  end if;

  return new;
end;
$$;
