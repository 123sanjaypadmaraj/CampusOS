// tests/live/16-error-logging.spec.js
//
// In-house error tracking (no Sentry account) -- verifies the whole chain
// for real: a genuine uncaught error thrown in the live deployed page
// triggers the window.onerror handler (main.jsx), which calls
// log_client_error() and lands a real row in error_logs, which a real
// admin can then see and resolve in the Admin CMS "Errors" tab.

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';

const ADMIN = '1nh25cs265@usn.campusos.internal';

test.describe.serial('Error logging (monitoring)', () => {
  const marker = `E2E synthetic client error ${Date.now()}`;

  test('a real uncaught error in the page gets logged', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Thrown from a macrotask (not directly in evaluate()) so it's a real
    // uncaught error in the page's global scope -- window.onerror fires
    // the same way it would for a genuine bug, not something evaluate()
    // just rejects on the Node side.
    await page.evaluate((msg) => {
      setTimeout(() => { throw new Error(msg); }, 0);
    }, marker);

    // logClientError() is fire-and-forget over the network -- give it a
    // moment to actually land before checking the admin view.
    await page.waitForTimeout(2000);

    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Errors', exact: true }).click();

    const row = page.locator('.resource-row', { hasText: marker });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toContainText('ERROR');
  });

  test('admin can mark it resolved and it drops off the open list', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Errors', exact: true }).click();

    const row = page.locator('.resource-row', { hasText: marker });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(row).toHaveCount(0);

    await page.getByRole('button', { name: 'Resolved', exact: true }).click();
    await expect(page.locator('.resource-row', { hasText: marker })).toBeVisible({ timeout: 15000 });
  });
});
