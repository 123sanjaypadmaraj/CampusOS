// tests/live/15-lost-found.spec.js
//
// LostService used to fall back to 3 hardcoded fake items ("Black
// backpack", "Student ID card", "AirPods case") whenever a campus's real
// lost_found_items table was empty -- looked exactly like real reports, and
// "Claim" on one just showed an error toast ("Demo item -- add the
// production SQL migration first"). Verifies that's gone, that a real
// report propagates to another real user via realtime (no reload), that
// the claim -> admin-verify handover workflow actually resolves an item,
// and that the new Admin CMS "Lost & Found" tab can post an item on the
// college's behalf and have it show up live on the student side too.

import { test, expect } from '@playwright/test';
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

async function serviceFetch(pathname, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      Prefer: 'return=representation',
      ...options.headers,
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const ALICE = 'e2e.alice@nhce.edu.in';
const BOB = 'e2e.bob@nhce.edu.in';
const ADMIN = '1nh25cs265@usn.campusos.internal';

const FAKE_DEMO_STRINGS = ['Black backpack', 'Student ID card', 'AirPods case'];

async function openLostFound(page) {
  await page.locator('nav.bottom-nav button', { hasText: 'Services' }).click();
  await page.waitForLoadState('networkidle');
  await page.locator('.service-card', { hasText: 'Lost & Found' }).click();
  await page.waitForLoadState('networkidle');
}

test.describe.serial('Lost & Found', () => {
  const reportMarker = `E2E lost backpack ${Date.now()}`;
  const foundMarker = `E2E found item ${Date.now()}`;

  test.afterAll(async () => {
    // Clean up whatever this run created, regardless of which assertion
    // (if any) failed partway through.
    const stale = await serviceFetch(`/rest/v1/lost_found_items?select=id&or=(title.eq.${encodeURIComponent(reportMarker)},title.eq.${encodeURIComponent(foundMarker)})`);
    for (const item of stale || []) {
      await serviceFetch(`/rest/v1/lost_found_items?id=eq.${item.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
  });

  test('the fake hardcoded demo items are never shown, real or empty', async ({ page, context }) => {
    await seedRealSession(context, BOB);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openLostFound(page);

    for (const fake of FAKE_DEMO_STRINGS) {
      await expect(page.getByText(fake)).toHaveCount(0);
    }
  });

  test('Alice reports a lost item through the real form, Bob sees it live without reloading', async ({ browser }) => {
    const bobCtx = await browser.newContext();
    await seedRealSession(bobCtx, BOB);
    const bob = await bobCtx.newPage();
    await bob.goto('/');
    await bob.waitForLoadState('networkidle');
    await openLostFound(bob);
    // Bob stays on this page for the rest of the test -- no reload/re-nav.

    const aliceCtx = await browser.newContext();
    await seedRealSession(aliceCtx, ALICE);
    const alice = await aliceCtx.newPage();
    await alice.goto('/');
    await alice.waitForLoadState('networkidle');
    await openLostFound(alice);

    await alice.getByRole('button', { name: /Report an item/i }).click();
    await alice.getByRole('button', { name: 'I lost something' }).click();
    await alice.getByLabel('Item title').fill(reportMarker);
    await alice.getByLabel('Last seen location').fill('E2E Test Block');
    await alice.getByRole('button', { name: 'Submit report' }).click();
    await expect(alice.getByText('Lost item reported')).toBeVisible({ timeout: 10000 });

    await expect(bob.getByText(reportMarker)).toBeVisible({ timeout: 15000 });

    await aliceCtx.close();
    await bobCtx.close();
  });

  test('Bob claims it, admin verifies the handover, and it resolves', async ({ page, context }) => {
    await seedRealSession(context, BOB);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openLostFound(page);

    const row = page.locator('.resource-row', { hasText: reportMarker });
    await expect(row).toBeVisible({ timeout: 15000 });
    // The claim flow is a real modal form (proof textarea + optional photo
    // upload, LostFoundClaimModal), not a native window.prompt() -- was
    // driving a `dialog` handler that never fired against anything, so the
    // claim was never actually submitted and this hung waiting for a toast
    // that could never appear.
    await row.getByRole('button', { name: 'Claim' }).click();
    const claimModal = page.locator('.feature-modal');
    await claimModal.getByLabel(/How can you prove this is yours/i).fill('E2E proof: it has a keychain shaped like a cat');
    await claimModal.getByRole('button', { name: /Submit claim/i }).click();
    await expect(page.getByText('Claim submitted')).toBeVisible({ timeout: 10000 });
    // exact + scoped to <strong> -- the row's own <small> also contains the
    // substring "pending" ("Claim pending staff verification"), and
    // Playwright's getByText is case-insensitive by default.
    await expect(row.locator('strong', { hasText: 'Pending' })).toBeVisible({ timeout: 10000 });
  });

  test('admin sees the pending claim in the CMS and verifies the handover', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Lost & Found', exact: true }).click();
    await page.getByRole('button', { name: 'Pending verification', exact: true }).click();

    const row = page.locator('.resource-row', { hasText: reportMarker });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toContainText('Bob Test');
    await expect(row).toContainText('keychain shaped like a cat');

    await row.getByRole('button', { name: 'Verify & release' }).click();
    await expect(page.getByText('Handover verified')).toBeVisible({ timeout: 10000 });
    await expect(row).toHaveCount(0); // no longer pending once resolved
  });

  test('admin posts a found item on the college\'s behalf and it shows up live for a student', async ({ browser }) => {
    const bobCtx = await browser.newContext();
    await seedRealSession(bobCtx, BOB);
    const bob = await bobCtx.newPage();
    await bob.goto('/');
    await bob.waitForLoadState('networkidle');
    await openLostFound(bob);
    // Bob stays here -- realtime, not a reload, should surface the new item.

    const adminCtx = await browser.newContext();
    await seedRealSession(adminCtx, ADMIN);
    const admin = await adminCtx.newPage();
    await admin.goto('/');
    await admin.waitForLoadState('networkidle');
    await admin.getByTestId('nav-admin-button').click();
    await admin.waitForLoadState('networkidle');
    await admin.getByRole('button', { name: 'Lost & Found', exact: true }).click();

    await admin.getByRole('button', { name: 'Post an item' }).click();
    await admin.getByLabel('Title').fill(foundMarker);
    await admin.getByLabel('Location').fill('Security office');
    await admin.getByRole('button', { name: 'Post report' }).click();
    await expect(admin.getByText('Report posted')).toBeVisible({ timeout: 10000 });

    await expect(bob.getByText(foundMarker)).toBeVisible({ timeout: 15000 });

    await adminCtx.close();
    await bobCtx.close();
  });
});
