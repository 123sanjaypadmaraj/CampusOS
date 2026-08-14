// tests/live/helpers/resolveServiceRoleKey.js
//
// Every live-test helper that needs a service_role connection reads
// VITE_SUPABASE_URL out of `.env` first, then needs the *matching*
// service_role key -- production and staging each have their own, and
// mixing them is a hard 401 (Supabase validates the key against the
// project), not a silent cross-environment write, but it still breaks the
// suite. Centralized here instead of duplicated per helper. Keep in sync
// with scripts/env-target.mjs.

import fs from "node:fs";
import path from "node:path";

const PROD_PROJECT_REF = "dzjzjlylsfpmymkcavrq";

export function resolveServiceRoleKey(root, supabaseUrl) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const fileName = projectRef === PROD_PROJECT_REF ? ".service_role_key.local" : ".service_role_key.staging.local";
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${fileName} for project ${projectRef} -- see docs/ENVIRONMENTS.md`);
  }
  return fs.readFileSync(filePath, "utf8").trim();
}
