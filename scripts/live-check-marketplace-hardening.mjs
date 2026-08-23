// One-off live verification script (not part of the automated suite) --
// exercises supabase/migrations/20260818000700_marketplace_hardening.sql
// directly against a real Supabase project using real signed-in sessions.
// Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-marketplace-hardening.mjs                 (staging)
//        node scripts/live-check-marketplace-hardening.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, root, target } = resolveTarget();

// Admin's password isn't a fixed constant either -- see setup-admin-account.mjs's
// header for why (an earlier version hardcoded adminPassword() here; compromised).
const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
function adminPassword() {
  const p = path.join(root, "scripts", adminCredsFile);
  if (!fs.existsSync(p)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first (the account already exists, so a plain run won't write this file).`);
  return JSON.parse(fs.readFileSync(p, "utf8")).password;
}

// e2e.alice/bob/carol no longer have fixed literal passwords (2026-08-18
// credential-rotation incident, see SECURITY.md) -- scripts/setup-test-
// users.mjs is the one place that mints/persists them now, into this
// gitignored file. Read from there instead of hardcoding a stale literal
// (same fix already applied to live-check-food-hardening.mjs etc.).
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

const createdListingIds = [];
const scratchTerm = `livechecktoken${Date.now()}`;

async function main() {
  console.log("=== Marketplace hardening pass ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));

  const baseListing = { seller_id: alice.userId, title: "", description: "", category: "Other", price: 100, condition: "Used", location: "Campus" };
  async function insertListing(overrides) {
    return alice.sb.from("marketplace_listings").insert({ ...baseListing, ...overrides }).select().single();
  }

  // --- 1. Prohibited-item text screening ---
  const { error: gunErr } = await insertListing({ title: `LiveCheck ${randomUUID()} pistol for sale`, description: "cheap" });
  check("a listing whose TITLE mentions a seeded prohibited term is rejected", !!gunErr && /PROHIBITED_ITEM/.test(gunErr.message), gunErr?.message);

  const { error: gunDescErr } = await insertListing({ title: `LiveCheck ${randomUUID()} totally normal item`, description: "comes with free weed, ask seller" });
  check("a listing whose DESCRIPTION mentions a seeded prohibited term is rejected", !!gunDescErr && /PROHIBITED_ITEM/.test(gunDescErr.message), gunDescErr?.message);

  // --- 2. Profanity screening (existing banned_words list, now also wired to listings) ---
  const { error: profanityErr } = await insertListing({ title: `LiveCheck ${randomUUID()} bullshit item`, description: "n/a" });
  check("a listing containing a banned word is rejected", !!profanityErr && /PROFANITY_DETECTED/.test(profanityErr.message), profanityErr?.message);

  // --- 3. Admin can manage the prohibited-term list at runtime ---
  const { error: addTermErr } = await admin.sb.rpc("admin_add_prohibited_term", { p_term: scratchTerm });
  check("admin_add_prohibited_term succeeds for an admin", !addTermErr, addTermErr?.message);

  const { error: nonAdminAddErr } = await alice.sb.rpc("admin_add_prohibited_term", { p_term: "shouldnotwork" });
  check("admin_add_prohibited_term is rejected for a plain student", !!nonAdminAddErr, nonAdminAddErr?.message);

  const { error: scratchBlockedErr } = await insertListing({ title: `LiveCheck ${randomUUID()} ${scratchTerm} edition`, description: "n/a" });
  check("a freshly admin-added term is enforced immediately (no redeploy needed)", !!scratchBlockedErr && /PROHIBITED_ITEM/.test(scratchBlockedErr.message), scratchBlockedErr?.message);

  const { error: removeTermErr } = await admin.sb.rpc("admin_remove_prohibited_term", { p_term: scratchTerm });
  check("admin_remove_prohibited_term succeeds for an admin", !removeTermErr, removeTermErr?.message);

  const { data: afterRemove, error: afterRemoveErr } = await insertListing({ title: `LiveCheck ${randomUUID()} ${scratchTerm} edition ok now`, description: "n/a" });
  check("the same term no longer blocks a listing once removed", !afterRemoveErr && !!afterRemove?.id, afterRemoveErr?.message);
  if (afterRemove?.id) createdListingIds.push(afterRemove.id);

  // --- 4. Duplicate/spam detection ---
  const dupTitle = `LiveCheck duplicate probe ${randomUUID()}`;
  const { data: first, error: firstErr } = await insertListing({ title: dupTitle, description: "a genuinely unique description for this probe" });
  check("the first insert of a new listing succeeds", !firstErr && !!first?.id, firstErr?.message);
  if (first?.id) createdListingIds.push(first.id);

  const { error: dupErr } = await insertListing({ title: dupTitle, description: "a genuinely unique description for this probe" });
  check("re-posting the same title+description within 30 minutes is rejected as a duplicate", !!dupErr && /DUPLICATE_LISTING/.test(dupErr.message), dupErr?.message);

  // --- 5. Create-rate limiting -- rate_limit_hits has RLS enabled with NO
  // policies at all (20260814001100), so it's unreadable even to an admin
  // session signed in through plain auth (not service_role) -- can't assert
  // against it directly from here. Not exhausting the real 10/hour cap
  // either (would leave 10 junk listings behind); this reuses the exact
  // same audited check_rate_limit() every other rate-limited RPC in this
  // project already relies on, which is exercised on every successful
  // insert above.

  // --- 6. Edit listing + edit history ---
  const editableOriginalTitle = `LiveCheck editable ${randomUUID()}`;
  const { data: editable, error: editableErr } = await insertListing({ title: editableOriginalTitle, description: "original description" });
  check("setup: create a listing to edit", !editableErr && !!editable?.id, editableErr?.message);
  if (editable?.id) createdListingIds.push(editable.id);

  const { data: edited, error: editErr } = await alice.sb.rpc("update_marketplace_listing", {
    p_listing_id: editable?.id, p_title: "LiveCheck editable (renamed)", p_description: "updated description",
    p_category: "Electronics", p_price: 250, p_condition: "Like New", p_location: "Hostel Block A", p_image_urls: null,
  });
  check("the seller can edit their own active listing", !editErr && edited?.title === "LiveCheck editable (renamed)" && Number(edited?.price) === 250, editErr?.message || edited);

  const { data: historyRows, error: historyErr } = await alice.sb
    .from("marketplace_listing_edits").select("old_values, new_values").eq("listing_id", editable?.id);
  const historyRow = historyRows?.[0];
  check(
    "the edit is recorded in marketplace_listing_edits with an old/new snapshot",
    !historyErr && historyRow?.old_values?.title === editableOriginalTitle && historyRow?.new_values?.title === "LiveCheck editable (renamed)",
    historyErr?.message || historyRow
  );

  const { error: nonOwnerEditErr } = await bob.sb.rpc("update_marketplace_listing", {
    p_listing_id: editable?.id, p_title: "hijacked", p_description: "x", p_category: "Other", p_price: 1, p_condition: "Used", p_location: "x", p_image_urls: null,
  });
  check("a non-owner cannot edit someone else's listing", !!nonOwnerEditErr, nonOwnerEditErr?.message);

  const { data: bobHistoryRead } = await bob.sb.from("marketplace_listing_edits").select("id").eq("listing_id", editable?.id);
  check("a non-owner/non-moderator cannot read the edit history (RLS)", (bobHistoryRead?.length ?? 0) === 0, bobHistoryRead);

  // --- 7. Listing expiry + renewal ---
  const { data: expiring, error: expiringErr } = await insertListing({ title: `LiveCheck expiring ${randomUUID()}`, description: "about to expire" });
  check("setup: create a listing to expire", !expiringErr && !!expiring?.id, expiringErr?.message);
  if (expiring?.id) createdListingIds.push(expiring.id);

  await admin.sb.from("marketplace_listings").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", expiring?.id);
  const { data: expiredCount, error: expireRpcErr } = await alice.sb.rpc("expire_stale_listings");
  check("expire_stale_listings() runs for a plain authenticated user and returns a count", !expireRpcErr && typeof expiredCount === "number", expireRpcErr?.message || expiredCount);

  const { data: afterExpire } = await admin.sb.from("marketplace_listings").select("status").eq("id", expiring?.id).single();
  check("a listing past its expires_at is flipped to 'expired'", afterExpire?.status === "expired", afterExpire);

  const { error: nonOwnerRenewErr } = await bob.sb.rpc("renew_marketplace_listing", { p_listing_id: expiring?.id });
  check("a non-owner cannot renew someone else's expired listing", !!nonOwnerRenewErr, nonOwnerRenewErr?.message);

  const { data: renewed, error: renewErr } = await alice.sb.rpc("renew_marketplace_listing", { p_listing_id: expiring?.id });
  check("the seller can renew their own expired listing back to active", !renewErr && renewed?.status === "active" && new Date(renewed?.expires_at) > new Date(), renewErr?.message || renewed);

  // --- 8. Report + moderate listings ---
  const { data: reportable, error: reportableErr } = await insertListing({ title: `LiveCheck reportable ${randomUUID()}`, description: "will be reported" });
  check("setup: create a listing to report", !reportableErr && !!reportable?.id, reportableErr?.message);
  if (reportable?.id) createdListingIds.push(reportable.id);

  const { data: reportRow, error: reportErr } = await bob.sb
    .from("content_reports")
    .insert({ reporter_id: bob.userId, target_type: "marketplace_listing", target_id: reportable?.id, reason: "live-check test report" })
    .select().single();
  check("reportContent()'s insert path accepts target_type='marketplace_listing'", !reportErr && !!reportRow?.id, reportErr?.message);

  const { data: ctx, error: ctxErr } = await admin.sb.rpc("get_report_context", { p_target_type: "marketplace_listing", p_target_id: reportable?.id });
  const ctxRow = ctx?.[0];
  check("get_report_context resolves the seller as the report's owner", !ctxErr && ctxRow?.owner_id === alice.userId, ctxErr?.message || ctxRow);

  const { error: nonAdminModerateErr } = await bob.sb.rpc("moderate_content", { p_target_type: "marketplace_listing", p_target_id: reportable?.id, p_action: "remove", p_reason: "x" });
  check("moderate_content is rejected for a plain student", !!nonAdminModerateErr, nonAdminModerateErr?.message);

  const { error: removeErr } = await admin.sb.rpc("moderate_content", { p_target_type: "marketplace_listing", p_target_id: reportable?.id, p_action: "remove", p_reason: "test removal" });
  check("an admin can moderate_content('remove') a reported listing", !removeErr, removeErr?.message);

  // marketplace_read's own RLS (20260814001100) is `using (status <> 'removed')`
  // -- a plain authenticated session (even an admin's, since this is via
  // auth, not service_role) can no longer SELECT the row at all once it's
  // removed, same as the public feed. .approve below (which only matches
  // WHERE status='removed') succeeding is the real proof the UPDATE landed.
  const { data: afterRemoveRow, error: afterRemoveReadErr } = await admin.sb.from("marketplace_listings").select("status").eq("id", reportable?.id).maybeSingle();
  check("the listing becomes unreadable via plain RLS once removed (same policy the public feed uses)", !afterRemoveReadErr && afterRemoveRow === null, afterRemoveReadErr?.message || afterRemoveRow);

  const { error: approveErr } = await admin.sb.rpc("moderate_content", { p_target_type: "marketplace_listing", p_target_id: reportable?.id, p_action: "approve", p_reason: null });
  check("an admin can moderate_content('approve') to restore a wrongly-removed listing", !approveErr, approveErr?.message);

  const { data: afterApproveStatus } = await admin.sb.from("marketplace_listings").select("status").eq("id", reportable?.id).single();
  check("the listing's status is back to 'active' after an approve action", afterApproveStatus?.status === "active", afterApproveStatus);

  await admin.sb.from("content_reports").update({ status: "resolved", reviewed_by: admin.userId, reviewed_at: new Date().toISOString() }).eq("id", reportRow?.id);

  // --- cleanup ---
  for (const id of createdListingIds) {
    await admin.sb.from("marketplace_listing_edits").delete().eq("listing_id", id);
    await admin.sb.from("marketplace_listings").delete().eq("id", id);
  }
  try { await admin.sb.rpc("admin_remove_prohibited_term", { p_term: scratchTerm }); } catch { /* best-effort cleanup */ }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
