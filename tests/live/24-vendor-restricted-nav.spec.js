// tests/live/24-vendor-restricted-nav.spec.js
//
// Verifies the vendor-account nav restriction ("the vendor dashboard
// doesn't need any of the features about campus, events, services, connect,
// messages, all they need is the profile and a better dashboard") against
// the LIVE deployed staging app with a REAL Udupi vendor session -- and the
// new Dashboard overview tab that replaced landing straight on the order
// queue.

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';

const UDUPI_VENDOR = 'udupi.canteen@nhce.edu.in';

test.describe('Vendor account nav restriction + dashboard overview', () => {
  test('bottom nav shows only Dashboard + Profile, and lands on the Dashboard tab', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Only two nav buttons should exist at all for a vendor account.
    const navButtons = page.locator('nav.bottom-nav button');
    await expect(navButtons).toHaveCount(2);
    await expect(page.getByTestId('nav-vendor-button')).toBeVisible();
    await expect(page.getByTestId('nav-profile-button')).toBeVisible();
    for (const key of ['home', 'campus', 'events', 'services', 'socialize', 'messages']) {
      await expect(page.getByTestId(`nav-${key}-button`)).toHaveCount(0);
    }

    // The global search icon (indexes campus/events/services/etc content --
    // irrelevant to a vendor) is also hidden.
    await expect(page.getByTestId('global-search-button')).toHaveCount(0);

    // Lands directly on the vendor dashboard, on its new Dashboard tab (the
    // "Dashboard" label also appears on the bottom-nav button itself, so
    // scope to the in-page tab row to avoid a strict-mode ambiguity).
    await expect(page).toHaveURL(/\/vendor$/);
    const tabRow = page.locator('main .socialize-filter-row');
    await expect(tabRow.getByRole('button', { name: 'Dashboard' })).toHaveClass(/active/);
    await expect(page.getByText('Orders today')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Revenue today')).toBeVisible();
  });

  test('deep-linking into a student route (/events) bounces back to the vendor dashboard', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/events');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/vendor$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Udupi', exact: true })).toBeVisible();
  });

  test('quick-link cards on the Dashboard tab navigate to Orders/Menu/Analytics', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Orders today')).toBeVisible({ timeout: 15000 });

    const tabRow = page.locator('main .socialize-filter-row');
    await page.getByRole('button', { name: /Order queue/i }).click();
    await expect(tabRow.getByRole('button', { name: 'Orders' })).toHaveClass(/active/);

    await tabRow.getByRole('button', { name: 'Dashboard' }).click();
    await page.getByRole('button', { name: 'Edit items and stock' }).click();
    await expect(tabRow.getByRole('button', { name: 'Menu' })).toHaveClass(/active/);
  });
});
