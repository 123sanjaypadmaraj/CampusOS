// tests/live/26-permission-boundary-ui.spec.js
//
// Verifies the RBAC frontend permission layer (readiness-audit phase 2 --
// 20260822000100_rbac_frontend_permission_layer.sql + src/hooks/
// usePermissions.js) against the LIVE deployed app. Two things this guards
// against regressing, both confirmed bugs in the code this pass replaced:
//
//   1. A canteen manager (vendor_staff role, the account
//      20260819000300_vendor_manager_accounts.sql's add_canteen_staff_account
//      creates) could never reach the Vendor Dashboard at all -- App.jsx's
//      nav/route gate checked profile.role === 'vendor' only, never
//      'vendor_staff'. RLS was never the problem (a manager already had full
//      data access); the frontend gate itself was just wrong. This is a UI
//      bug no RPC-level live-check script (e.g.
//      scripts/live-check-operational-gaps.mjs) could ever catch, since it
//      only exercises the backend directly.
//   2. A plain student must still be fully blocked from every role-gated
//      surface -- the baseline the permission hook must not regress.
//
// Setup seeds the manager relationship directly via service_role (the same
// row add_canteen_staff_account() would produce) rather than calling that
// RPC as a signed-in Udupi session, so this spec doesn't need Udupi's
// password on top of the service_role key it already has to hold.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedRealSession } from './helpers/realSession.js';
import { resolveServiceRoleKey } from './helpers/resolveServiceRoleKey.js';
import { runProjectSql } from '../../scripts/env-target.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

function readEnvVar(name) {
  return fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}
const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];

const UDUPI_VENDOR = 'udupi.canteen@nhce.edu.in';
const BOB = 'e2e.bob@nhce.edu.in';
const ALICE = 'e2e.alice@nhce.edu.in';

function svc() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

// profiles.role is protected by a trigger (protect_profile_role) that raises
// unless campusos.allow_role_change is set for the same session -- a plain
// PostgREST update via service_role can't set that session-local GUC first,
// so this needs a real SQL connection. Same technique
// scripts/live-check-operational-gaps.mjs's forceRole() and every
// scripts/setup-*.mjs script already use.
function forceRole(userId, role) {
  runProjectSql(root, PROJECT_REF, `do $$ begin
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = '${role}' where id = '${userId}';
  end $$;`);
}

test.describe.serial('RBAC frontend permission layer -- permission-boundary UI', () => {
  let bobUserId;
  let canteenId;

  test.beforeAll(async () => {
    const sb = svc();
    const { data: bob } = await sb.from('profiles').select('id, role').eq('email', BOB).single();
    bobUserId = bob.id;
    // add_canteen_staff_account (the real path) only ever promotes a plain
    // student or an already-vendor_staff account -- reset unconditionally in
    // case a previous failed run left Bob mid-promotion.
    if (bob.role !== 'student') forceRole(bobUserId, 'student');

    const { data: udupi } = await sb.from('profiles').select('id').eq('email', UDUPI_VENDOR).single();
    const { data: canteen } = await sb.from('canteens').select('id').eq('owner_id', udupi.id).single();
    canteenId = canteen.id;

    await sb.from('canteen_staff_accounts')
      .upsert({ canteen_id: canteenId, user_id: bobUserId, added_by: udupi.id, active: true }, { onConflict: 'canteen_id,user_id' });
    forceRole(bobUserId, 'vendor_staff');
  });

  test.afterAll(async () => {
    const sb = svc();
    await sb.from('canteen_staff_accounts').delete().eq('canteen_id', canteenId).eq('user_id', bobUserId);
    forceRole(bobUserId, 'student');
  });

  test('a canteen manager (vendor_staff) reaches the Vendor Dashboard -- previously impossible', async ({ page, context }) => {
    await seedRealSession(context, BOB);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The old profile.role === 'vendor' gate would show "Vendor access
    // only" here (or bounce a manager to Home with no way back in) --
    // isVendorAccount now covers 'vendor_staff' too.
    await expect(page.getByText(/Vendor access only/i)).toHaveCount(0);
    await expect(page.getByTestId('nav-vendor-button')).toBeVisible();

    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/vendor$/);
    await expect(page.getByText(/Vendor access only/i)).toHaveCount(0);

    // A manager gets the same purpose-built vendor nav (Dashboard + Profile
    // only) a literal owner does -- isVendorAccount drives both gates off
    // the same hook.
    await expect(page.locator('nav.bottom-nav button')).toHaveCount(2);
    await expect(page.getByTestId('nav-profile-button')).toBeVisible();
  });

  test('deep-linking straight into /vendor as a manager lands on the dashboard, not bounced to Home', async ({ page, context }) => {
    await seedRealSession(context, BOB);
    await page.goto('/vendor');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/vendor$/, { timeout: 10000 });
    await expect(page.getByText(/Vendor access only/i)).toHaveCount(0);
  });
});

// Its own describe (no beforeAll/afterAll) -- this check needs no manager
// fixture state at all, so it shouldn't pay for or depend on the
// forceRole()/canteen_staff_accounts setup above.
test.describe('RBAC frontend permission layer -- student stays blocked from Admin', () => {
  test('a plain student still cannot reach Admin -- no nav button, deep link bounces home', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('nav-admin-button')).toHaveCount(0);

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
    await expect(page.getByText(/Admin access only/i)).toHaveCount(0);
  });
});
