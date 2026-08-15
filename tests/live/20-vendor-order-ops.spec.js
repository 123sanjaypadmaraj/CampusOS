// tests/live/20-vendor-order-ops.spec.js
//
// Verifies the vendor order-ops UI (priority / staff assignment / internal
// notes / kitchen-pickup queue split / CANCEL_REQUESTED confirm-or-resume /
// refund initiation, supabase/migrations/20260815001000_vendor_order_ops.sql)
// against the LIVE deployed staging app with a REAL Udupi vendor session.
// RPC-level authorization/state-machine correctness is already covered by
// scripts/live-check-vendor-order-ops.mjs (run separately, not via
// Playwright) -- this spec is about the actual UI wiring: does clicking the
// button really call the RPC and reflect the result back on screen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { seedRealSession } from './helpers/realSession.js';
import { seedFreshVendorTestOrder } from './helpers/seedVendorOrder.js';
import { resolveServiceRoleKey } from './helpers/resolveServiceRoleKey.js';

const UDUPI_VENDOR = 'udupi.canteen@nhce.edu.in';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
function readEnvVar(name) {
  return fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}
const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const admin = createClient(SUPABASE_URL, resolveServiceRoleKey(root, SUPABASE_URL), {
  auth: { autoRefreshToken: false, persistSession: false },
});

// seedFreshVendorTestOrder() mirrors record_payment_event()'s order-status
// forwarding directly (PAID -> RECEIVED) without going through the RPC
// itself, so it never creates a `payments` row -- fine for the order-queue
// specs it was built for, but request_refund() correctly requires a real
// captured payment to exist (you can't refund a payment that was never
// taken). Insert one here so the refund test reflects that real precondition
// instead of loosening the RPC to accommodate a test shortcut.
async function seedCapturedPayment(orderId, amount) {
  const { error } = await admin.from('payments').insert({
    order_id: orderId, gateway: 'razorpay', amount, currency: 'INR',
    gateway_order_id: `live-spec-order-ops-${orderId}`,
    gateway_payment_id: `live-spec-payment-${orderId}`,
    status: 'captured', signature_verified: true,
  });
  if (error) throw new Error(`Failed to seed a captured payment row: ${error.message}`);
}

test.describe.serial('Vendor order-ops depth', () => {
  let seededItemName;
  test.beforeAll(async () => {
    // Roster entries this spec adds ("E2E Staff <timestamp>") aren't touched
    // by seedFreshVendorTestOrder()'s own dedup (that only clears stale
    // orders) -- clear leftovers from a previous run so the roster count
    // assertions stay meaningful.
    const { data: udupi } = await admin.from('canteens').select('id').ilike('name', '%udupi%').limit(1).single();
    if (udupi) await admin.from('canteen_staff').delete().eq('canteen_id', udupi.id).like('name', 'E2E Staff %');
    ({ itemName: seededItemName } = await seedFreshVendorTestOrder());
  });

  test('Kitchen / Pickup / All tabs filter the queue', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');

    const orderCard = page.locator('.resource-row', { hasText: 'Live vendor-queue test order' }).first();
    await expect(orderCard).toBeVisible({ timeout: 15000 });

    // Fresh RECEIVED order belongs in Kitchen, not Pickup.
    await page.getByRole('button', { name: /^Kitchen/ }).click();
    await expect(orderCard).toBeVisible();
    await page.getByRole('button', { name: /^Pickup/ }).click();
    await expect(orderCard).toHaveCount(0);
    await page.getByRole('button', { name: /^All/ }).click();
    await expect(orderCard).toBeVisible();
  });

  test('vendor can set priority, assign staff, and add an internal note', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');

    // Add a staff member via the roster modal so the assignment dropdown has
    // something real to pick.
    await page.getByRole('button', { name: /^Staff/ }).click();
    const modal = page.locator('.feature-modal');
    await expect(modal).toBeVisible();
    const staffName = `E2E Staff ${Date.now()}`;
    await modal.getByPlaceholder('Staff member name').fill(staffName);
    await modal.getByRole('button', { name: /^Add$/ }).click();
    await expect(modal.getByText(staffName)).toBeVisible({ timeout: 10000 });
    await page.locator('.modal-close').click();
    await expect(modal).toBeHidden({ timeout: 5000 });

    const orderCard = page.locator('.resource-row', { hasText: 'Live vendor-queue test order' }).first();
    await expect(orderCard).toBeVisible({ timeout: 15000 });

    await orderCard.getByLabel('Priority').selectOption('urgent');
    await expect(orderCard.locator('.status-pill.priority-urgent')).toBeVisible({ timeout: 10000 });

    await orderCard.getByLabel('Assign to').selectOption(staffName);
    await expect(orderCard).toContainText(`Assigned to: ${staffName}`, { timeout: 10000 });

    await orderCard.getByRole('button', { name: /Add note/i }).click();
    await orderCard.locator('textarea').fill('E2E: double-check spice level');
    await orderCard.getByRole('button', { name: /^Save note$/ }).click();
    await expect(orderCard).toContainText('E2E: double-check spice level', { timeout: 10000 });
  });

  test('CANCEL_REQUESTED can be confirmed to CANCELLED from the queue', async ({ page, context }) => {
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');

    const orderCard = page.locator('.resource-row', { hasText: 'Live vendor-queue test order' }).first();
    await expect(orderCard).toBeVisible({ timeout: 15000 });

    await orderCard.getByRole('button', { name: /Accept/i }).click();
    await expect(orderCard).toContainText('ACCEPTED', { timeout: 10000 });

    await orderCard.getByRole('button', { name: /^Cancel$/i }).click();
    await expect(orderCard).toContainText('CANCEL_REQUESTED', { timeout: 10000 });

    // Was previously a dead end -- no button anywhere could move a
    // CANCEL_REQUESTED order forward. Confirm cancellation now works: the
    // now-terminal order drops out of the active queue (the success toast
    // itself auto-dismisses in ~2.4s -- too racy to assert on, see
    // 01-single-user-features.spec.js's note on the same pattern).
    await orderCard.getByRole('button', { name: /Confirm cancellation/i }).click();
    await expect(page.locator('.resource-row', { hasText: 'Live vendor-queue test order' })).toHaveCount(0, { timeout: 10000 });
  });

  test('refund can be initiated on a rejected, paid order from history', async ({ page, context }) => {
    // Fresh order for this test (the previous one consumed the seeded order).
    const { orderId } = await seedFreshVendorTestOrder();
    const { data: seededOrder } = await admin.from('orders').select('total').eq('id', orderId).single();
    await seedCapturedPayment(orderId, seededOrder.total);
    await seedRealSession(context, UDUPI_VENDOR);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-vendor-button').click();
    await page.waitForLoadState('networkidle');

    const orderCard = page.locator('.resource-row', { hasText: 'Live vendor-queue test order' }).first();
    await expect(orderCard).toBeVisible({ timeout: 15000 });

    page.once('dialog', (dialog) => dialog.accept('E2E: kitchen out of ingredients'));
    await orderCard.getByRole('button', { name: /Reject/i }).click();
    await expect(page.locator('.resource-row', { hasText: 'Live vendor-queue test order' })).toHaveCount(0, { timeout: 10000 });

    await page.getByRole('button', { name: /View recent history/i }).click();
    // The history view (unlike the active queue's OrderCard) doesn't render
    // order.notes, so the seeded marker text isn't there to match on --
    // scope by the presence of the refund button + REJECTED status instead.
    const rejectedRow = page.locator('.resource-row', { hasText: 'REJECTED' }).first();
    await expect(rejectedRow).toBeVisible({ timeout: 10000 });

    // Pin down a stable per-order locator (the order's short id) before
    // acting -- once the refund succeeds the row's status text changes away
    // from "REJECTED", so a locator still filtering on that text would stop
    // matching its own row.
    const orderIdMatch = (await rejectedRow.locator('b').innerText()).match(/#(\w{8})/);
    const orderIdSnippet = orderIdMatch?.[1];
    expect(orderIdSnippet).toBeTruthy();
    const historyRow = page.locator('.resource-row', { hasText: `#${orderIdSnippet}` }).first();

    const refundButton = historyRow.getByRole('button', { name: /Initiate refund/i });
    await expect(refundButton).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept('E2E refund reason'));
    await refundButton.click();

    // request_refund() itself always succeeds here (order flips to
    // REFUND_PENDING server-side) regardless of whether the follow-up
    // Razorpay call also succeeds -- staging has no RAZORPAY_KEY_ID/SECRET
    // configured yet (see docs/ENVIRONMENTS.md), so the gateway call is
    // expected to fail closed. Assert on the DB-driven pill, not toast
    // wording, since that's true either way and proves the button is really
    // wired to the real RPC, not a stub.
    await expect(historyRow.locator('.status-pill.low-stock', { hasText: 'Refund processing' })).toBeVisible({ timeout: 15000 });
  });
});
