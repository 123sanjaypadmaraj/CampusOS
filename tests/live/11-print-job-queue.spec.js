// tests/live/11-print-job-queue.spec.js
//
// Verifies the print shop's job queue (VendorDashboard's Print Shop ->
// Print Queue tab) against the LIVE deployed app: a real file uploaded
// through the real Print Hub flow, walked through the full status pipeline
// by the real Print Shop vendor account.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import { seedRealSession } from './helpers/realSession.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
function readEnvVar(name) {
  return fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}
const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const SERVICE_ROLE_KEY = fs.readFileSync(path.join(root, '.service_role_key.local'), 'utf8').trim();
const TEST_PDF = path.join(__dirname, 'fixtures', 'test-document.pdf');

const ALICE = 'e2e.alice@nhce.edu.in';
const PRINT_SHOP = 'printshop@nhce.edu.in';

test.describe.serial('Print job queue', () => {
  let pickupCode; // set by the upload test, used to find the exact row in the queue

  test.beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const sessions = JSON.parse(fs.readFileSync(path.join(root, 'scripts', '.sessions.json'), 'utf8'));
    const aliceId = sessions[ALICE].userId;
    await admin.from('print_jobs').delete().eq('user_id', aliceId).neq('status', 'COLLECTED');
  });

  test('Alice uploads a document through the real Print Hub flow', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Services' }).click();
    await page.locator('.service-tile, .command-card, article, button', { hasText: 'Print & Documents' }).first().click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();

    await page.locator('input[type="file"]').setInputFiles(TEST_PDF);
    await page.getByRole('button', { name: /Place print order/i }).click();
    const toast = page.getByText(/Print job created/i);
    await expect(toast).toBeVisible({ timeout: 10000 });
    // "Print job created · <code>" -- grab the real code so the next test
    // can find this exact job, not just "whichever one is named Alice Test"
    // (the print shop is a single shared queue; a concurrently-running spec
    // or a leftover job from an earlier failed run could otherwise collide).
    pickupCode = (await toast.textContent()).split('·')[1]?.trim();
    expect(pickupCode).toBeTruthy();
  });

  test('Print shop walks the job through the full queue', async ({ page, context }) => {
    await seedRealSession(context, PRINT_SHOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');

    const jobRow = page.locator('.resource-row', { hasText: `Pickup ${pickupCode}` });
    await expect(jobRow).toBeVisible({ timeout: 15000 });
    // create_print_job() creates every job straight into QUEUED, not
    // UPLOADED -- there's no virus-scan/processing step actually wired up,
    // so UPLOADED/PROCESSING are reachable states in the schema but never
    // actually produced by the only thing that creates a row.
    await expect(jobRow).toContainText('QUEUED');

    await jobRow.getByRole('button', { name: 'Start printing' }).click();
    await expect(jobRow).toContainText('PRINTING', { timeout: 10000 });

    await jobRow.getByRole('button', { name: 'Mark ready' }).click();
    await expect(jobRow).toContainText('READY', { timeout: 10000 });

    await jobRow.getByRole('button', { name: 'Mark collected' }).click();
    // Collected jobs drop out of the active queue.
    await expect(page.locator('.resource-row', { hasText: `Pickup ${pickupCode}` })).toHaveCount(0, { timeout: 10000 });
  });
});
