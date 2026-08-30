// tests/live/18-recommendations.spec.js
//
// Verifies the recommendation engine / dashboard personalization (doc §108)
// against the LIVE deployed app: a real signed-in student sees a real
// "Recommended for you" section on Home seeded from her own club membership
// (see supabase/migrations/20260815000600_profile_personalization_recommendations.sql),
// can dismiss a card ("not interested"), and can toggle personalization off
// from Profile -- the doc's explicit "avoid creepy behavior and provide
// controls" ask.

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

test.describe.serial('Recommended for you (dashboard personalization)', () => {
  let admin;
  let aliceId;
  let clubId;
  let eventId;

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    aliceId = getTestUserId(ALICE);

    // Real signal data: a club Alice belongs to, with a real upcoming event
    // under it -- the same shape recommend_events() reads (club membership).
    const { data: profile } = await admin.from('profiles').select('campus_id').eq('id', aliceId).single();
    const marker = `E2E Rec ${Date.now()}`;
    const { data: club } = await admin.from('clubs').insert({ campus_id: profile.campus_id, name: marker + ' Club', category: 'Technology' }).select().single();
    clubId = club.id;
    await admin.from('club_members').insert({ club_id: clubId, user_id: aliceId, role: 'member' });
    const { data: event } = await admin.from('events').insert({
      campus_id: profile.campus_id, club_id: clubId, organizer_id: aliceId, title: marker + ' Event', category: 'Technology',
      event_date: new Date(Date.now() + 3 * 86400000).toISOString(), published: true, registration_status: 'OPEN',
    }).select().single();
    eventId = event.id;

    await admin.from('profiles').update({ personalization_enabled: true }).eq('id', aliceId);
  });

  test.afterAll(async () => {
    if (eventId) await admin.from('events').delete().eq('id', eventId);
    if (clubId) {
      await admin.from('club_members').delete().eq('club_id', clubId);
      await admin.from('clubs').delete().eq('id', clubId);
    }
  });

  test('Alice sees a real, reasoned recommendation on Home and can dismiss it', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const section = page.locator('.recommended-section');
    await expect(section).toBeVisible({ timeout: 15000 });

    const eventCard = section.locator('.recommend-card', { hasText: new RegExp(`E2E Rec \\d+ Event`) });
    await expect(eventCard).toBeVisible();
    await expect(eventCard.locator('.recommend-reason')).toContainText(/you're in/i);

    // Dismiss it -- removal from the DOM is optimistic (local state, see
    // RecommendedForYou in App.jsx), the dismiss_recommendation() RPC call
    // that persists it fires async alongside -- wait for that response
    // rather than racing a DB read against it.
    const dismissResponse = page.waitForResponse((resp) => resp.url().includes('/rest/v1/rpc/dismiss_recommendation'));
    await eventCard.locator('.recommend-dismiss').click();
    await expect(section.locator('.recommend-card', { hasText: new RegExp(`E2E Rec \\d+ Event`) })).toHaveCount(0);
    await dismissResponse;

    const { data: dismissals } = await admin.from('recommendation_dismissals').select('*').eq('user_id', aliceId).eq('entity_type', 'event').eq('entity_id', eventId);
    expect(dismissals?.length).toBe(1);
  });

  test('Alice can turn personalization off from Profile', async ({ page, context }) => {
    await seedRealSession(context, ALICE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('nav.bottom-nav button', { hasText: 'Profile' }).click();
    const row = page.locator('.push-toggle-row', { hasText: 'Recommended for you' });
    await expect(row).toBeVisible();
    const toggle = row.locator('button.chip');
    await expect(toggle).toHaveText('On');

    await toggle.click();
    await expect(toggle).toHaveText('Off');

    const { data: profileAfter } = await admin.from('profiles').select('personalization_enabled').eq('id', aliceId).single();
    expect(profileAfter.personalization_enabled).toBe(false);

    // Restore -- other live specs assume personalization defaults on.
    await toggle.click();
    await expect(toggle).toHaveText('On');
  });
});
