// tests/live/09-org-requests.spec.js
//
// Verifies the club/vendor request + approval workflow against the LIVE
// deployed app: a real student submits a club request through the real
// "Start a club" button, a real admin approves it through Admin CMS, and a
// real club actually gets created (not just a status flip) -- then does
// the same for a vendor application, which approves without creating an
// account (that step is a deliberate manual follow-up, not automatable
// from client code).

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';

const ALICE = 'e2e.alice@nhce.edu.in';
const BOB = 'e2e.bob@nhce.edu.in';
const ADMIN = '1nh25cs265@usn.campusos.internal';

test.describe.serial('Club/vendor request + approval', () => {
  const clubName = `E2E Robotics Guild ${Date.now()}`;
  const vendorName = `E2E Snacks Co ${Date.now()}`;

  test('Alice requests a new club through the real "Start a club" button', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Campus' }).click();
    await page.waitForLoadState('networkidle');
    await page.locator('.command-card', { hasText: 'Clubs' }).click();
    await expect(page.getByRole('heading', { name: 'Clubs Hub' })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /Start a club/i }).click();
    await page.getByLabel('Club name').fill(clubName);
    await page.getByLabel("What's this club about?").fill('Building and racing robots.');
    await page.getByLabel('Category').fill('Technology');
    await page.getByRole('button', { name: /Submit request/i }).click();
    await expect(page.getByText('Request submitted')).toBeVisible({ timeout: 10000 });
  });

  test('Bob applies to become a vendor from his Profile', async ({ page, context }) => {
    await seedRealSession(context, BOB);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Apply to become a vendor/i }).click();
    await page.getByLabel('Business name').fill(vendorName);
    await page.getByLabel('What will you sell?').fill('Late-night snacks near the hostel.');
    await page.getByLabel(/Category \(canteen, print, etc\.\)/i).fill('Snacks');
    await page.getByLabel('Contact phone').fill('9876543210');
    await page.getByRole('button', { name: /Submit request/i }).click();
    await expect(page.getByText('Request submitted')).toBeVisible({ timeout: 10000 });
  });

  test('Admin approves the club request and a real club is created', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Requests', exact: true }).click();

    const clubRow = page.locator('.resource-row', { hasText: clubName });
    await expect(clubRow).toBeVisible({ timeout: 15000 });
    await expect(clubRow).toContainText('Alice Test');

    await clubRow.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(`${clubName} club created`)).toBeVisible({ timeout: 10000 });
    await expect(clubRow).toHaveCount(0); // no longer pending

    // The real proof: it shows up as an actual club, not just an approved
    // request row -- check the Admin CMS's own Clubs list (Events & Clubs
    // tab has an Events/Clubs sub-toggle).
    await page.getByRole('button', { name: 'Events & Clubs' }).click();
    await page.getByRole('button', { name: 'Clubs', exact: true }).click();
    // Scoped to the list row, not the (still-fading) toast -- both contain
    // the club name text.
    await expect(page.locator('.resource-row', { hasText: clubName })).toBeVisible({ timeout: 10000 });
  });

  test('Admin approves the vendor application (account provisioning stays manual)', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Requests', exact: true }).click();

    const vendorRow = page.locator('.resource-row', { hasText: vendorName });
    await expect(vendorRow).toBeVisible({ timeout: 15000 });
    await expect(vendorRow).toContainText('Bob Test');
    await expect(vendorRow).toContainText('9876543210');

    await vendorRow.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/set up their vendor account/i)).toBeVisible({ timeout: 10000 });
    await expect(vendorRow).toHaveCount(0);
  });
});
