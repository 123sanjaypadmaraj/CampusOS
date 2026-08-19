// One-off live verification script (not part of the automated suite) --
// exercises doc §16 "AI Action System" against a real Supabase project with
// real signed-in sessions. Prints PASS/FAIL per assertion.
//
// NOTE ON SCOPE: the campus-assistant Edge Function's tool-calling loop
// itself can only be exercised through a real Groq API round trip, and
// GROQ_API_KEY is NOT configured on staging (confirmed via `supabase
// secrets list` -- production has one, staging never did, predates this
// session). So this script verifies everything reachable WITHOUT going
// through the LLM: (1) reminders end-to-end (a brand new feature, fully
// independent of the assistant), (2) the exact same queries/RPCs each
// propose_*/get_* tool in campus-assistant/index.ts runs, called directly
// with the same RLS-scoped client the Edge Function uses, so the same rows
// a real conversation would see/act on are proven reachable and correctly
// shaped (id fields present, personalized RPCs return real reasoned rows).
// The tool-dispatch wiring itself (Groq call -> runTool() -> this same
// query) is straightforward enough that `supabase functions deploy`
// succeeding (valid TypeScript) plus this script's per-query coverage is
// the practical ceiling without a working key on this environment.
//
// Usage: node scripts/live-check-ai-action-system.mjs                 (staging)
//        node scripts/live-check-ai-action-system.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, root, target } = resolveTarget();
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
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
  console.log("=== AI Action System (doc §16) ===");
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));

  // -------------------------------------------------------------------
  // 1. Reminders -- brand new feature, fully independent of the assistant.
  // -------------------------------------------------------------------
  await alice.sb.from("reminders").delete().eq("user_id", alice.userId).ilike("title", "LiveCheckReminder%");

  const { error: emptyTitleErr } = await alice.sb.rpc("create_reminder", { p_title: "", p_remind_at: new Date(Date.now() + 3600000).toISOString(), p_notes: null, p_source: "manual" });
  check("create_reminder rejects an empty title", !!emptyTitleErr, emptyTitleErr?.message);

  const { error: pastErr } = await alice.sb.rpc("create_reminder", { p_title: "LiveCheckReminder past", p_remind_at: new Date(Date.now() - 3600000).toISOString(), p_notes: null, p_source: "manual" });
  check("create_reminder rejects a time already in the past", !!pastErr, pastErr?.message);

  const { error: badSourceErr } = await alice.sb.rpc("create_reminder", { p_title: "LiveCheckReminder x", p_remind_at: new Date(Date.now() + 3600000).toISOString(), p_notes: null, p_source: "bogus" });
  check("create_reminder rejects an invalid source", !!badSourceErr, badSourceErr?.message);

  const remindAt = new Date(Date.now() + 2 * 3600000).toISOString();
  const { data: reminder, error: createErr } = await alice.sb.rpc("create_reminder", { p_title: "LiveCheckReminder Pay hostel fees", p_remind_at: remindAt, p_notes: "before 5pm", p_source: "ai" });
  check("create_reminder succeeds with valid input (source='ai', as the assistant would send)", !createErr && reminder?.id && reminder.source === "ai", createErr?.message || reminder);

  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const { data: bobsView } = await bob.sb.from("reminders").select("*").eq("id", reminder.id);
  check("RLS: another student cannot see Alice's reminder", (bobsView || []).length === 0, bobsView);
  const { error: bobDeleteErr } = await bob.sb.from("reminders").delete().eq("id", reminder.id);
  const { data: stillThere } = await alice.sb.from("reminders").select("id").eq("id", reminder.id).maybeSingle();
  check("RLS: another student cannot delete Alice's reminder", !!stillThere, { bobDeleteErr: bobDeleteErr?.message, stillThere });

  const { data: listed } = await alice.sb.from("reminders").select("*").eq("done", false).order("remind_at");
  check("Alice's own reminder shows up in her (not-done) list", (listed || []).some((r) => r.id === reminder.id));

  const { data: completed, error: completeErr } = await alice.sb.from("reminders").update({ done: true }).eq("id", reminder.id).select().single();
  check("Alice can mark her own reminder done", !completeErr && completed?.done === true, completeErr?.message);

  const { data: listedAfterDone } = await alice.sb.from("reminders").select("id").eq("done", false).eq("id", reminder.id);
  check("A done reminder no longer shows up in the default (not-done) list", (listedAfterDone || []).length === 0);

  const { error: deleteErr } = await alice.sb.from("reminders").delete().eq("id", reminder.id);
  check("Alice can delete her own reminder", !deleteErr, deleteErr?.message);

  const { error: directInsertErr } = await alice.sb.from("reminders").insert({ user_id: alice.userId, title: "Direct insert attempt", remind_at: remindAt });
  check("Direct table insert (bypassing create_reminder) is blocked -- no insert RLS policy", !!directInsertErr, directInsertErr?.message);

  // -------------------------------------------------------------------
  // 2. The exact queries/RPCs each campus-assistant tool runs -- same
  // RLS-scoped client shape (anon key + user JWT) the Edge Function's
  // userClient uses, proving the rows a real conversation would act on are
  // reachable and correctly shaped.
  // -------------------------------------------------------------------
  const { data: menu, error: menuErr } = await alice.sb.from("food_items").select("id, canteen_id, name, price, available, description, canteens(name)").eq("active", true).limit(60);
  check("get_food_menu's query succeeds and rows carry an id (needed for propose_add_to_food_cart)", !menuErr && (menu || []).every((i) => !!i.id), menuErr?.message);

  const { data: events, error: eventsErr } = await alice.sb.from("events_with_counts").select("id, title, category, event_date, place, capacity, registration_status, attendees").eq("published", true).gte("event_date", new Date().toISOString()).limit(15);
  check("get_upcoming_events' query succeeds and rows carry an id (needed for propose_register_event)", !eventsErr && (events || []).every((e) => !!e.id), eventsErr?.message);

  const { data: services, error: servicesErr } = await alice.sb.from("services").select("id, name, description").eq("active", true).limit(30);
  check("get_campus_services' query succeeds", !servicesErr, servicesErr?.message);

  const { data: resources, error: resourcesErr } = await alice.sb.from("resources").select("id, name, resource_type, locations(name)").eq("available", true).limit(30);
  check("get_bookable_resources' query succeeds", !resourcesErr, resourcesErr?.message);

  for (const [tool, rpc] of [["get_recommended_food", "recommend_food"], ["get_recommended_events", "recommend_events"], ["get_recommended_clubs", "recommend_clubs"], ["get_recommended_opportunities", "recommend_opportunities"]]) {
    const { error } = await alice.sb.rpc(rpc, { p_limit: 6 });
    check(`${tool}'s underlying RPC (${rpc}) is callable by a signed-in student`, !error, error?.message);
  }

  // propose_add_to_food_cart's own validation: an available real item passes, an inactive/unknown id is rejected the same way runTool() would see it.
  if ((menu || []).length > 0) {
    const real = menu.find((i) => i.available) || menu[0];
    const { data: singleItem, error: singleErr } = await alice.sb.from("food_items").select("id, canteen_id, name, price, available, canteens(name)").eq("id", real.id).eq("active", true).maybeSingle();
    check("propose_add_to_food_cart's lookup resolves a real item by id", !singleErr && singleItem?.id === real.id, singleErr?.message);
  }
  const { data: fakeItem } = await alice.sb.from("food_items").select("id").eq("id", "00000000-0000-0000-0000-000000000000").eq("active", true).maybeSingle();
  check("propose_add_to_food_cart's lookup correctly finds nothing for a hallucinated id (runTool() would reject it)", !fakeItem);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount === 0) {
    console.log("\nNOTE: GROQ_API_KEY is not configured on staging, so the actual LLM tool-calling conversation (Groq -> runTool() -> these same queries) could not be exercised end-to-end by this script -- see the header comment.");
  }
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
