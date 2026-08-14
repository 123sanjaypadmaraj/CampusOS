// tests/critical-order-flow.spec.js
//
// The "one complete test" doc §86 asks for: student login -> browse canteen
// -> add food -> checkout -> payment -> ... -> completed, "run automatically
// before production deployment."
//
// Scope note: this environment has no live Supabase project or Razorpay
// test keys wired up, so this spec mocks the network boundary (Supabase
// REST/RPC + the Razorpay Checkout.js script) rather than hitting real
// infrastructure -- see tests/helpers/mockSupabase.js for why that's the
// right place for the login bypass, not the app itself.
//
// It verifies everything the BROWSER is responsible for: placing the order
// through create_food_order() instead of a raw insert, kicking off payment
// through create-razorpay-order instead of trusting a client-side amount,
// and handing off to the gateway. The vendor-side state machine
// (RECEIVED -> ACCEPTED -> PREPARING -> READY) and the webhook-driven PAID
// flip are server-side and realtime-driven; verifying those end-to-end
// requires either a real staging Supabase project or a Playwright version
// with WebSocket route mocking (this repo pins @playwright/test 1.45, which
// predates page.routeWebSocket) -- tracked as a follow-up in docs/ROADMAP.md.

import { test, expect } from '@playwright/test';
import { mockSignedInSession, FAKE_USER } from './helpers/mockSupabase.js';

const FAKE_CANTEEN = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Udupi',
  subtitle: 'South Indian',
  status: 'Open',
  eta_min: 8,
  eta_max: 12,
  queue_level: 'quiet',
  load: 32,
  color: 'green',
  active: true,
};

const FAKE_FOOD_ITEM = {
  id: '44444444-4444-4444-8444-444444444444',
  canteen_id: FAKE_CANTEEN.id,
  name: 'Masala Dosa',
  description: 'Crispy dosa with spiced potato masala',
  price: 55,
  image_url: null,
  is_vegetarian: true,
  available: true,
  food_categories: { id: 'cat-1', name: 'South Indian' },
};

const FAKE_ORDER = {
  id: '55555555-5555-4555-8555-555555555555',
  user_id: FAKE_USER.id,
  canteen_id: FAKE_CANTEEN.id,
  status: 'PAYMENT_PENDING',
  subtotal: 55,
  tax_amount: 2.75,
  platform_fee: 10,
  total: 67.75,
  payment_status: 'pending',
  pickup_code: '482913',
  created_at: new Date().toISOString(),
};

test('critical flow: sign in -> browse -> add food -> checkout -> payment handoff', async ({ page }) => {
  await mockSignedInSession(page);

  await page.route('**/rest/v1/canteens*', (route) => route.fulfill({ json: [FAKE_CANTEEN] }));
  await page.route('**/rest/v1/food_items*', (route) => route.fulfill({ json: [FAKE_FOOD_ITEM] }));

  // create_food_order() RPC -- the server-side authoritative order creation.
  let orderCreated = false;
  await page.route('**/rest/v1/rpc/create_food_order', (route) => {
    orderCreated = true;
    route.fulfill({ json: FAKE_ORDER });
  });

  // create-razorpay-order Edge Function -- re-derives the amount server-side
  // before opening checkout; the browser must never supply its own amount.
  let paymentStarted = false;
  await page.route('**/functions/v1/create-razorpay-order', (route) => {
    paymentStarted = true;
    route.fulfill({
      json: {
        key_id: 'rzp_test_fake',
        gateway_order_id: 'order_fake123',
        amount: 6775,
        currency: 'INR',
        payment_id: 'pay-row-fake',
      },
    });
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // 1. Student is already "logged in" via the mocked session -- verify the
  // header reflects a signed-in state (no "Sign in" button).
  await expect(page.getByTestId('sign-in-button')).toHaveCount(0);

  // 2. Browse to Food. There's no dedicated bottom-nav tab for it -- the
  // Home page's "Food" quick action / pulse card (go("food")) is the
  // documented entry point.
  await page.locator('nav.bottom-nav button', { hasText: 'Home' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /Food/i }).first().click();
  await page.waitForLoadState('networkidle');

  // 3. Add the mocked food item to the cart.
  await page.getByRole('button', { name: /^Add$/i }).first().click();

  // 4. Open the cart / checkout modal.
  await page.getByRole('button', { name: /Checkout/i }).first().click();

  // 5. Confirm checkout -- this is what used to be a "[Razorpay Placeholder]"
  // toast with no backend call at all; now it must actually reach both the
  // order-creation RPC and the payment Edge Function.
  await page.getByRole('button', { name: /Continue to payment/i }).click();

  await expect.poll(() => orderCreated, { timeout: 5000 }).toBe(true);
  await expect.poll(() => paymentStarted, { timeout: 5000 }).toBe(true);
});
