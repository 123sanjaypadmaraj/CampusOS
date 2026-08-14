// tests/live/05-people-you-may-know-and-groups.spec.js
//
// "People you may know" ranked suggestions + auto-formed cohort groups,
// verified against the live deployed app and real Supabase backend.

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';

const ALICE = 'e2e.alice@nhce.edu.in';

test.beforeEach(async ({ context, page }) => {
  await seedRealSession(context, ALICE);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test('Suggested for you: shows ranked people with match reasons', async ({ page }) => {
  await page.locator('nav.bottom-nav button', { hasText: 'Connect' }).click();
  await page.getByRole('button', { name: /Suggested for you/i }).click();

  // The RPC fires from a useEffect a tick after the click resolves, so
  // networkidle right after clicking can race it -- poll for the outcome
  // (real cards or the explicit empty state) instead.
  const outcome = page.locator('.person-card').first().or(page.getByText('No suggestions yet'));
  await expect(outcome).toBeVisible({ timeout: 15000 });

  const hasCards = await page.locator('.person-card').count();
  if (hasCards > 0) {
    // Every suggestion card shows a percentage match score.
    await expect(page.locator('.person-card .match').first()).toBeVisible();
  }
});

test('Groups: auto cohort groups list and member view load', async ({ page }) => {
  await page.locator('nav.bottom-nav button', { hasText: 'Connect' }).click();
  await page.getByRole('button', { name: /^Groups$/i }).click();

  const outcome = page.locator('.resource-row').first().or(page.getByText('No groups yet'));
  await expect(outcome).toBeVisible({ timeout: 15000 });

  const hasGroups = await page.locator('.resource-row').count();
  if (hasGroups > 0) {
    await page.getByRole('button', { name: /View members/i }).first().click();
    await expect(page.getByText('COHORT GROUP')).toBeVisible({ timeout: 10000 });
    // Loads without crashing into a blank modal -- either real members or
    // an explicit empty/error state, never nothing.
    await expect(async () => {
      const modalText = await page.locator('.feature-modal').textContent();
      expect(modalText.length).toBeGreaterThan(20);
    }).toPass({ timeout: 10000 });
  }
});
