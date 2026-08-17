-- =============================================================================
-- PHASE 16 FOLLOW-UP: 'Hackathon' as a real opportunity type
--
-- Hackathon team *formation* is already covered by project_teams (doc §22,
-- 20260817000200_team_matching.sql -- 'Hackathon' is one of its categories).
-- This is the separate, admin-curated side: an admin posting an actual
-- hackathon listing (deadline, apply link) the same way they post an
-- Internship/Research/Job/Volunteer/Competition opportunity today.
-- =============================================================================

do $$ begin
  alter table public.opportunities drop constraint if exists opportunities_type_check;
  alter table public.opportunities add constraint opportunities_type_check
    check (type in ('Internship', 'Research', 'Job', 'Volunteer', 'Competition', 'Hackathon'));
exception when others then null;
end $$;
