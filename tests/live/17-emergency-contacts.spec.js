// tests/live/17-emergency-contacts.spec.js
//
// Verifies the verified emergency-contacts directory (doc §113) against the
// LIVE deployed app: a real student adds a next-of-kin contact from their
// Profile page, a real facilities_staff account verifies it from the Admin
// CMS's Emergency Contacts queue, editing it afterward drops it back to
// "Pending verification" in the UI, and a responder can pull it up from a
// real active SOS alert (the actual point of building this -- see
// supabase/migrations/20260815000700_emergency_contacts.sql).

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
const FACILITIES = 'facilities.staff@nhce.edu.in';

const CONTACT_NAME = `E2E Emergency Contact ${Date.now()}`;

test.describe.serial('Emergency contacts directory', () => {
  test.beforeAll(async () => {
    // Same test-isolation lesson as the other admin/facilities specs: clear
    // out any contacts and active alerts a previous failed run left behind
    // for Alice so locators here resolve to this run's rows.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const aliceId = getTestUserId(ALICE);
    await admin.from('emergency_contacts').delete().eq('user_id', aliceId);
    await admin.from('sos_alerts').update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('user_id', aliceId).in('status', ['active', 'acknowledged']);
  });

  test('Alice adds an emergency contact from her Profile', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    await page.getByRole('button', { name: /Manage emergency contacts/i }).click();

    await expect(page.getByText(/No emergency contacts yet/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Add emergency contact/i }).click();

    await page.getByPlaceholder(/Contact's full name/i).fill(CONTACT_NAME);
    await page.getByPlaceholder('+91XXXXXXXXXX').fill('9876543210');
    await page.getByRole('button', { name: /Save contact/i }).click();

    await expect(page.getByText('Emergency contact added')).toBeVisible({ timeout: 10000 });
    const row = page.locator('.resource-row', { hasText: CONTACT_NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Pending verification');
  });

  test('facilities staff verifies it from their own dashboard queue', async ({ page, context }) => {
    await seedRealSession(context, FACILITIES);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-facilities-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Emergency Contacts/i }).click();

    const row = page.locator('.resource-row', { hasText: CONTACT_NAME });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('9876543210');

    await row.getByRole('button', { name: /Verify/i }).click();
    await expect(page.getByText('Emergency contact verified')).toBeVisible({ timeout: 10000 });
    // Verifying drops it out of the pending queue.
    await expect(page.locator('.resource-row', { hasText: CONTACT_NAME })).toHaveCount(0, { timeout: 10000 });
  });

  test("Alice sees it as verified, and editing it resets that back to pending", async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    await page.getByRole('button', { name: /Manage emergency contacts/i }).click();

    let row = page.locator('.resource-row', { hasText: CONTACT_NAME });
    await expect(row).toContainText('Verified', { timeout: 10000 });

    await row.getByRole('button').first().click(); // edit (pencil icon button)
    await page.getByPlaceholder('+91XXXXXXXXXX').fill('9876543299');
    await page.getByRole('button', { name: /Save contact/i }).click();
    await expect(page.getByText('Emergency contact updated')).toBeVisible({ timeout: 10000 });

    row = page.locator('.resource-row', { hasText: CONTACT_NAME });
    await expect(row).toContainText('Pending verification');
  });

  test('a facilities responder can pull it up from a real active SOS alert', async ({ page, context }) => {
    // Trigger a real alert as Alice via the service role (equivalent to the
    // "Campus help" quick-action already covered end-to-end in
    // 14-sos-alerts.spec.js -- this spec's job is the contacts integration,
    // not re-proving SOS dispatch itself).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const aliceClient = createClient(SUPABASE_URL, readEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY'));
    await aliceClient.auth.signInWithPassword({ email: ALICE, password: 'TestPass!2026Alice' });
    const { error } = await aliceClient.rpc('trigger_sos_alert', { p_alert_type: 'help' });
    expect(error).toBeFalsy();

    await seedRealSession(context, FACILITIES);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-facilities-button').click();
    await page.getByRole('button', { name: /SOS Alerts/i }).click();

    const alertRow = page.locator('.sos-alert-row', { hasText: 'Campus help requested' }).first();
    await expect(alertRow).toBeVisible({ timeout: 10000 });
    await alertRow.getByRole('button', { name: /View emergency contacts/i }).click();

    await expect(alertRow.getByText(CONTACT_NAME)).toBeVisible({ timeout: 10000 });
    await expect(alertRow.getByText('9876543299')).toBeVisible();
    await expect(alertRow.getByText(/unverified/i)).toBeVisible();

    // Cleanup: resolve the alert and remove the test contact so nothing is
    // left behind for the next run or a real responder to see.
    await alertRow.getByRole('button', { name: /Mark resolved/i }).click();
    await alertRow.getByRole('button', { name: /Confirm resolved/i }).click();
    await admin.from('emergency_contacts').delete().eq('contact_name', CONTACT_NAME);
  });
});
