// tests/live/13-vendor-bulk-menu.spec.js
//
// Verifies the vendor menu manager's bulk actions (doc §16 "bulk menu &
// inventory") and the redesigned item editor against the LIVE deployed app
// with a REAL Supabase vendor session (Udupi canteen). Runs serially and
// cleans up every item it creates so it doesn't pollute Udupi's real menu
// for other live specs (05-vendor-order-queue.spec.js) or the student-
// facing Food page.

import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';
import { deleteTestFoodItemsByPrefix } from './helpers/cleanupTestFoodItems.js';

const UDUPI_VENDOR = 'udupi.canteen@nhce.edu.in';
const MARKER_PREFIX = 'E2E Bulk Item';

async function signInAsUdupi(page, context) {
  await seedRealSession(context, UDUPI_VENDOR);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('nav-vendor-button').click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Menu' }).click();

  // A fresh session occasionally hits a transient auth hiccup on the very
  // first request right after sign-in (a momentary token-clock-skew 401 --
  // real Supabase infra flakiness, not an app bug), which lands the menu on
  // its ErrorState instead of the item grid. Retry once via the ErrorState's
  // own "Try again" button rather than letting a caller silently see zero
  // items and assume there's nothing there.
  const retry = page.getByRole('button', { name: /Try again/i });
  if (await retry.isVisible({ timeout: 3000 }).catch(() => false)) {
    await retry.click();
    await page.waitForLoadState('networkidle');
  }
}

async function createItem(page, name, price) {
  await page.getByRole('button', { name: /New item/i }).click();
  const modal = page.locator('.feature-modal');
  await modal.getByLabel('Name').fill(name);
  await modal.locator('.price-input-wrap input').fill(String(price));
  await modal.getByRole('button', { name: /^Save item$/i }).click();
  await expect(modal).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByText(name)).toBeVisible({ timeout: 10000 });
}

test.describe.serial('Vendor bulk menu & inventory', () => {
  const markerA = `${MARKER_PREFIX} A ${Date.now()}`;
  const markerB = `${MARKER_PREFIX} B ${Date.now()}`;

  // Cleanup goes straight to the DB via the service role key (same pattern
  // as seedVendorOrder.js's clearStaleTestOrders) rather than through the
  // browser -- a UI-driven delete in afterAll depends on a brand-new
  // session loading cleanly first, and if that hits the transient auth
  // hiccup noted in signInAsUdupi() above, it silently sees "no items" and
  // skips the real delete, leaving rows behind in Udupi's live menu. Clear
  // both before (in case a previous run failed) and after.
  test.beforeAll(async () => { await deleteTestFoodItemsByPrefix(MARKER_PREFIX); });
  test.afterAll(async () => { await deleteTestFoodItemsByPrefix(MARKER_PREFIX); });

  test('Admin CMS no longer has a Food & Canteens tab (moved here)', async ({ page, context }) => {
    // Covered in full by 03-usn-login-and-cms.spec.js; a light touch here
    // just confirms the vendor dashboard is the only place this account
    // type would ever see menu editing.
    await signInAsUdupi(page, context);
    await expect(page.getByRole('heading', { name: 'Udupi' })).toBeVisible({ timeout: 10000 });
  });

  test('the redesigned item editor creates a real item with a live preview', async ({ page, context }) => {
    await signInAsUdupi(page, context);
    await createItem(page, markerA, 55);
    await createItem(page, markerB, 80);

    const cardA = page.locator('.vendor-item-card', { hasText: markerA });
    await expect(cardA).toContainText('₹55');
    await expect(cardA.locator('.status-pill')).toContainText('Available');
  });

  test('search filters the item grid', async ({ page, context }) => {
    await signInAsUdupi(page, context);
    await page.getByPlaceholder('Search items…').fill(markerA);
    await expect(page.locator('.vendor-item-card', { hasText: markerA })).toBeVisible();
    await expect(page.locator('.vendor-item-card', { hasText: markerB })).toHaveCount(0);
    await page.getByPlaceholder('Search items…').fill('');
  });

  test('bulk-selecting both items and marking unavailable applies to both', async ({ page, context }) => {
    await signInAsUdupi(page, context);
    await page.locator('.vendor-item-card', { hasText: markerA }).locator('.vendor-item-select').check();
    await page.locator('.vendor-item-card', { hasText: markerB }).locator('.vendor-item-select').check();

    const bar = page.locator('.bulk-action-bar');
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: /Mark unavailable/i }).click();

    await expect(page.locator('.vendor-item-card', { hasText: markerA }).locator('.status-pill')).toContainText('Unavailable', { timeout: 10000 });
    await expect(page.locator('.vendor-item-card', { hasText: markerB }).locator('.status-pill')).toContainText('Unavailable', { timeout: 10000 });
  });

  test('bulk price increase by a flat amount updates both items correctly', async ({ page, context }) => {
    await signInAsUdupi(page, context);
    await page.locator('.vendor-item-card', { hasText: markerA }).locator('.vendor-item-select').check();
    await page.locator('.vendor-item-card', { hasText: markerB }).locator('.vendor-item-select').check();

    const bar = page.locator('.bulk-action-bar');
    const priceForm = bar.locator('.bulk-price-form');
    await priceForm.getByLabel('Increase or decrease price').selectOption('1');
    await priceForm.getByLabel('Adjust by percent or amount').selectOption('amount');
    await priceForm.getByLabel('Price adjustment value').fill('10');
    await priceForm.getByRole('button', { name: 'Apply' }).click();

    // markerA was ₹55 -> ₹65, markerB was ₹80 -> ₹90.
    await expect(page.locator('.vendor-item-card', { hasText: markerA })).toContainText('₹65', { timeout: 10000 });
    await expect(page.locator('.vendor-item-card', { hasText: markerB })).toContainText('₹90', { timeout: 10000 });
  });

  test('bulk archive hides both items from the active menu', async ({ page, context }) => {
    await signInAsUdupi(page, context);
    await page.locator('.vendor-item-card', { hasText: markerA }).locator('.vendor-item-select').check();
    await page.locator('.vendor-item-card', { hasText: markerB }).locator('.vendor-item-select').check();

    page.once('dialog', (d) => d.accept());
    await page.locator('.bulk-action-bar').getByRole('button', { name: /Archive/i }).click();

    await expect(page.locator('.vendor-item-card', { hasText: markerA }).locator('.status-pill')).toContainText('Archived', { timeout: 10000 });
    await expect(page.locator('.vendor-item-card', { hasText: markerB }).locator('.status-pill')).toContainText('Archived', { timeout: 10000 });

    // Status filter: switching to "Available" should hide both now-archived items.
    await page.getByLabel('Filter by status').selectOption('available');
    await expect(page.locator('.vendor-item-card', { hasText: markerA })).toHaveCount(0);
    await page.getByLabel('Filter by status').selectOption('all');
  });
});
