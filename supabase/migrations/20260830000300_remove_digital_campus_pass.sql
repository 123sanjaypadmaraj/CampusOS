-- =============================================================================
-- 0055: REMOVE DIGITAL CAMPUS PASS -- feature dropped from the product
-- (user request: remove Campus Delivery, Hostel, Smart Campus Map, Digital
-- Campus Pass and Autonomous Campus entirely). Those other four were always
-- frontend-only mock/demo screens with no backend of their own, so there's
-- nothing to drop for them here. Digital Campus Pass was the one real
-- backend feature among the five (see 20260814004400_digital_campus_pass.sql
-- + 20260814004700_fix_pass_token_newlines_and_search_order.sql) -- this
-- migration tears down exactly what those two added, and nothing else.
-- global_search()/b64url_encode's OTHER caller-free helper stay untouched
-- since 0047 bundled an unrelated global_search fix in the same file; that
-- function is still live and used by the app's search bar.
-- =============================================================================

drop function if exists public.mint_campus_pass();
drop function if exists public.verify_campus_pass(text);
drop function if exists public.b64url_decode(text);
drop function if exists public.b64url_encode(bytea);

delete from public.role_permissions
where permission_id in (select id from public.permissions where key = 'pass.verify');

delete from public.permissions where key = 'pass.verify';

-- Vault has no delete_secret() RPC -- vault.secrets is a real table
-- (vault.decrypted_secrets is just a decrypting view over it), so remove
-- the row directly.
delete from vault.secrets where name = 'campus_pass_secret';
