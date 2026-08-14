-- =============================================================================
-- 0026: FIX register_for_event() DUPLICATE OVERLOAD
-- 0024 added p_contact_name/p_roll_number/p_department to register_for_event()
-- but CREATE OR REPLACE only replaces a function with the exact same
-- argument list -- going from 2 params to 5 created a SECOND overload
-- instead of replacing the old one (the same pitfall 0019 already guarded
-- against when it went from 1 param to 2, by dropping first). Collapse back
-- to a single canonical signature so there's no stale 2-arg version left
-- silently skipping the name/roll-number/department handling.
-- =============================================================================

drop function if exists public.register_for_event(uuid, text);
