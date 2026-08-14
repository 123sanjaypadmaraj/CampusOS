-- =============================================================================
-- 0031: FIX reject_if_suspended() -- "record new has no field author_id"
-- =============================================================================
-- The previous version picked the right column with a single SQL `CASE
-- TG_TABLE_NAME WHEN ... THEN new.author_id ... END` expression. PL/pgSQL
-- compiles/plans a CASE expression as one query against NEW's concrete row
-- type for that specific trigger firing -- every branch's column reference
-- gets validated, not just the one actually selected, so firing on `orders`
-- (no author_id/seller_id columns) failed immediately with
-- "record new has no field author_id" before ever reaching the orders
-- branch. An IF/ELSIF chain is separate PL/pgSQL statements; only the
-- matching branch's expression is ever compiled/evaluated.
-- Found live while testing account suspension enforcement.

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

  return new;
end;
$$;
