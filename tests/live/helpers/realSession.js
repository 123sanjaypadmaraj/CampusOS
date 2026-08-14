// tests/live/helpers/realSession.js
//
// Seeds a REAL, working Supabase session (created by
// scripts/setup-test-users.mjs against the live project) into a browser
// context before it navigates -- unlike tests/helpers/mockSupabase.js, no
// network calls are mocked here. Every request these tests make hits the
// real Supabase backend and is subject to real RLS.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');

function readEnvVar(name) {
  const contents = fs.readFileSync(path.join(root, '.env'), 'utf8');
  return contents.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
}

const SUPABASE_URL = readEnvVar('VITE_SUPABASE_URL');
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const SESSIONS = JSON.parse(fs.readFileSync(path.join(root, 'scripts', '.sessions.json'), 'utf8'));

export function listTestUsers() {
  return Object.entries(SESSIONS).map(([email, v]) => ({ email, label: v.label, userId: v.userId }));
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
