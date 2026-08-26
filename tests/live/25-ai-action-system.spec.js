// tests/live/25-ai-action-system.spec.js
//
// Verifies doc §16 "AI Action System" against the LIVE deployed staging
// app. The Reminders half is fully independent of the LLM and tested
// end-to-end here. The Campus AI chat page is checked for basic health
// (renders, doesn't crash, degrades to a real error message rather than a
// blank/broken page) -- staging has no GROQ_API_KEY configured (see
// scripts/live-check-ai-action-system.mjs's header comment), so a real
// conversation/action-proposal round trip can't be driven through this
// spec on this environment; that logic is covered at the query level by
// the live-check script instead.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedRealSession, getTestUserId } from './helpers/realSession.js';
import { resolveServiceRoleKey } from './helpers/resolveServiceRoleKey.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
function readEnvVar(name) {
  return fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}
const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);

const ALICE = 'e2e.alice@nhce.edu.in';

test.describe.serial('AI Action System: reminders + Campus AI page health', () => {
  let admin;
  let aliceId;

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    aliceId = getTestUserId(ALICE);
    await admin.from('reminders').delete().eq('user_id', aliceId).ilike('title', 'E2E Reminder%');
  });

  test.afterAll(async () => {
    if (aliceId) await admin.from('reminders').delete().eq('user_id', aliceId).ilike('title', 'E2E Reminder%');
  });

  test('a reminder shows on Home, can be marked done from the widget, and disappears', async ({ page, context }) => {
    const marker = `E2E Reminder ${Date.now()}`;
    // service-role has no auth.uid(), so create_reminder() (which requires
    // it) can't run as admin -- insert the row directly instead, matching
    // exactly what create_reminder() itself would have written.
    const { data: inserted, error } = await admin
      .from('reminders')
      .insert({ user_id: aliceId, title: marker, remind_at: new Date(Date.now() + 3 * 3600000).toISOString(), notes: 'via service role seed', source: 'manual' })
      .select()
      .single();
    expect(error).toBeFalsy();
    const reminderId = inserted.id;

    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const row = page.locator('.reminder-row', { hasText: marker });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toContainText('via service role seed');

    // complete() (App.jsx) removes the row from local state optimistically
    // -- the UI updates before setReminderDone()'s PATCH has actually
    // reached Postgres, and there's no toast/other visible confirmation on
    // success (only on failure) to wait on instead. Wait for the real PATCH
    // response so the DB check below isn't racing the network request.
    const patchResponse = page.waitForResponse((resp) =>
      resp.url().includes('/rest/v1/reminders') && resp.request().method() === 'PATCH'
    );
    await row.locator('.reminder-check').click();
    await expect(page.locator('.reminder-row', { hasText: marker })).toHaveCount(0, { timeout: 10000 });
    await patchResponse;

    const { data: afterComplete } = await admin.from('reminders').select('done').eq('id', reminderId).single();
    expect(afterComplete.done).toBe(true);
  });

  test('Campus AI page loads, shows the intro message and suggestions, and a real message attempt degrades to a clean error (no GROQ_API_KEY on staging) instead of crashing', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/ai');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.ai-page h1')).toHaveText('Campus AI');
    await expect(page.locator('.ai-message.ai').first()).toContainText(/real assistant/i);
    await expect(page.locator('.ai-suggestions button').first()).toBeVisible();

    const input = page.locator('.ai-input input');
    await input.fill('What is on the menu?');
    await page.locator('.ai-input button').click();

    // Either a real reply or a clean "not configured"/"unavailable" error
    // bubble -- what must NOT happen is the ErrorBoundary's crash screen.
    await expect(page.locator('.ai-message.ai').last()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('text=Something went wrong')).toHaveCount(0);
  });
});
