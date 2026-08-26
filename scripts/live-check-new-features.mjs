// One-off live verification script (not part of the automated suite) --
// exercises messaging, global search and the digital campus pass directly
// against the production Supabase project using real signed-in sessions,
// the same way prior rounds of this codebase's live testing worked
// (scripts/setup-test-users.mjs). Prints PASS/FAIL per assertion; does not
// delete any of the accounts/messages it uses.
//
// Usage: node scripts/live-check-new-features.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function readEnvVar(name) {
  const contents = fs.readFileSync(path.join(root, ".env"), "utf8");
  const match = contents.match(new RegExp(`^${name}=(.+)$`, "m"));
  return match?.[1]?.trim();
}

// Prefer explicit overrides (this repo has had more than one concurrent
// session pointing the shared .env at different Supabase projects mid-run
// -- see docs/ROADMAP.md-adjacent memory) over silently trusting whatever
// .env currently says.
const SUPABASE_URL = process.env.LIVE_CHECK_SUPABASE_URL || readEnvVar("VITE_SUPABASE_URL");
const ANON_KEY = process.env.LIVE_CHECK_ANON_KEY || readEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY");

// e2e.alice/bob no longer have fixed literal passwords (2026-08-18
// credential-rotation incident, see SECURITY.md) -- read from the same
// gitignored file every other live-check script now reads from. This
// script doesn't go through env-target.mjs's resolveTarget(), so infer
// staging-vs-production from which SUPABASE_URL actually resolved instead.
const isProduction = SUPABASE_URL.includes("dzjzjlylsfpmymkcavrq");
const e2eCredsFile = isProduction
  ? ".e2e-credentials.local.json"
  : ".e2e-credentials.staging.local.json";
// Bug fix: this used to hardcode the PRODUCTION facilities-credentials
// filename regardless of target, so a default (staging) run signed in with
// prod's facilities.staff password against the staging project and failed
// with "Invalid login credentials" -- same class of bug live-check-campus-
// store.mjs already had fixed, this script never got the same fix.
const facilitiesCredsFile = isProduction
  ? ".facilities-credentials.local.json"
  : ".facilities-credentials.staging.local.json";
const facilitiesCreds = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", facilitiesCredsFile), "utf8")
);
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const e2ePassword = (email) => {
  const password = e2eCreds.find((r) => r.email === email)?.password;
  if (!password) throw new Error(`No password known for ${email} in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
  return password;
};

let passCount = 0;
let failCount = 0;
function check(label, cond, extra) {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}${extra ? " -- " + JSON.stringify(extra) : ""}`);
  }
}

function client() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

async function main() {
  console.log("=== Messaging ===");
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  console.log(`alice=${alice.userId} bob=${bob.userId}`);

  const marker = `live-check ${new Date().toISOString()}`;

  const { data: convId, error: startErr } = await alice.sb.rpc("start_conversation", { p_other_user: bob.userId });
  check("start_conversation (alice -> bob) succeeds", !startErr && !!convId, startErr);

  const { data: msg, error: sendErr } = await alice.sb.rpc("send_message", { p_conversation_id: convId, p_body: marker });
  check("send_message (alice) succeeds", !sendErr && msg?.body === marker, sendErr);

  const { data: bobConvs, error: bobListErr } = await bob.sb.rpc("list_conversations");
  const bobThread = bobConvs?.find((c) => c.conversation_id === convId);
  check("bob sees the conversation via list_conversations", !bobListErr && !!bobThread, bobListErr);
  check("bob sees an unread count > 0 for it", Number(bobThread?.unread_count) > 0, bobThread);
  check("bob sees the last message preview", bobThread?.last_message_body === marker, bobThread);

  const { data: bobUnread } = await bob.sb.rpc("get_unread_message_count");
  check("get_unread_message_count (bob) > 0", Number(bobUnread) > 0, bobUnread);

  const { error: readErr } = await bob.sb.rpc("mark_conversation_read", { p_conversation_id: convId });
  check("mark_conversation_read (bob) succeeds", !readErr, readErr);

  const { data: bobUnreadAfter } = await bob.sb.rpc("get_unread_message_count");
  check("unread count is 0 after marking read", Number(bobUnreadAfter) === 0, bobUnreadAfter);

  const { data: msgs, error: msgsErr } = await bob.sb
    .from("messages")
    .select("*")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });
  check("bob can read messages via RLS", !msgsErr && msgs?.some((m) => m.body === marker), msgsErr);

  // Suspended-recipient / self-message guardrails (no state to clean up).
  const { error: selfErr } = await alice.sb.rpc("start_conversation", { p_other_user: alice.userId });
  check("start_conversation rejects messaging yourself", !!selfErr, selfErr?.message);

  console.log("\n=== Global search ===");
  const { data: searchResults, error: searchErr } = await alice.sb.rpc("global_search", { p_query: "Bob", p_limit: 8 });
  check("global_search('Bob') succeeds", !searchErr, searchErr);
  check("global_search('Bob') finds the person Bob Test", (searchResults || []).some((r) => r.entity_type === "person" && r.title === "Bob Test"), searchResults);

  const { data: shortResults, error: shortErr } = await alice.sb.rpc("global_search", { p_query: "a" });
  check("global_search rejects a 1-char query (returns no rows, not an error)", !shortErr && (shortResults || []).length === 0, { shortErr, shortResults });

  console.log("\n=== Digital campus pass ===");
  const { data: passRows, error: mintErr } = await alice.sb.rpc("mint_campus_pass");
  const pass = Array.isArray(passRows) ? passRows[0] : passRows;
  check("mint_campus_pass succeeds", !mintErr && !!pass?.token, mintErr);
  check("minted pass has a ~90s expiry", pass?.expires_at && new Date(pass.expires_at).getTime() - Date.now() < 100000, pass?.expires_at);
  check("minted pass carries the holder's real name", pass?.holder_name === "Alice Test", pass);

  const { error: unauthorizedErr } = await bob.sb.rpc("verify_campus_pass", { p_token: pass?.token });
  check("verify_campus_pass rejects a non-staff caller", !!unauthorizedErr, unauthorizedErr?.message);

  const facilities = await signIn(facilitiesCreds.email, facilitiesCreds.password);

  const { data: verifyRows, error: verifyErr } = await facilities.sb.rpc("verify_campus_pass", { p_token: pass?.token });
  const verify = Array.isArray(verifyRows) ? verifyRows[0] : verifyRows;
  check("facilities staff can verify a fresh pass", !verifyErr && verify?.valid === true, { verifyErr, verify });
  check("verified pass reports the correct holder", verify?.holder_id === alice.userId && verify?.holder_name === "Alice Test", verify);

  const tampered = pass.token.slice(0, -2) + (pass.token.slice(-2) === "AA" ? "BB" : "AA");
  const { data: tamperedRows } = await facilities.sb.rpc("verify_campus_pass", { p_token: tampered });
  const tamperedResult = Array.isArray(tamperedRows) ? tamperedRows[0] : tamperedRows;
  check("a tampered token is rejected as invalid, not thrown as a 500", tamperedResult?.valid === false, tamperedResult);

  const { data: malformedRows } = await facilities.sb.rpc("verify_campus_pass", { p_token: "not-a-real-token" });
  const malformedResult = Array.isArray(malformedRows) ? malformedRows[0] : malformedRows;
  check("a malformed token is rejected as invalid, not thrown as a 500", malformedResult?.valid === false, malformedResult);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
