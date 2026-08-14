// tests/live/08-moderation-console.spec.js
//
// Verifies the moderation console against the LIVE deployed app: a real
// student reports a real post through the actual "..." button (previously
// a dead stub calling notify("Post options opened") -- there was no way
// for a student to actually report anything before this change), a real
// admin reviews it through Admin CMS, hides the post, and the reporter's
// own view of the post reflects that it's gone.

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';

const ALICE = 'e2e.alice@nhce.edu.in';
const BOB = 'e2e.bob@nhce.edu.in';
const ADMIN = '1nh25cs265@usn.campusos.internal';

test.describe.serial('Moderation console', () => {
  const marker = `E2E moderation test post ${Date.now()}`;

  test('Alice posts, then reports someone\'s post through the real "..." button', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a fresh post to report -- deterministic target instead of
    // reporting whatever happens to be first in a shared, ever-changing feed.
    await page.locator('nav.bottom-nav button', { hasText: 'Campus' }).click();
    await page.getByRole('button', { name: /Create post/i }).click();
    await page.getByLabel(/Post type/i).selectOption('General');
    await page.getByLabel(/What do you want to say/i).fill(marker);
    await page.getByRole('button', { name: /Publish/i }).click();
    await expect(page.getByText(marker)).toBeVisible({ timeout: 10000 });

    const post = page.locator('.post', { hasText: marker });
    page.once('dialog', (dialog) => dialog.accept('E2E test report -- spam'));
    await post.getByRole('button', { name: 'Report post' }).click();
    await expect(page.getByText('Reported to campus moderators')).toBeVisible({ timeout: 10000 });
  });

  test('Admin sees the report with real context and hides the post', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Moderation', exact: true }).click();

    // Scoped to this run's unique marker, not the shared "E2E test report"
    // reason text -- a previous run that failed before reaching "Hide"
    // leaves its report row open too, and reason text alone isn't unique
    // enough to tell them apart (learned the hard way: strict-mode
    // violation with 2 matches after a prior partial run).
    const row = page.locator('.resource-row', { hasText: marker });
    await expect(row).toBeVisible({ timeout: 15000 });
    // Real context resolved server-side (get_report_context), not a raw UUID.
    await expect(row).toContainText('Alice Test');

    await row.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByText('Content hidden')).toBeVisible({ timeout: 10000 });
    await expect(row).toHaveCount(0); // resolved, drops out of the open-reports list
  });

  test("the hidden post no longer shows in another student's feed", async ({ page, context }) => {
    // posts_read RLS lets an author always see their own post regardless of
    // status, so this has to be checked from a DIFFERENT real user (Bob) --
    // checking as Alice would trivially pass even if hiding did nothing.
    await seedRealSession(context, BOB);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Campus' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(marker)).toHaveCount(0);
  });
});
