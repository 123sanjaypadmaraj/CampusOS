// tests/live/17-vendor-stock-tracking.spec.js
//
// Verifies vendor menu stock/low-stock tracking + CSV export against the
// LIVE deployed app with a REAL Udupi vendor session (doc §17-19,
// supabase/migrations/20260815000800_food_stock_tracking.sql). The order-
// lifecycle side of this feature (decrement on payment, restock on reject,
// auto-hide at zero) is covered end-to-end at the RPC level by
// scripts/live-check-food-stock.mjs -- driving a real payment capture
// headlessly through the UI isn't feasible (same reasoning as every other
// live spec here), so this spec covers what only the browser can prove:
// the editor UI actually writes track_stock/stock_quantity, the item card
// renders the right stock pill, and CSV export produces a real file.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedRealSession } from './helpers/realSession.js';
import { resolveServiceRoleKey } from './helpers/resolveServiceRoleKey.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

function readEnvVar(name) {
  return fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}

const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const ANON_KEY = readEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY');
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);

const UDUPI_VENDOR = 'udupi.canteen@nhce.edu.in';
const ITEM_NAME = 'Live UI Stock Test Item';

test.describe.serial('Vendor menu stock/low-stock tracking', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  test.beforeAll(async () => {
    // Clear anything left behind by a previous failed run.
    await admin.from('food_items').delete().eq('name', ITEM_NAME);
  });

  test.afterAll(async () => {
    await admin.from('food_items').delete().eq('name', ITEM_NAME);
  });

  test('creating an item with stock tracking on shows the low-stock pill on its card', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Menu' }).click();

    await page.getByRole('button', { name: /New item/i }).click();
    const modal = page.locator('.feature-modal');
    await expect(modal).toBeVisible();

    await modal.getByLabel('Name').fill(ITEM_NAME);
    await modal.locator('.price-input-wrap input').fill('25');
    // The toggle switch's real <input type="checkbox"> is visually hidden
    // (opacity:0/zero-size, styled via a sibling <span>) -- same pattern as
    // every other toggle in this form -- so click the visible <label> that
    // wraps it (native label-click-toggles-control behaviour) rather than
    // the input itself.
    await modal.locator('.toggle-row', { hasText: 'Track stock' }).locator('.toggle-switch').click();
    await modal.getByLabel('Stock quantity').fill('3');
    await modal.getByLabel('Low stock alert below').fill('5');

    await modal.getByRole('button', { name: /Save item/i }).click();
    await expect(modal).toBeHidden({ timeout: 10000 });

    const card = page.locator('.vendor-item-card', { hasText: ITEM_NAME });
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card).toContainText('Low stock: 3');

    // The low-stock summary banner above the grid should now mention it.
    await expect(page.locator('.stock-alert-banner')).toContainText(/running low/i);
  });

  test('bulk "set stock" to 0 flips the card to Out of stock', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Menu' }).click();

    const card = page.locator('.vendor-item-card', { hasText: ITEM_NAME });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator('.vendor-item-select').check();

    const bulkBar = page.locator('.bulk-action-bar');
    await expect(bulkBar).toBeVisible();
    await bulkBar.getByPlaceholder('Set stock').fill('0');
    await bulkBar.getByRole('button', { name: 'Apply' }).last().click();

    await expect(card).toContainText('Out of stock', { timeout: 10000 });
    await expect(page.locator('.stock-alert-banner')).toContainText(/out of stock/i);
  });

  test('exporting the menu produces a real CSV file listing the test item', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Menu' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export CSV/i }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');

    expect(csv.split('\r\n')[0]).toContain('stock_quantity');
    expect(csv).toContain(ITEM_NAME);
  });
});
