// tests/live/19-route-branching.spec.js
//
// Verifies the real thing a JSDOM unit test can't: that CampusOS ships as
// ONE deployed app with ONE URL space that branches by route + role (doc
// §76-78), not separate Student/Vendor/Admin/Facilities frontends --
// against the actual live host, including Vercel's rewrite config
// (vercel.json) that makes a hard refresh on a deep route resolve to the
// SPA instead of a 404.

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';

const ALICE = 'e2e.alice@nhce.edu.in';

test('anonymous: deep link straight to /events renders the Events section, not just Home', async ({ page }) => {
  await page.goto('/events');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /Campus Events|Events/i }).first()).toBeVisible({ timeout: 10000 });
  expect(new URL(page.url()).pathname).toBe('/events');
});

test('anonymous: a hard refresh on a deep route stays on that route (Vercel SPA rewrite works)', async ({ page }) => {
  await page.goto('/campus');
  await page.waitForLoadState('networkidle');
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(new URL(page.url()).pathname).toBe('/campus');
  await expect(page.getByTestId('nav-campus-button')).toHaveClass(/active/);
});

test('anonymous: an unknown path falls back to Home instead of a blank page or 404', async ({ page }) => {
  const response = await page.goto('/this-route-does-not-exist');
  expect(response.status()).toBeLessThan(400);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('sign-in-button')).toBeVisible();
});

test('anonymous: deep-linking into a role-gated route (/vendor) bounces to Home and fixes the URL', async ({ page }) => {
  await page.goto('/vendor');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
  await expect(page.getByText(/Vendor access only/i)).toHaveCount(0);
});

test('signed-in student: clicking nav updates the URL, and browser back/forward actually navigate', async ({ context, page }) => {
  await seedRealSession(context, ALICE);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.locator('nav.bottom-nav button', { hasText: 'Campus' }).click();
  await expect(page).toHaveURL(/\/campus$/);

  await page.locator('nav.bottom-nav button', { hasText: 'Events' }).click();
  await expect(page).toHaveURL(/\/events$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/campus$/);
  await expect(page.getByTestId('nav-campus-button')).toHaveClass(/active/);

  await page.goForward();
  await expect(page).toHaveURL(/\/events$/);
});

test('signed-in non-vendor student deep-linking into /vendor is still bounced home (server-independent role gate)', async ({ context, page }) => {
  await seedRealSession(context, ALICE);
  await page.goto('/vendor');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
});
