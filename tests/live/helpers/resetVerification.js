// tests/live/helpers/resetVerification.js
//
// Deletes any existing student_verifications row (and the storage object it
// points to) for a user before the verification spec runs, so re-running
// the suite always starts from "never submitted" instead of whatever a
// previous run left behind (verified/pending/rejected all render a
// different, non-"GET VERIFIED" control on Profile -- see App.jsx).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "..");

function readEnvVar(name) {
  return fs
    .readFileSync(path.join(root, ".env"), "utf8")
    .match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]
    ?.trim();
}

const SUPABASE_URL = readEnvVar("VITE_SUPABASE_URL");
const SERVICE_ROLE_KEY = fs.readFileSync(path.join(root, ".service_role_key.local"), "utf8").trim();

export async function resetVerificationFor(userId) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await admin
    .from("student_verifications")
    .select("document_path")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.document_path) {
    await admin.storage.from("documents").remove([existing.document_path]);
  }

  await admin.from("student_verifications").delete().eq("user_id", userId);
}
