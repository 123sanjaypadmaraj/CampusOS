// tests/live/02-multi-user-realtime.spec.js
//
// Two/three REAL, separately-authenticated browser sessions open against the
// LIVE app at once, checking that actions by one user become visible to
// another without a manual refresh (Supabase Realtime subscriptions) --
// exactly what doc §14 asks for, and the thing no mocked test can exercise.

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
// Was hardcoded to .service_role_key.local (production only) -- silently
// sent production's service_role key against whatever project .env
// actually points at, which 401s on staging (the default) and surfaces as
// "(intermediate value) is not iterable" from destructuring the error
// response as if it were a data array. See resolveServiceRoleKey.js.
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

test.describe.configure({ mode: 'serial' });

test('Campus feed: a new post is visible to Bob without a manual reload', async ({ browser }) => {
  const bobCtx = await browser.newContext();
  await seedRealSession(bobCtx, BOB);
  const bob = await bobCtx.newPage();

  await bob.goto('/');
  await bob.waitForLoadState('networkidle');

  // Bob opens the Campus feed first and stays there -- no reload from here on.
  await bob.locator('nav.bottom-nav button', { hasText: 'Campus' }).click();
  await bob.waitForLoadState('networkidle');

  // The post is inserted via service role (bypassing RLS/the posts rate
  // limiter) rather than through Alice's UI, specifically so this test
  // verifies realtime propagation on its own -- not entangled with (and
  // not exhausting) the per-user posts rate limit doc §64 asks for, which
  // is covered separately.
  const [campus] = await serviceFetch('/rest/v1/campuses?select=id&slug=eq.nhce');
  const marker = `Realtime cross-user post ${Date.now()}`;
  const [aliceProfile] = await serviceFetch(`/rest/v1/profiles?select=id&usn=eq.1NH22CS201`);
  await serviceFetch('/rest/v1/posts', {
    method: 'POST',
    body: JSON.stringify({
      author_id: aliceProfile.id,
      campus_id: campus.id,
      type: 'Event',
      title: marker,
      content: 'Inserted via service role for a realtime-propagation check.',
    }),
  });

  // Bob's page never reloaded or re-navigated -- if this appears, the
  // subscribeToPosts() realtime subscription is genuinely working.
  await expect(bob.getByText(marker)).toBeVisible({ timeout: 15000 });

  await bobCtx.close();
});

test('Events: capacity + waitlist + promotion notification across two real users', async ({ browser }) => {
  // Seed a capacity-1 event directly (service role) so two students are
  // guaranteed to hit "confirmed" then "waitlisted" deterministically,
  // instead of hoping the demo-seeded events (capacity 150-500) are empty.
  const [campus] = await serviceFetch('/rest/v1/campuses?select=id&slug=eq.nhce');
  const eventTitle = `E2E Capacity Test ${Date.now()}`;
  const [event] = await serviceFetch('/rest/v1/events', {
    method: 'POST',
    body: JSON.stringify({
      campus_id: campus.id,
      title: eventTitle,
      category: 'Workshop',
      event_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      place: 'E2E Test Room',
      capacity: 1,
      published: true,
    }),
  });

  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  await seedRealSession(aliceCtx, ALICE);
  await seedRealSession(bobCtx, BOB);
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await alice.goto('/');
  await bob.goto('/');
  await Promise.all([alice.waitForLoadState('networkidle'), bob.waitForLoadState('networkidle')]);

  await alice.locator('nav.bottom-nav button', { hasText: 'Events' }).click();
  await bob.locator('nav.bottom-nav button', { hasText: 'Events' }).click();
  await Promise.all([alice.waitForLoadState('networkidle'), bob.waitForLoadState('networkidle')]);

  const aliceCard = alice.locator('.event-card', { hasText: eventTitle });
  const bobCard = bob.locator('.event-card', { hasText: eventTitle });
  await expect(aliceCard).toBeVisible({ timeout: 15000 });
  await expect(bobCard).toBeVisible({ timeout: 15000 });

  // Registering opens a confirmation dialog (name/USN/email prefilled,
  // phone entered there) instead of registering immediately.
  const confirmRegistration = async (p) => {
    await p.getByLabel('Phone number').fill('9876543210');
    await p.getByRole('button', { name: /Confirm registration/i }).click();
  };

  // Alice registers first -> confirmed (fills the only seat).
  await aliceCard.getByRole('button', { name: /Register/i }).click();
  await confirmRegistration(alice);
  await expect(aliceCard.getByRole('button', { name: /Cancel registration/i })).toBeVisible({ timeout: 10000 });

  // Bob registers second -> the event is full, so register_for_event()
  // should waitlist him instead of confirming him.
  await bobCard.getByRole('button', { name: /Register/i }).click();
  await confirmRegistration(bob);
  await expect(bob.getByText(/waitlist/i)).toBeVisible({ timeout: 10000 });

  // Alice cancels -> cancel_event_registration() promotes Bob and sends him
  // a notification (public.create_notification -> realtime). Bob's page is
  // never reloaded here.
  await aliceCard.getByRole('button', { name: /Cancel registration/i }).click();
  await expect(aliceCard.getByRole('button', { name: /Register/i })).toBeVisible({ timeout: 10000 });

  await bob.getByLabel('Notifications').click();
  await expect(bob.getByText(/off the waitlist/i).first()).toBeVisible({ timeout: 15000 });

  await aliceCtx.close();
  await bobCtx.close();

  // Cleanup: remove the test event via service role so repeated runs don't
  // pile up rows (registrations/waitlist/tickets cascade on delete).
  await serviceFetch(`/rest/v1/events?id=eq.${event.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
});

test('Three simultaneous sessions can all load the app independently', async ({ browser }) => {
  const emails = [ALICE, BOB, 'e2e.carol@nhce.edu.in'];
  const contexts = await Promise.all(emails.map(() => browser.newContext()));
  await Promise.all(contexts.map((ctx, i) => seedRealSession(ctx, emails[i])));
  const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));

  await Promise.all(pages.map((p) => p.goto('/')));
  await Promise.all(pages.map((p) => p.waitForLoadState('networkidle')));

  for (const p of pages) {
    await expect(p.getByTestId('sign-in-button')).toHaveCount(0);
  }

  await Promise.all(contexts.map((ctx) => ctx.close()));
});
