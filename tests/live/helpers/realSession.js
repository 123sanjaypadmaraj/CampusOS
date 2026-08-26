// tests/live/helpers/realSession.js
//
// Seeds a REAL, working Supabase session (created by
// scripts/setup-test-users.mjs against whichever project `.env` currently
// points at) into a browser context before it navigates -- unlike
// tests/helpers/mockSupabase.js, no network calls are mocked here. Every
// request these tests make hits the real Supabase backend and is subject to
// real RLS.
//
// Which project `.env` points at determines which sessions file we read --
// setup-test-users.mjs writes scripts/.sessions.staging.json for staging
// (the default) and scripts/.sessions.json for production (only when run
// with --env=production --yes-production). Keep those two file names and
// the ones below in sync -- see scripts/env-target.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');

const PROD_PROJECT_REF = 'dzjzjlylsfpmymkcavrq';

function readEnvVar(name) {
  const contents = fs.readFileSync(path.join(root, '.env'), 'utf8');
  return contents.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}

const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const sessionsFileName = PROJECT_REF === PROD_PROJECT_REF ? '.sessions.json' : '.sessions.staging.json';
const sessionsPath = path.join(root, 'scripts', sessionsFileName);
const SESSIONS = fs.existsSync(sessionsPath)
  ? JSON.parse(fs.readFileSync(sessionsPath, 'utf8'))
  : {};

export function listTestUsers() {
  return Object.entries(SESSIONS).map(([email, v]) => ({ email, label: v.label, userId: v.userId }));
}

// For specs that only need a test account's real user id (e.g. to scope a
// service_role cleanup query) without seeding a browser session for it --
// same env-aware sessions file this whole helper already resolves, instead
// of a spec reading scripts/.sessions.json directly (hardcoded to
// production; see docs/ENVIRONMENTS.md).
export function getTestUserId(email) {
  const entry = SESSIONS[email];
  if (!entry) throw new Error(`No session found for ${email} -- run scripts/setup-test-users.mjs first`);
  return entry.userId;
}

// For specs that need an authenticated supabase-js client of their own (not
// just a seeded browser context) -- e.g. to call an RPC that keys off
// auth.uid() from Node, like start_conversation/send_message. Returns the
// same real session seedRealSession() injects into the browser, so callers
// pass it to `supabase.auth.setSession(...)` instead of re-deriving one via
// signInWithPassword() with a literal password -- test accounts haven't had
// fixed literal passwords since the 2026-08-18 credential-rotation incident
// (see SECURITY.md), so a hardcoded password string here would just be
// silently wrong and fail sign-in.
export function getTestUserSession(email) {
  const entry = SESSIONS[email];
  if (!entry) throw new Error(`No session found for ${email} -- run scripts/setup-test-users.mjs first`);
  return entry.session;
}

export async function seedRealSession(context, email) {
  const entry = SESSIONS[email];
  if (!entry) throw new Error(`No session found for ${email} -- run scripts/setup-test-users.mjs first`);

  await context.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    { key: `sb-${PROJECT_REF}-auth-token`, session: entry.session }
  );

  return entry;
}
