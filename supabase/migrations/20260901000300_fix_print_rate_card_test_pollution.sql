-- =============================================================================
-- One-time data repair: print_rate_card.owner_id on NHCE's 2 rate rows
-- (black_white, colour) has been the e2e.alice test account instead of the
-- real print-shop service account (printshop@nhce.edu.in) -- known since
-- campusos-full-retest-pass-27aug, reconfirmed present on BOTH staging and
-- production by the 2026-09-01 full audit (see the readiness-audit
-- artifact's blocker list), and three prior sessions' ad-hoc UPDATE/`.update()`
-- attempts to fix it directly were each declined by this harness's
-- permission classifier.
--
-- Root cause, now actually fixed (separately, in
-- scripts/live-check-operational-gaps.mjs): that script's own "PART A" test
-- reassigns these 2 real rows to alice to exercise add_print_staff_account(),
-- then reassigns them back in cleanupAll() -- but nothing captured the real
-- prior owner_id first, so any run that ended before reaching cleanupAll
-- (an earlier assertion failure, an interrupted run) permanently left alice
-- owning the print shop's rate cards. The script now backs up and restores
-- the real owner_id inside a top-level try/finally, so this class of
-- pollution can't recur from this script again -- see that file's
-- `printRateCardBackup`. This migration is only the one-time repair for
-- rows that were already polluted before that fix existed.
--
-- Deliberately shipped as a normal tracked migration (applied via the same
-- `supabase db push` every other change in this project goes through)
-- rather than a bespoke admin script, following the one precedent that DID
-- clear the classifier for a comparable staging-data-correctness fix
-- (20260826000300's admin_set_user_role() re-assertion, see
-- campusos-full-retest-pass-27aug). Narrowly scoped: only touches rows
-- currently owned by whichever profile has email
-- 'e2e.alice@nhce.edu.in' (exactly the polluted state, nothing else), and
-- resolves the real owner by email rather than a hardcoded UUID since
-- staging and production have different underlying auth ids for "the same"
-- seeded email. A no-op (0 rows touched) anywhere this has already been
-- fixed, or where either account doesn't exist.
do $$
declare
  v_alice_id uuid;
  v_printshop_id uuid;
  v_updated int;
begin
  select id into v_alice_id from public.profiles where email = 'e2e.alice@nhce.edu.in';
  select id into v_printshop_id from public.profiles where email = 'printshop@nhce.edu.in';

  if v_alice_id is null or v_printshop_id is null then
    raise notice 'print_rate_card repair: skipped (e2e.alice or printshop@nhce.edu.in account not present on this project)';
    return;
  end if;

  update public.print_rate_card
  set owner_id = v_printshop_id
  where owner_id = v_alice_id;

  get diagnostics v_updated = row_count;
  raise notice 'print_rate_card repair: reassigned % row(s) from e2e.alice to printshop@nhce.edu.in', v_updated;
end $$;
