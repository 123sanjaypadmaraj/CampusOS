// tests/live/04-connect-and-social-links.spec.js
//
// Verifies the LinkedIn/GitHub/achievements profile fields and the
// "Connect" classmate directory (formerly the spoofed "Socialize" tab)
// against the LIVE deployed app with REAL Supabase sessions. Alice sets her
// social links + an achievement on her own profile; Bob (a different real
// user, different branch/year) then reads them back through Connect --
// proving the RPC change, RLS, and the UI all actually work together, not
// just that the code builds.
//
// Run with: npx playwright test -c playwright.live.config.cjs 04-connect

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';

const ALICE = 'e2e.alice@nhce.edu.in'; // Computer Science & Engineering, 3rd Year
const BOB = 'e2e.bob@nhce.edu.in';     // Information Science & Engineering, 2nd Year
const CAROL = 'e2e.carol@nhce.edu.in'; // Electronics & Communication, 4th Year

const LINKEDIN = 'https://linkedin.com/in/alice-e2e-test';
const GITHUB = 'https://github.com/alice-e2e-test';
const ACHIEVEMENT = `E2E Hackathon Winner ${Date.now()}`;

test.describe.serial('Profile social links + achievements', () => {
  test('Alice: invalid URLs are rejected client-side, then valid ones save', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    await page.getByRole('button', { name: /Edit profile/i }).click();

    // Bad LinkedIn URL should be rejected before any network call, with the
    // modal staying open (no "Profile updated" toast).
    await page.getByLabel(/LinkedIn URL/i).fill('not-a-url');
    await page.getByLabel(/GitHub URL/i).fill(GITHUB);
    await page.getByRole('button', { name: /Save profile/i }).click();
    await expect(page.getByText(/LinkedIn URL should look like/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Save profile/i })).toBeVisible();

    // Now fill in valid values for everything and save for real.
    await page.getByLabel(/LinkedIn URL/i).fill(LINKEDIN);
    await page.getByLabel(/GitHub URL/i).fill(GITHUB);
    await page.getByLabel(/Achievements/i).fill(ACHIEVEMENT);
    await page.getByRole('button', { name: /Save profile/i }).click();
    await expect(page.getByText('Profile updated')).toBeVisible({ timeout: 10000 });

    // The saved data should now render on Alice's own profile page.
    await expect(page.getByRole('link', { name: /LinkedIn/i })).toHaveAttribute('href', LINKEDIN);
    await expect(page.getByRole('link', { name: /GitHub/i })).toHaveAttribute('href', GITHUB);
    await expect(page.getByText(ACHIEVEMENT)).toBeVisible();

    // Surviving a reload proves it round-tripped through the DB, not just
    // local component state.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    await expect(page.getByRole('link', { name: /LinkedIn/i })).toHaveAttribute('href', LINKEDIN);
    await expect(page.getByText(ACHIEVEMENT)).toBeVisible();
  });

  test('Bob: sees Alice in Connect with her real links and achievement', async ({ page, context }) => {
    await seedRealSession(context, BOB);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('nav.bottom-nav button', { hasText: 'Connect' }).click();
    await page.waitForLoadState('networkidle');

    // The old spoofed content must be gone.
    await expect(page.getByText('PES University')).toHaveCount(0);
    await expect(page.getByText('nearby colleges', { exact: false })).toHaveCount(0);

    // Real classmate data must be present: Bob should never see himself...
    await expect(page.getByText('Bob Test')).toHaveCount(0);
    // ...but should see Alice, a different real student on the same campus,
    // along with the achievement and links she just saved.
    const aliceCard = page.locator('.person-card', { hasText: 'Alice Test' });
    await expect(aliceCard).toBeVisible({ timeout: 10000 });
    await expect(aliceCard.getByText(ACHIEVEMENT)).toBeVisible();
    await expect(aliceCard.getByRole('link', { name: /LinkedIn/i })).toHaveAttribute('href', LINKEDIN);
    await expect(aliceCard.getByRole('link', { name: /GitHub/i })).toHaveAttribute('href', GITHUB);

    // Branch filter: clicking Alice's branch chip should narrow the list to
    // only Computer Science & Engineering classmates (Bob himself is IS, so
    // filtering to CS must not just be "everyone").
    await page.getByRole('button', { name: 'Computer Science & Engineering', exact: true }).click();
    await expect(aliceCard).toBeVisible();
    const cardsAfterFilter = page.locator('.person-card');
    const count = await cardsAfterFilter.count();
    for (let i = 0; i < count; i++) {
      await expect(cardsAfterFilter.nth(i)).toContainText('Computer Science & Engineering');
    }

    // Search narrows to the achievement text too.
    await page.getByRole('button', { name: 'All branches', exact: true }).click();
    await page.getByPlaceholder(/Search classmates/i).fill(ACHIEVEMENT);
    await expect(aliceCard).toBeVisible();
    await expect(page.locator('.person-card')).toHaveCount(1);
  });

  test('Carol: "My branch" quick filter shows only her own branch', async ({ page, context }) => {
    await seedRealSession(context, CAROL);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('nav.bottom-nav button', { hasText: 'Connect' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.person-card').first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /My branch/i }).click();
    await expect(page.getByText(/Showing your Electronics & Communication classmates/i)).toBeVisible({ timeout: 5000 });

    const cards = page.locator('.person-card');
    const count = await cards.count();
    // Carol is EC 4th Year and is the only EC seed account, so this is
    // expected to be either zero (no other EC students yet) or, if any
    // exist, every card must actually say EC -- either outcome proves the
    // filter is real rather than a no-op that shows everyone.
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i)).toContainText('Electronics & Communication');
    }
  });
});
