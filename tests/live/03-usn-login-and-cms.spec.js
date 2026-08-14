// tests/live/03-usn-login-and-cms.spec.js
//
// Verifies the new Name+USN+Password login (both the requested Sanjay
// account and a fresh sign-up) and the Admin CMS, all against the live
// deployed app and real Supabase backend.

import { test, expect } from '@playwright/test';

test('USN login: sign in with the requested Sanjay Padmaraj account', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('sign-in-button').click();
  await page.getByRole('button', { name: 'USN & password' }).click();
  await page.getByLabel('USN').fill('1NH25CS265');
  await page.getByLabel('Password', { exact: true }).fill('Sanjay@123');
  await page.getByTestId('usn-login-button').click();

  await expect(page.getByTestId('sign-in-button')).toHaveCount(0, { timeout: 10000 });
  await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
  await expect(page.getByText('Sanjay Padmaraj', { exact: false }).first()).toBeVisible({ timeout: 10000 });
});

test('USN login: admin nav tab appears for the admin account', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sign-in-button').click();
  await page.getByRole('button', { name: 'USN & password' }).click();
  await page.getByLabel('USN').fill('1NH25CS265');
  await page.getByLabel('Password', { exact: true }).fill('Sanjay@123');
  await page.getByTestId('usn-login-button').click();
  await expect(page.getByTestId('sign-in-button')).toHaveCount(0, { timeout: 10000 });

  await expect(page.getByTestId('nav-admin-button')).toBeVisible({ timeout: 10000 });
});

test('USN sign-up: creates a brand-new account end-to-end', async ({ page }) => {
  const usn = `E2E${Date.now().toString().slice(-7)}`.slice(0, 10).padEnd(10, '0');
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('sign-in-button').click();
  await page.getByRole('button', { name: 'USN & password' }).click();
  await page.getByRole('button', { name: /New here\? Create an account/i }).click();
  await page.getByLabel('Full name').fill('E2E Signup Test');
  await page.getByLabel('USN').fill(usn);
  await page.getByLabel('Password', { exact: true }).fill('TestPass123');
  await page.getByLabel('Confirm password').fill('TestPass123');
  await page.getByTestId('usn-login-button').click();

  await expect(page.getByTestId('sign-in-button')).toHaveCount(0, { timeout: 15000 });
});

test('Admin CMS: create a food item and see it in the live menu', async ({ page }) => {
  const marker = `E2E CMS Item ${Date.now()}`;
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sign-in-button').click();
  await page.getByRole('button', { name: 'USN & password' }).click();
  await page.getByLabel('USN').fill('1NH25CS265');
  await page.getByLabel('Password', { exact: true }).fill('Sanjay@123');
  await page.getByTestId('usn-login-button').click();
  await expect(page.getByTestId('sign-in-button')).toHaveCount(0, { timeout: 10000 });

  await page.getByTestId('nav-admin-button').click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Admin CMS' })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /New item/i }).click();
  await page.getByLabel('Name').fill(marker);
  await page.getByLabel(/Price/i).fill('42');
  await page.getByRole('button', { name: /Save item/i }).click();
  await expect(page.getByText(marker)).toBeVisible({ timeout: 10000 });

  // Confirm it actually shows up in the real student-facing Food page too.
  await page.locator('nav.bottom-nav button', { hasText: 'Home' }).click();
  await page.getByRole('button', { name: /Food/i }).first().click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(marker)).toBeVisible({ timeout: 10000 });
});

test('Admin CMS: publish an announcement', async ({ page }) => {
  const marker = `E2E Announcement ${Date.now()}`;
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sign-in-button').click();
  await page.getByRole('button', { name: 'USN & password' }).click();
  await page.getByLabel('USN').fill('1NH25CS265');
  await page.getByLabel('Password', { exact: true }).fill('Sanjay@123');
  await page.getByTestId('usn-login-button').click();
  await expect(page.getByTestId('sign-in-button')).toHaveCount(0, { timeout: 10000 });

  await page.getByTestId('nav-admin-button').click();
  await page.getByRole('button', { name: 'Announcements' }).click();
  await page.getByRole('button', { name: /New announcement/i }).click();
  await page.getByLabel('Title').fill(marker);
  await page.getByLabel('Message').fill('E2E test announcement body.');
  await page.getByRole('button', { name: /Publish announcement/i }).click();
  await expect(page.getByText(marker)).toBeVisible({ timeout: 10000 });
});

test('Admin CMS: create an event and a club', async ({ page }) => {
  const eventMarker = `E2E CMS Event ${Date.now()}`;
  const clubMarker = `E2E CMS Club ${Date.now()}`;
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sign-in-button').click();
  await page.getByRole('button', { name: 'USN & password' }).click();
  await page.getByLabel('USN').fill('1NH25CS265');
  await page.getByLabel('Password', { exact: true }).fill('Sanjay@123');
  await page.getByTestId('usn-login-button').click();
  await expect(page.getByTestId('sign-in-button')).toHaveCount(0, { timeout: 10000 });

  await page.getByTestId('nav-admin-button').click();
  await page.getByRole('button', { name: 'Events & Clubs' }).click();

  await page.getByRole('button', { name: /New event/i }).click();
  await page.getByLabel('Title').fill(eventMarker);
  const future = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 16);
  await page.getByLabel(/Date & time/i).fill(future);
  await page.getByRole('button', { name: /Save event/i }).click();
  await expect(page.getByText(eventMarker)).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: 'Clubs', exact: true }).click();
  await page.getByRole('button', { name: /New club/i }).click();
  await page.getByLabel('Name').fill(clubMarker);
  await page.getByRole('button', { name: /Save club/i }).click();
  await expect(page.getByText(clubMarker)).toBeVisible({ timeout: 10000 });
});
