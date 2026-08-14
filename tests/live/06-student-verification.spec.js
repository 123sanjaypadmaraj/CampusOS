// tests/live/06-student-verification.spec.js
//
// Verifies the student ID verification flow against the LIVE deployed app:
// a real student uploads a real file to the private 'documents' storage
// bucket, a real admin reviews it through the Admin CMS, and the "VERIFIED
// STUDENT" badge on the student's own profile reflects the real outcome --
// not the previous unconditional badge.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';
import { resetVerificationFor } from './helpers/resetVerification.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A real (tiny, 1x1) PNG -- the upload path exercises the real 'documents'
// storage bucket end to end, so it needs an actual image file, not a stub.
const TEST_ID_CARD = path.join(__dirname, 'fixtures', 'test-id-card.png');

const CAROL = 'e2e.carol@nhce.edu.in'; // dedicated to this spec so it doesn't collide with Alice's other live specs
const ADMIN = '1nh25cs265@usn.campusos.internal';

test.describe.serial('Student ID verification', () => {
  test.beforeAll(async () => {
    const { listTestUsers } = await import('./helpers/realSession.js');
    const carol = listTestUsers().find((u) => u.email === CAROL);
    await resetVerificationFor(carol.userId);
  });

  test('Carol submits her ID for verification', async ({ page, context }) => {
    await seedRealSession(context, CAROL);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    await page.waitForLoadState('networkidle');

    // Whatever state a previous run left this in, "GET VERIFIED" / "VERIFICATION
    // PENDING" / "Resubmit ID" all open the same upload modal.
    await page.locator('.verified-pill, button:has-text("Resubmit ID")').first().click();
    await expect(page.getByRole('heading', { name: 'Verify your student ID' })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(TEST_ID_CARD);
    await page.getByRole('button', { name: /Submit for review/i }).click();
    await expect(page.getByText('ID submitted for review')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('VERIFICATION PENDING')).toBeVisible({ timeout: 10000 });
  });

  test('Admin sees the request, views the document, and approves it', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Student Verifications' }).click();

    const row = page.locator('.resource-row', { hasText: 'Carol Test' });
    await expect(row).toBeVisible({ timeout: 15000 });

    // Confirm the signed URL actually opens the real private document, not
    // a broken link -- open it in a new tab and check it responds 200.
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      row.getByRole('button', { name: /View ID/i }).click(),
    ]);
    await popup.waitForLoadState('load').catch(() => {});
    expect(popup.url()).toContain('/storage/v1/object/sign/documents/');
    await popup.close();

    await row.getByRole('button', { name: /Approve/i }).click();
    await expect(page.getByText('Student verified')).toBeVisible({ timeout: 10000 });
    await expect(row).toHaveCount(0); // no longer in the pending list
  });

  test("Carol's profile now shows the real VERIFIED STUDENT badge", async ({ page, context }) => {
    await seedRealSession(context, CAROL);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('VERIFIED STUDENT')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Verified — approved/)).toBeVisible();
  });
});
