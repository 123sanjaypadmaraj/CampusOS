// tests/live/21-store-variants-stock.spec.js
//
// Verifies the Campus Store stock-tracking / product-variant / analytics UI
// against the LIVE deployed staging app with REAL sessions (doc §28 gap-
// closing pass, supabase/migrations/20260815000900_campus_store_variants_
// stock_analytics.sql). The RPC/RLS/state-machine side of this is already
// covered exhaustively at the data layer by
// scripts/live-check-store-variants-stock.mjs (33/33 passing) -- this spec
// covers what only the browser can prove: the vendor's item/variant editor
// UI actually writes the right fields, the stock pill renders, the
// Analytics tab mounts without crashing, and a student can actually pick a
// variant and check out with it.

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
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);

const STORE_VENDOR = 'campusstore@nhce.edu.in';
const ALICE = 'e2e.alice@nhce.edu.in';
const ITEM_NAME = 'Live UI Variant Test Hoodie';

test.describe.serial('Campus Store: stock tracking + variants (UI)', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  test.beforeAll(async () => {
    await admin.from('store_items').delete().eq('name', ITEM_NAME);
  });

  test.afterAll(async () => {
    await admin.from('store_items').delete().eq('name', ITEM_NAME);
  });

  test('vendor: creating a stock-tracked item and adding variants works end-to-end in the UI', async ({ page, context }) => {
    await seedRealSession(context, STORE_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');

    // Ownership routing (VendorDashboard.jsx) should land directly on
    // StoreDashboard for this account -- Items tab, not Orders' default.
    await page.getByRole('button', { name: 'Items' }).click();

    await page.getByRole('button', { name: /Add item/i }).click();
    const itemModal = page.locator('.feature-modal');
    await expect(itemModal).toBeVisible();
    await itemModal.getByLabel('Name').fill(ITEM_NAME);
    await itemModal.getByLabel(/Price/).fill('599');
    await itemModal.locator('.toggle-row', { hasText: 'Track stock' }).locator('.toggle-switch').click();
    await itemModal.getByLabel('Stock quantity').fill('4');
    await itemModal.getByRole('button', { name: /Add item/i }).click();
    await expect(itemModal).toBeHidden({ timeout: 10000 });

    const row = page.locator('.resource-row', { hasText: ITEM_NAME });
    await expect(row).toBeVisible({ timeout: 15000 });
    // 4 <= the default low_stock_threshold (5), so this correctly renders as
    // "Low stock: 4" rather than a plain "Stock: 4" -- see stockLabel() in
    // StoreDashboard.jsx.
    await expect(row).toContainText('Low stock: 4');

    // Add two variants from the item's "Variants" button.
    await row.getByRole('button', { name: 'Variants' }).click();
    const variantModal = page.locator('.feature-modal', { hasText: 'Manage options' });
    await expect(variantModal).toBeVisible();

    await variantModal.getByRole('button', { name: /Add option/i }).click();
    // VariantForm's <Modal> nests inside VariantManager's own <Modal> in the
    // DOM (it's rendered as a child within the outer Modal's JSX tree), so
    // both match a bare `.feature-modal` with "Add option" text (the outer
    // one via its "+ Add option" button, the inner one via its own h2) --
    // .last() picks the innermost/topmost one, which is what's interactive.
    const variantForm = page.locator('.feature-modal', { hasText: 'Add option' }).last();
    await variantForm.getByLabel('Name').fill('Small');
    await variantForm.getByLabel(/Price/).fill('580');
    await variantForm.getByRole('button', { name: /Add option/i }).click();
    await expect(page.locator('.feature-modal', { hasText: 'Add option' })).toHaveCount(1, { timeout: 10000 });
    await expect(variantModal.locator('.resource-row', { hasText: 'Small' })).toBeVisible();

    await variantModal.getByRole('button', { name: /Add option/i }).click();
    const variantForm2 = page.locator('.feature-modal', { hasText: 'Add option' }).last();
    await variantForm2.getByLabel('Name').fill('Large');
    await variantForm2.getByLabel(/Price/).fill('620');
    await variantForm2.getByRole('button', { name: /Add option/i }).click();
    await expect(page.locator('.feature-modal', { hasText: 'Add option' })).toHaveCount(1, { timeout: 10000 });
    await expect(variantModal.locator('.resource-row', { hasText: 'Large' })).toBeVisible();

    await variantModal.locator('.modal-close').click();
    await expect(variantModal).toBeHidden({ timeout: 10000 });

    // Analytics tab mounts without crashing for a store owner.
    await page.getByRole('button', { name: 'Analytics' }).click();
    await expect(page.locator('.analytics-grid')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Revenue/i).first()).toBeVisible();
  });

  test('student: a variant item shows a size selector and checks out at the variant price', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // "Store" has no persistent bottom-nav tab -- it's only reachable via
    // the Home page's "Store" quick-action tile (see ActionTile in App.jsx).
    await page.locator('.action-tile', { hasText: 'Store' }).click();
    await page.waitForLoadState('networkidle');

    const card = page.locator('.product-card', { hasText: ITEM_NAME });
    await expect(card).toBeVisible({ timeout: 15000 });

    const select = card.locator('select');
    await expect(select).toBeVisible();
    await select.selectOption({ label: 'Large · ₹620' });
    await expect(card).toContainText('₹620');

    await card.getByRole('button', { name: /Add/i }).click();

    // Adding to cart is a local state update, no navigation -- the header's
    // cart button (and the floating cart bar) is already on this page.
    const cartButton = page.getByRole('button', { name: /Cart \(1\)/ }).first();
    await expect(cartButton).toBeVisible({ timeout: 10000 });
    await cartButton.click();

    const cartModal = page.locator('.feature-modal').filter({ hasText: 'CAMPUS STORE' });
    await expect(cartModal).toBeVisible();
    await expect(cartModal).toContainText(`${ITEM_NAME} (Large)`);
    await expect(cartModal).toContainText('₹620');

    await cartModal.getByRole('button', { name: /Continue to payment/i }).click();
    await expect(page.getByText(/Pickup code/i).first()).toBeVisible({ timeout: 15000 });
  });
});
