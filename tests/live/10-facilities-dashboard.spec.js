// tests/live/10-facilities-dashboard.spec.js
//
// Verifies the facilities staff dashboard against the LIVE deployed app:
// a real ticket and a real booking, created through the real student-facing
// flows, get actioned by a real facilities_staff account through a
// dashboard that (before this change) simply didn't exist -- tickets.read/
// tickets.update/bookings.approve and their RPCs were real but had no UI.

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
// Was hardcoded to .service_role_key.local (production only) -- see
// resolveServiceRoleKey.js for why that breaks on staging.
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);

const ALICE = 'e2e.alice@nhce.edu.in';
const FACILITIES = 'facilities.staff@nhce.edu.in';

test.describe.serial('Facilities dashboard', () => {
  test.beforeAll(async () => {
    // Clear any of Alice's still-open tickets/pending bookings from
    // previous runs so this spec's `.first()` locators can only ever
    // resolve to what it creates itself (same test-isolation lesson
    // learned in 05-vendor-order-queue.spec.js).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const aliceId = getTestUserId(ALICE);
    // Not just the "active" statuses -- RESOLVED (not yet CLOSED) is also
    // still visible in the dashboard's queue, so a run that failed after
    // resolving but before closing would otherwise leave a stale RESOLVED
    // row behind too.
    await admin.from('service_requests').delete().eq('user_id', aliceId).neq('status', 'CLOSED');
    await admin.from('bookings').delete().eq('user_id', aliceId).eq('status', 'PENDING');
  });

  test('Alice reports a facilities issue through the real flow', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Services' }).click();
    await page.getByRole('button', { name: /Report an Issue/i }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Report/i }).first().click();
    await expect(page.getByText(/Ticket created/i)).toBeVisible({ timeout: 10000 });
  });

  test('Facilities staff walks the ticket through triage to close', async ({ page, context }) => {
    await seedRealSession(context, FACILITIES);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-facilities-button').click();
    await page.waitForLoadState('networkidle');
    // The dashboard's default tab changed to "SOS Alerts" (was "Tickets") --
    // select Tickets explicitly instead of relying on whatever's default.
    // Scoped to the tab row -- the bottom-nav facilities button's own
    // accessible name also happens to contain "Tickets" (a badge count).
    await page.locator('.socialize-filter-row').getByRole('button', { name: 'Tickets', exact: true }).click();

    const ticketRow = page.locator('.resource-row', { hasText: 'Alice Test' }).first();
    await expect(ticketRow).toBeVisible({ timeout: 15000 });
    await expect(ticketRow).toContainText('SUBMITTED');

    await ticketRow.getByRole('button', { name: 'Triage' }).click();
    await expect(ticketRow).toContainText('TRIAGED', { timeout: 10000 });

    await ticketRow.getByRole('button', { name: 'Assign' }).click();
    await expect(ticketRow).toContainText('ASSIGNED', { timeout: 10000 });

    await ticketRow.getByRole('button', { name: 'Start work' }).click();
    await expect(ticketRow).toContainText('IN_PROGRESS', { timeout: 10000 });

    await ticketRow.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(ticketRow).toContainText('RESOLVED', { timeout: 10000 });

    await ticketRow.getByRole('button', { name: 'Close ticket' }).click();
    // Closed tickets drop out of the active queue entirely.
    await expect(page.locator('.resource-row', { hasText: 'Alice Test' })).toHaveCount(0, { timeout: 10000 });
  });

  test('Alice requests a booking through the real flow', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Services' }).click();
    await page.getByRole('button', { name: /Resource Booking/i }).click();
    await page.waitForLoadState('networkidle');
    // Must be a resource with approval_required = true -- most resources
    // auto-approve on booking (create_booking() only sets status='PENDING'
    // when the resource requires it), so booking "whichever is first" would
    // never actually produce anything for facilities staff to approve.
    await page.locator('.resource-row', { hasText: 'Seminar Hall 2' }).getByRole('button', { name: /^Book$/i }).click();

    const offsetDays = 400 + Math.floor(Math.random() * 300); // far future, clear of other live specs' bookings
    const start = new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 16);
    const end = new Date(Date.now() + (offsetDays * 24 + 1) * 3600 * 1000).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').first().fill(start);
    await page.locator('input[type="datetime-local"]').nth(1).fill(end);
    await page.getByRole('button', { name: /Request booking/i }).click();
    await expect(page.getByText(/Booking requested/i)).toBeVisible({ timeout: 10000 });
  });

  test('Facilities staff approves the booking', async ({ page, context }) => {
    await seedRealSession(context, FACILITIES);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-facilities-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Booking Approvals', exact: true }).click();

    const bookingRow = page.locator('.resource-row', { hasText: 'Alice Test' }).first();
    await expect(bookingRow).toBeVisible({ timeout: 15000 });
    await bookingRow.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Booking approved')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.resource-row', { hasText: 'Alice Test' })).toHaveCount(0, { timeout: 10000 }); // no longer pending
  });
});
