# Archived — do not run these

These files are the pre-hardening schema history. They are kept only so the
evolution of the schema is traceable in git. **Do not run any of them against
a database** — most grant fully open row-level security
(`for all to anon, authenticated using (true) with check (true)`), which lets
any unauthenticated request read or write every row in the database.

The current schema lives in `/supabase/migrations/`. See that folder's
`README.md` for how to apply it.
