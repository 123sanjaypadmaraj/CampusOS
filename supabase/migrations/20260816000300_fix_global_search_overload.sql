-- =============================================================================
-- Fix a real overload bug from 20260816000200_smart_search.sql: adding a
-- new p_types text[] default parameter via CREATE OR REPLACE FUNCTION did
-- NOT replace the original 2-arg global_search(text, integer) in place --
-- it created a second, distinct overload (same pitfall already documented
-- for register_for_event() in 20260814002600_fix_register_for_event_overload.sql).
-- Every existing caller (searchService.js's globalSearch()) calls with
-- named parameters (p_query, p_limit) only, which is ambiguous between the
-- two overloads once both exist. Drop the stale 2-arg signature so only
-- the 3-arg version remains.
-- =============================================================================

drop function if exists public.global_search(text, integer);
