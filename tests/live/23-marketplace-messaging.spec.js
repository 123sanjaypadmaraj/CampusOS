// tests/live/23-marketplace-messaging.spec.js
//
// Verifies the marketplace messaging gap-closing pass (block user, report
// conversation, attachments, seller/profile availability -- see
// supabase/migrations/20260815001500_marketplace_messaging_gaps.sql) against
// the LIVE deployed app, in a real browser. The RPC-level behaviour (block
// enforcement, storage RLS, report context) is already covered by
// scripts/live-check-marketplace-messaging.mjs; this spec exists to catch
// what that script can't -- real dialog handling (window.confirm/prompt),
// the actual browser File API upload path through uploadMessageAttachment(),
// and whether the new UI elements actually render/wire up correctly.

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
const BOB = 'e2e.bob@nhce.edu.in';

// A real, tiny (1x1) PNG -- small enough to inline, still a valid image the
// browser can decode into <img>, unlike an arbitrary byte string.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test.describe.serial('Marketplace messaging: block, report, attachments, availability', () => {
  let admin;
  let aliceId;
  let bobId;
  let convId;

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    aliceId = getTestUserId(ALICE);
    bobId = getTestUserId(BOB);

    // Clean slate from any prior run of this spec or the sibling live-check script.
    await admin.from('blocked_users').delete().eq('blocker_id', aliceId).eq('blocked_id', bobId);
    await admin.from('blocked_users').delete().eq('blocker_id', bobId).eq('blocked_id', aliceId);
    await admin.from('profiles').update({ availability_status: 'available', availability_message: null }).eq('id', bobId);

    // start_conversation/send_message key off auth.uid(), which the
    // service_role client doesn't have -- seed the thread via a real
    // signed-in call instead.
    const aliceClient = createClient(SUPABASE_URL, readEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY'));
    await aliceClient.auth.signInWithPassword({ email: ALICE, password: 'TestPass!2026Alice' });
    const { data: seededConv } = await aliceClient.rpc('start_conversation', { p_other_user: bobId, p_listing_id: null });
    convId = seededConv;
    await aliceClient.rpc('send_message', { p_conversation_id: convId, p_body: 'hello from the live spec', p_attachment_path: null });
  });

  test.afterAll(async () => {
    if (aliceId && bobId) {
      await admin.from('blocked_users').delete().eq('blocker_id', aliceId).eq('blocked_id', bobId);
      await admin.from('blocked_users').delete().eq('blocker_id', bobId).eq('blocked_id', aliceId);
    }
    if (bobId) await admin.from('profiles').update({ availability_status: 'available', availability_message: null }).eq('id', bobId);
  });

  test('Alice sees Bob is Away in the thread header (seller availability)', async ({ page, context }) => {
    await admin.from('profiles').update({ availability_status: 'away', availability_message: 'Back Monday' }).eq('id', bobId);

    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Messages' }).click();

    const thread = page.locator('.message-thread-row', { hasText: 'Bob Test' }).first();
    await expect(thread).toBeVisible({ timeout: 15000 });
    await thread.click();

    const chip = page.locator('.messages-thread-head .availability-chip.away');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Back Monday');
  });

  test('Alice sends a photo attachment and it renders inline', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Messages' }).click();
    await page.locator('.message-thread-row', { hasText: 'Bob Test' }).first().click();

    const sendResponse = page.waitForResponse((resp) => resp.url().includes('/rest/v1/rpc/send_message'));
    await page.locator('.messages-thread input[type="file"]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: TINY_PNG });
    await sendResponse;

    const image = page.locator('.message-bubble.mine .message-attachment-img').last();
    await expect(image).toBeVisible({ timeout: 15000 });
    // The <img> resolves a real signed URL async -- confirm it actually got one, not a broken/empty src.
    await expect(image).toHaveAttribute('src', /^https?:\/\//, { timeout: 15000 });
  });

  test('Alice reports the conversation and an admin sees it with the right context', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Messages' }).click();
    await page.locator('.message-thread-row', { hasText: 'Bob Test' }).first().click();

    page.once('dialog', (dialog) => dialog.accept('Live spec test report -- harassment'));
    const reportResponse = page.waitForResponse((resp) => resp.url().includes('/rest/v1/content_reports') && resp.request().method() === 'POST');
    await page.locator('.messages-thread-actions button', { hasText: 'Report' }).click();
    await reportResponse;

    const { data: report } = await admin
      .from('content_reports')
      .select('*')
      .eq('reporter_id', aliceId)
      .eq('target_type', 'conversation')
      .eq('target_id', convId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(report?.reason).toBe('Live spec test report -- harassment');

    await admin.from('content_reports').update({ status: 'dismissed', reviewed_by: aliceId, reviewed_at: new Date().toISOString() }).eq('id', report.id);
  });

  test('Bob blocks Alice from the thread header and the compose box locks; unblocking restores it', async ({ page, context }) => {
    await seedRealSession(context, BOB);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('nav.bottom-nav button', { hasText: 'Messages' }).click();
    await page.locator('.message-thread-row', { hasText: 'Alice Test' }).first().click();

    page.once('dialog', (dialog) => dialog.accept());
    const blockButton = page.locator('.messages-thread-actions button', { hasText: 'Block' });
    await blockButton.click();
    await expect(page.locator('.messages-thread-actions button', { hasText: 'Unblock' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.messages-compose.blocked')).toBeVisible();

    const { data: blockRow } = await admin.from('blocked_users').select('*').eq('blocker_id', bobId).eq('blocked_id', aliceId).maybeSingle();
    expect(blockRow).toBeTruthy();

    await page.locator('.messages-thread-actions button', { hasText: 'Unblock' }).click();
    await expect(page.locator('.messages-thread-actions button', { hasText: 'Block' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.messages-compose input[placeholder="Type a message…"]')).toBeVisible();
  });
});
