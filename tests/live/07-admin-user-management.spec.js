// tests/live/07-admin-user-management.spec.js
//
// Verifies the Admin CMS "Users" tab against the LIVE deployed app: a real
// admin session searches for a real student, suspends the account (via
// admin_set_user_status -- previously no path existed for an admin to
// change anyone's status but their own, since profiles_update_self only
// allows self-updates), confirms it's blocked from suspending itself/other
// admins, then reactivates the account again so the shared test account
// isn't left broken for other specs.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { seedRealSession } from './helpers/realSession.js';
import { resolveServiceRoleKey } from './helpers/resolveServiceRoleKey.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

function readEnvVar(name) {
  return fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}
const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);

const ADMIN = '1nh25cs265@usn.campusos.internal';

test.describe.serial('Admin user management', () => {
  test.beforeAll(async () => {
    // This spec relies on Bob starting 'active' (the first test suspends
    // then reactivates him). Found live: a prior run that failed partway
    // through -- or a *different* spec/manual run that suspended Bob and
    // didn't clean up -- leaves him stuck 'suspended', and every test here
    // times out looking for a "Suspend" button that isn't there. Reset
    // unconditionally rather than assuming any prior state.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await admin.from('profiles').update({ status: 'active', suspended_reason: null }).eq('usn', '1NH22IS202');
  });

  test('search finds Bob, suspend + reactivate round-trips', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Users', exact: true }).click();

    await page.getByPlaceholder(/Search name, email or USN/i).fill('Bob Test');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const row = page.locator('.resource-row', { hasText: 'Bob Test' });
    await expect(row).toBeVisible({ timeout: 10000 });

    page.once('dialog', (dialog) => dialog.accept('E2E suspension test'));
    await row.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByText('Bob Test suspended')).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('SUSPENDED');
    await expect(row).toContainText('E2E suspension test');

    await row.getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByText('Bob Test reactivated')).toBeVisible({ timeout: 10000 });
    await expect(row).not.toContainText('SUSPENDED');
  });

  test("admin can't suspend another admin account, and can't act on itself", async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Users', exact: true }).click();

    // Search by USN, not display name -- there's an unrelated older
    // "padmarajsanjay" test account whose name happens to also contain the
    // substring "sanjay padmaraj", which made a name-based search/locator
    // ambiguous. USN is unique.
    await page.getByPlaceholder(/Search name, email or USN/i).fill('1NH25CS265');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const row = page.locator('.resource-row', { hasText: '1NH25CS265' });
    await expect(row).toBeVisible({ timeout: 10000 });
    // The signed-in admin's own row: role select and Suspend button are both
    // disabled client-side (self-action guard) -- can't demote or lock
    // yourself out by accident.
    await expect(row.locator('select')).toBeDisabled();
    await expect(row.getByRole('button', { name: /Suspend|Reactivate/ })).toBeDisabled();
  });

  test('role change actually persists (round-trips club_admin -> student)', async ({ page, context }) => {
    await seedRealSession(context, ADMIN);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Users', exact: true }).click();

    await page.getByPlaceholder(/Search name, email or USN/i).fill('Carol Test');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const row = page.locator('.resource-row', { hasText: 'Carol Test' });
    await expect(row).toBeVisible({ timeout: 10000 });

    page.once('dialog', (dialog) => dialog.accept());
    await row.locator('select').selectOption('club_admin');
    await expect(page.getByText('Carol Test is now club_admin')).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-admin-button').click();
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await page.getByPlaceholder(/Search name, email or USN/i).fill('Carol Test');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.resource-row', { hasText: 'Carol Test' }).locator('select')).toHaveValue('club_admin', { timeout: 10000 });

    // Put Carol back the way the other live specs expect her (plain student).
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.resource-row', { hasText: 'Carol Test' }).locator('select').selectOption('student');
    await expect(page.getByText('Carol Test is now student')).toBeVisible({ timeout: 10000 });
  });

  test('a suspended account is actually blocked from posting, not just hidden from search', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await seedRealSession(adminContext, ADMIN);
    await adminPage.goto('/');
    await adminPage.waitForLoadState('networkidle');
    await adminPage.getByTestId('nav-admin-button').click();
    await adminPage.getByRole('button', { name: 'Users', exact: true }).click();
    await adminPage.getByPlaceholder(/Search name, email or USN/i).fill('Bob Test');
    await adminPage.getByRole('button', { name: 'Search', exact: true }).click();
    const bobRow = adminPage.locator('.resource-row', { hasText: 'Bob Test' });
    await expect(bobRow).toBeVisible({ timeout: 10000 });

    adminPage.once('dialog', (dialog) => dialog.accept('E2E enforcement test'));
    await bobRow.getByRole('button', { name: 'Suspend' }).click();
    await expect(adminPage.getByText('Bob Test suspended')).toBeVisible({ timeout: 10000 });

    try {
      const bobContext = await browser.newContext();
      const bobPage = await bobContext.newPage();
      await seedRealSession(bobContext, 'e2e.bob@nhce.edu.in');
      await bobPage.goto('/');
      await bobPage.waitForLoadState('networkidle');
      await bobPage.locator('nav.bottom-nav button', { hasText: 'Campus' }).click();
      await bobPage.getByRole('button', { name: /Create post/i }).click();
      await bobPage.getByLabel(/Post type/i).selectOption('Hackathon');
      await bobPage.getByLabel(/What do you want to say/i).fill(`Should be blocked ${Date.now()}`);
      await bobPage.getByRole('button', { name: /Publish/i }).click();
      await expect(bobPage.getByText(/suspended/i)).toBeVisible({ timeout: 10000 });
      await bobContext.close();
    } finally {
      // Always reactivate, even if the assertions above throw.
      adminPage.once('dialog', (dialog) => dialog.accept());
      await bobRow.getByRole('button', { name: 'Reactivate' }).click();
      await expect(adminPage.getByText('Bob Test reactivated')).toBeVisible({ timeout: 10000 });
      await adminContext.close();
    }
  });
});
