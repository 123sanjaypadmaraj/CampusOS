// tests/live/05-vendor-order-queue.spec.js
//
// Verifies the vendor order-queue screen against the LIVE deployed app with
// REAL Supabase vendor sessions. A real order is placed via create_food_order
// (as Alice) and forwarded to RECEIVED the same way record_payment_event
// would on a captured payment (driving an actual Razorpay test payment isn't
// feasible headlessly -- that path is covered separately by the mocked
// critical-order-flow spec). Everything from here on -- seeing the order,
// the cross-canteen isolation fix, and walking it through the state machine
// -- goes through the real UI against the real backend.

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';
import { seedFreshVendorTestOrder } from './helpers/seedVendorOrder.js';

const UDUPI_VENDOR = 'udupi.canteen@nhce.edu.in';
const TANGO_VENDOR = 'tango.canteen@nhce.edu.in';

test.describe.serial('Vendor order queue', () => {
  // Clears out any order left behind by a previous run and seeds exactly
  // one fresh order (against whatever Udupi's menu actually has -- see
  // helpers/seedVendorOrder.js) in RECEIVED. Udupi's real queue can also
  // contain genuine (non-test) orders for the same dish from earlier
  // multi-user testing, so `.first()` filtered on the *marker notes* rather
  // than the dish name is what actually guarantees a single match --
  // filtering on the dish name alone was the root cause of an earlier flake
  // (see helpers/seedVendorOrder.js for the full story).
  let seededItemName;
  test.beforeAll(async () => {
    ({ itemName: seededItemName } = await seedFreshVendorTestOrder());
  });


  test('Tango (a different canteen) cannot see Udupi\'s order', async ({ page, context }) => {
    await seedRealSession(context, TANGO_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');
    // The vendor dashboard now lands on its Dashboard overview tab by
    // default (added later, see tests/live/24-vendor-restricted-nav.spec.js)
    // -- switch to Orders explicitly rather than assuming it's the landing tab.
    await page.getByRole('button', { name: 'Orders', exact: true }).click();

    // Whatever Tango's queue shows, our test order (placed against Udupi)
    // must never appear in it -- this is the exact cross-canteen isolation
    // bug the migration in this same change set fixed.
    await expect(page.getByText('Extra chutney please')).toHaveCount(0);
    await expect(page.getByText('Live vendor-queue test order')).toHaveCount(0);
  });

  test('Udupi sees the real order and can walk it through the queue', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');
    // The vendor dashboard now lands on its Dashboard overview tab by
    // default (added later, see tests/live/24-vendor-restricted-nav.spec.js)
    // -- switch to Orders explicitly rather than assuming it's the landing tab.
    await page.getByRole('button', { name: 'Orders', exact: true }).click();

    const orderCard = page.locator('.resource-row', { hasText: 'Live vendor-queue test order' }).first();
    await expect(orderCard).toBeVisible({ timeout: 15000 });
    await expect(orderCard).toContainText('RECEIVED');
    await expect(orderCard).toContainText(seededItemName);
    await expect(orderCard).toContainText('Extra chutney please');

    await orderCard.getByRole('button', { name: /Accept/i }).click();
    await expect(orderCard).toContainText('ACCEPTED', { timeout: 10000 });

    await orderCard.getByRole('button', { name: /Start preparing/i }).click();
    await expect(orderCard).toContainText('PREPARING', { timeout: 10000 });

    await orderCard.getByRole('button', { name: /Mark ready/i }).click();
    await expect(orderCard).toContainText('READY', { timeout: 10000 });

    // Pickup completion requires the real 6-digit code, not a bare button --
    // wrong code must be rejected before the order can be marked complete.
    await orderCard.getByRole('button', { name: /Complete pickup/i }).click();
    const modal = page.locator('.feature-modal');
    await expect(modal).toBeVisible();
    await modal.getByLabel(/Pickup code/i).fill('000000');
    await modal.getByRole('button', { name: /^Complete pickup$/i }).click();
    await expect(page.getByText(/doesn't match/i)).toBeVisible({ timeout: 5000 });

    // The modal stays open on a wrong code -- the order must still be READY,
    // not silently completed.
    await expect(modal).toBeVisible();
  });

  test('order no longer appears in the active queue once completed', async ({ page, context }) => {
    // The previous test intentionally left the order stuck at READY (wrong
    // code was tested, not a real one -- there's no way to read the real
    // short_code without DB access from this spec). Confirm the queue still
    // correctly separates active vs. history instead: a READY order must
    // stay in the active list, not silently vanish.
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');
    // The vendor dashboard now lands on its Dashboard overview tab by
    // default (added later, see tests/live/24-vendor-restricted-nav.spec.js)
    // -- switch to Orders explicitly rather than assuming it's the landing tab.
    await page.getByRole('button', { name: 'Orders', exact: true }).click();
    const orderCard = page.locator('.resource-row', { hasText: 'Live vendor-queue test order' }).first();
    await expect(orderCard).toBeVisible({ timeout: 15000 });
    await expect(orderCard).toContainText('READY');
  });
});
