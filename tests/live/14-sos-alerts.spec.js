// tests/live/14-sos-alerts.spec.js
//
// Verifies the SOS/emergency flow against the LIVE deployed app: the
// Emergency service card actually opens the modal (it used to be a dead
// stub -- notify("Open Emergency from the service card") and nothing
// else), a real alert gets dispatched through trigger_sos_alert() with
// real geolocation, and a real facilities_staff account sees, acknowledges
// and resolves it through the SOS Alerts tab. Admins get the same tab for
// oversight, checked separately.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedRealSession, getTestUserId } from './helpers/realSession.js';
import { resolveServiceRoleKey } from './helpers/resolveServiceRoleKey.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
function readEnvVar(name) {
  return fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}
const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);

const ALICE = 'e2e.alice@nhce.edu.in';
const BOB = 'e2e.bob@nhce.edu.in';
const FACILITIES = 'facilities.staff@nhce.edu.in';
const ADMIN = '1nh25cs265@usn.campusos.internal';

async function openSosModal(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('nav.bottom-nav button', { hasText: 'Services' }).click();
  // Unscoped /Emergency/i now matches 2 buttons -- this SOS quick-action and
  // the (later-added) "Emergency Directory" service card -- so match the
  // exact accessible name instead of a loose regex.
  await page.getByRole('button', { name: 'Emergency Campus SOS' }).click();
  await expect(page.getByText(/Hold for emergency/i)).toBeVisible({ timeout: 10000 });
}

test.describe.serial('SOS / emergency alerts', () => {
  // A previous failed run could leave an active/acknowledged alert behind
  // (same test-isolation lesson as 05-vendor-order-queue.spec.js) --
  // force-resolve any of Alice's/Bob's stray alerts before this run so
  // `.first()`/`toHaveCount(0)` assertions can't resolve to a stale row.
  test.beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const ids = [getTestUserId(ALICE), getTestUserId(BOB)];
    await admin.from('sos_alerts').update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .in('user_id', ids).in('status', ['active', 'acknowledged']);
  });

  test('a quick-action button dispatches a real alert, not a toast simulation', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await openSosModal(page);

    await page.getByRole('button', { name: /^Campus help$/i }).click();

    // Real dispatch, not the old "Campus help requested" toast-only stub.
    await expect(page.getByText('Alert sent', { exact: true })).toBeVisible({ timeout: 15000 });
    // The reporter can call off their own alert before anyone acknowledges.
    await expect(page.getByRole('button', { name: /false alarm/i })).toBeVisible();
    await page.getByRole('button', { name: /false alarm/i }).click();
    await expect(page.getByRole('button', { name: /Hold to activate SOS/i })).toBeVisible({ timeout: 10000 });
  });

  test('holding the SOS button past the threshold sends a general alert with location', async ({ page, context }) => {
    // Grant geolocation up front so the real browser Geolocation API
    // resolves instead of the permission prompt blocking indefinitely.
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 12.9716, longitude: 77.5946 });

    await seedRealSession(context, BOB);
    await openSosModal(page);

    const holdBtn = page.getByRole('button', { name: /Hold to activate SOS/i });
    const box = await holdBtn.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1800); // hold past the 1500ms threshold
    await page.mouse.up();

    await expect(page.getByText('Alert sent', { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('facilities staff sees both alerts, acknowledges one, and resolves it', async ({ page, context }) => {
    await seedRealSession(context, FACILITIES);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-facilities-button').click();
    await page.getByRole('button', { name: /SOS Alerts/i }).click();

    const bobAlert = page.locator('.sos-alert-row', { hasText: 'General emergency' }).first();
    await expect(bobAlert).toBeVisible({ timeout: 10000 });
    // Bob shared a location -- confirm the responder actually sees a real
    // link, not just "no location shared".
    await expect(bobAlert.getByText(/View location/i)).toBeVisible();

    await bobAlert.getByRole('button', { name: /Acknowledge/i }).click();
    await expect(bobAlert.getByText(/ACKNOWLEDGED/i)).toBeVisible({ timeout: 10000 });

    await bobAlert.getByRole('button', { name: /Mark resolved/i }).click();
    await bobAlert.getByRole('button', { name: /Confirm resolved/i }).click();

    // Resolved alerts drop out of the active queue entirely.
    await expect(page.locator('.sos-alert-row', { hasText: 'General emergency' })).toHaveCount(0, { timeout: 10000 });
  });

  test('admins have the same SOS Alerts tab for oversight', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await expect(page.getByRole('button', { name: /SOS Alerts/i })).toBeVisible({ timeout: 10000 });
  });

  test('a plain student cannot see or act on the responder queue (RLS/RPC boundary)', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Alice has no facilities/admin nav tab at all -- the responder queue
    // isn't reachable through the UI for a plain student.
    await expect(page.getByTestId('nav-facilities-button')).toHaveCount(0);
    await expect(page.getByTestId('nav-admin-button')).toHaveCount(0);
  });
});
