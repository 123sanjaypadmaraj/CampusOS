-- =============================================================================
-- 0230: FIX create_notification() AMBIGUOUS OVERLOAD
-- 20260817001700 added a 7th parameter (p_dedup_key) via `create or replace
-- function`. Postgres identifies a function by its argument type list, not
-- just its name -- adding a parameter changes that list, so `create or
-- replace` created a SECOND overload instead of replacing the original
-- 6-arg one. Every existing 6-positional-argument call site across the
-- whole app (every trigger from 0010 onward) then became ambiguous between
-- the old 6-arg function and the new 7-arg-with-a-default one, breaking
-- notification creation entirely. Caught live during smoke-testing on
-- staging before this ever reached production.
-- =============================================================================

drop function if exists public.create_notification(uuid, text, text, text, text, text);
