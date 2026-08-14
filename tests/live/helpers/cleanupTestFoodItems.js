// tests/live/helpers/cleanupTestFoodItems.js
//
// Deletes every food_items row whose name matches a marker prefix, via the
// service_role connection -- same pattern as seedVendorOrder.js's
// clearStaleTestOrders(). Deliberately NOT driven through the browser: a
// fresh Playwright browser context occasionally hits a transient auth
// hiccup on its very first request right after a seeded session loads (a
// momentary token-clock-skew 401 from Supabase, not an app bug), which can
// land the vendor menu on its ErrorState instead of the item grid. A
// UI-driven cleanup step silently sees "no items" in that case and skips
// the actual delete, leaving real rows behind in Udupi's live menu. Going
// straight to the DB with the service role key sidesteps that entirely and
// is deterministic regardless of what state the UI was left in.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { resolveServiceRoleKey } from "./resolveServiceRoleKey.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "..");

function readEnvVar(name) {
  return fs
    .readFileSync(path.join(root, ".env"), "utf8")
    .match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]
    ?.trim();
}

const SUPABASE_URL = readEnvVar("VITE_SUPABASE_URL");
const SERVICE_ROLE_KEY = resolveServiceRoleKey(root, SUPABASE_URL);

// namePrefix: e.g. "E2E Bulk Item" -- matches "E2E Bulk Item A ...", "E2E Bulk Item B ...".
export async function deleteTestFoodItemsByPrefix(namePrefix) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.from("food_items").delete().ilike("name", `${namePrefix}%`);
  if (error) throw new Error(`Failed to delete stale test food items ("${namePrefix}%"): ${error.message}`);
}
