// tests/live/12-legal-and-consent.spec.js
//
// Verifies the privacy policy/terms page and signup consent gate against
// the LIVE deployed app: signup is actually blocked without checking the
// consent box (not just a suggestion), the inline policy preview shows
// real content, and the standalone Legal page is reachable from Profile.

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';

const ALICE = 'e2e.alice@nhce.edu.in';

test.describe.serial('Legal page + signup consent', () => {
  test('signup is blocked until the consent checkbox is checked', async ({ page }) => {
    // Must match the real NHCE USN structure the signup form enforces for
    // new accounts (App.jsx's handleSubmit / src/features/auth/usn.ts's
    // USN_PATTERN: \dNH\d{2}[A-Za-z]{2}\d{3}) -- see the identical fix/note
    // in 03-usn-login-and-cms.spec.js.
    const usn = `1NH25XY${Date.now().toString().slice(-3)}`;
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('sign-in-button').click();
    await page.getByRole('button', { name: 'USN & password' }).click();
    await page.getByRole('button', { name: /New here\? Create an account/i }).click();
    await page.getByLabel('Full name').fill('E2E Consent Test');
    await page.getByLabel('USN').fill(usn);
    await page.getByLabel('Password', { exact: true }).fill('TestPass123');
    await page.getByLabel('Confirm password').fill('TestPass123');

    // Unchecked: the real submit button, not just a client-side alert, is
    // actually disabled.
    await expect(page.getByTestId('usn-login-button')).toBeDisabled();

    // Expanding the inline policy preview shows real content, not a stub.
    await page.getByRole('button', { name: /Privacy Policy & Terms of Service/i }).click();
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByText(/suspended account cannot place/i)).toBeVisible();

    // Checking it unblocks signup, and account creation actually succeeds.
    await page.getByRole('checkbox').check();
    await expect(page.getByTestId('usn-login-button')).toBeEnabled();
    await page.getByTestId('usn-login-button').click();
    await expect(page.getByTestId('sign-in-button')).toHaveCount(0, { timeout: 15000 });
  });

  test('the standalone Legal page is reachable from Profile', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Privacy Policy & Terms of Service/i }).click();
    await expect(page.getByRole('heading', { name: 'Privacy & Terms' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();

    await page.getByRole('button', { name: /Back to profile/i }).click();
    await expect(page.getByRole('heading', { name: 'Privacy & Terms' })).toHaveCount(0);
  });
});
