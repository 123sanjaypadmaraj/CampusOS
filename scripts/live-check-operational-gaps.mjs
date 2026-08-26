// One-off live verification script (not part of the automated suite) --
// exercises supabase/migrations/20260819000300_vendor_manager_accounts.sql,
// 20260819000400_resource_management.sql, 20260819000500_lost_found_matching.sql,
// and 20260819000600_support_tickets.sql directly against a real Supabase
// project using real signed-in sessions. Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-operational-gaps.mjs                 (staging)
//        node scripts/live-check-operational-gaps.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget, runProjectSql } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target, projectRef } = resolveTarget();

// Admin's password isn't a fixed constant either -- see setup-admin-account.mjs's
// header for why (an earlier version hardcoded adminPassword() here; compromised).
const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
function adminPassword() {
  const p = path.join(root, "scripts", adminCredsFile);
  if (!fs.existsSync(p)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first (the account already exists, so a plain run won't write this file).`);
  return JSON.parse(fs.readFileSync(p, "utf8")).password;
}

// profiles.role is protected by a trigger (protect_profile_role,
// 20260814000100_extensions_and_core.sql) that raises unless
// campusos.allow_role_change is set for the session -- a plain PostgREST
// update (even via service_role) can't set a session-local GUC first, so
// this needs a real SQL connection. Same technique setup-facilities-
// account.mjs already uses.
function forceRole(userId, role) {
  runProjectSql(root, projectRef, `do $$ begin
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = '${role}' where id = '${userId}';
  end $$;`);
}

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

function client(key = ANON_KEY) {
  return createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

const svc = client(SERVICE_ROLE_KEY);
const suffix = Date.now();
const cleanup = { canteens: [], stores: [], resources: [], lostFound: [], tickets: [] };
let testUserIds = [];

async function main() {
  console.log(`=== Operational gaps pass (${target}) ===`);
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const carol = await signIn("e2e.carol@nhce.edu.in", e2ePassword("e2e.carol@nhce.edu.in"));
  testUserIds = [alice.userId, bob.userId, carol.userId];

  const { data: campus } = await svc.from("campuses").select("id").limit(1).single();
  const campusId = campus.id;

  // Reset alice/bob/carol back to 'student' before starting, in case a
  // previous failed run left them mid-promotion (add_*_staff_account
  // refuses to touch a non-student/vendor_staff role).
  for (const id of [alice.userId, bob.userId, carol.userId]) forceRole(id, "student");

  // =========================================================
  // PART A -- vendor manager accounts
  // =========================================================
  console.log("\n--- Vendor manager accounts ---");

  // --- Canteen: alice owns a fresh test canteen. Real provisioning
  // (admin_create_vendor) always sets role='vendor' alongside owner_id --
  // mirror that here since food.staff.manage/food.menu.write are role-level
  // permissions, not derived from owner_id alone.
  forceRole(alice.userId, "vendor");
  const { data: canteen } = await svc.from("canteens")
    .insert({ campus_id: campusId, owner_id: alice.userId, name: `LiveCheck Canteen ${suffix}`, active: true })
    .select().single();
  cleanup.canteens.push(canteen.id);

  const { error: addMgrErr } = await alice.sb.rpc("add_canteen_staff_account", { p_canteen_id: canteen.id, p_email: "e2e.bob@nhce.edu.in" });
  check("canteen owner can add a manager", !addMgrErr, addMgrErr?.message);

  const { data: bobRole } = await svc.from("profiles").select("role").eq("id", bob.userId).single();
  check("adding a manager promotes them to vendor_staff", bobRole?.role === "vendor_staff", bobRole);

  const { error: bobMenuErr } = await bob.sb.from("food_items")
    .insert({ canteen_id: canteen.id, name: `LiveCheck Item ${suffix}`, price: 50 });
  check("canteen manager can write to the menu (full owner-equivalent access)", !bobMenuErr, bobMenuErr?.message);

  const { data: bobHoursRows, error: bobHoursErr } = await bob.sb.from("canteens")
    .update({ name: `LiveCheck Canteen ${suffix} renamed` }).eq("id", canteen.id).select();
  check("canteen manager can edit the canteen record itself", !bobHoursErr && (bobHoursRows?.length ?? 0) === 1, bobHoursErr?.message || "0 rows affected (RLS silently blocked it)");

  const { error: bobAddsCarolErr } = await bob.sb.rpc("add_canteen_staff_account", { p_canteen_id: canteen.id, p_email: "e2e.carol@nhce.edu.in" });
  check("a manager (not just the owner) can add another manager", !bobAddsCarolErr, bobAddsCarolErr?.message);

  const { data: carolStaffRow } = await svc.from("canteen_staff_accounts").select("id").eq("canteen_id", canteen.id).eq("user_id", carol.userId).single();
  const { error: bobRemovesCarolErr } = await bob.sb.rpc("remove_canteen_staff_account", { p_staff_account_id: carolStaffRow.id });
  check("a manager can remove another manager", !bobRemovesCarolErr, bobRemovesCarolErr?.message);

  const { data: carolRoleAfter } = await svc.from("profiles").select("role").eq("id", carol.userId).single();
  check("removing carol's only manager row reverts her to student", carolRoleAfter?.role === "student", carolRoleAfter);

  const { data: bobStaffRow } = await svc.from("canteen_staff_accounts").select("id").eq("canteen_id", canteen.id).eq("user_id", bob.userId).single();
  await bob.sb.rpc("remove_canteen_staff_account", { p_staff_account_id: bobStaffRow.id }); // clean bob back up

  // --- Store: alice owns a fresh test store (already role='vendor' from
  // the canteen section above -- a real vendor account can own more than
  // one vendor entity, same as this pass's helpers assume). ---
  const { data: store } = await svc.from("stores")
    .insert({ campus_id: campusId, owner_id: alice.userId, name: `LiveCheck Store ${suffix}`, active: true })
    .select().single();
  cleanup.stores.push(store.id);

  const { error: storeAddErr } = await alice.sb.rpc("add_store_staff_account", { p_store_id: store.id, p_email: "e2e.bob@nhce.edu.in" });
  check("store owner can add a manager", !storeAddErr, storeAddErr?.message);

  const { error: storeItemErr } = await bob.sb.from("store_items")
    .insert({ store_id: store.id, name: `LiveCheck Product ${suffix}`, price: 20 });
  check("store manager can write to the item catalog", !storeItemErr, storeItemErr?.message);

  const { data: bobStoreStaffRow } = await svc.from("store_staff_accounts").select("id").eq("store_id", store.id).eq("user_id", bob.userId).single();
  await bob.sb.rpc("remove_store_staff_account", { p_staff_account_id: bobStoreStaffRow.id });
  const { data: bobRoleAfterStore } = await svc.from("profiles").select("role").eq("id", bob.userId).single();
  check("removing bob's only store manager row reverts him to student", bobRoleAfterStore?.role === "student", bobRoleAfterStore);

  // --- Print: alice becomes the print rate-card owner for this campus ---
  await svc.from("print_rate_card").update({ owner_id: alice.userId }).eq("campus_id", campusId);

  const { error: printAddErr } = await alice.sb.rpc("add_print_staff_account", { p_campus_id: campusId, p_email: "e2e.bob@nhce.edu.in" });
  check("print rate-card owner can add print-shop staff", !printAddErr, printAddErr?.message);

  const { error: printStatusErr } = await bob.sb.rpc("set_print_shop_status", { p_status: "maintenance", p_message: "LiveCheck" });
  check("print manager can set the shop's printer status", !printStatusErr, printStatusErr?.message);
  await bob.sb.rpc("set_print_shop_status", { p_status: "online", p_message: null });

  const { data: bobPrintStaffRow } = await svc.from("print_staff_accounts").select("id").eq("campus_id", campusId).eq("user_id", bob.userId).single();
  await bob.sb.rpc("remove_print_staff_account", { p_staff_account_id: bobPrintStaffRow.id });

  // A student who never held any manager row must NOT be able to touch any of this.
  const { error: carolMenuDenied } = await carol.sb.from("food_items").insert({ canteen_id: canteen.id, name: "should fail", price: 1 });
  check("a plain student cannot write to a canteen's menu", !!carolMenuDenied);

  // =========================================================
  // PART B -- resource catalog management
  // =========================================================
  console.log("\n--- Resource catalog management ---");

  const { data: newResource, error: resCreateErr } = await admin.sb.rpc("admin_upsert_resource", {
    p_id: null, p_campus_id: campusId, p_name: `LiveCheck Room ${suffix}`, p_resource_type: "room",
    p_location_id: null, p_capacity: 10, p_opening_hours: { open: "08:00", close: "20:00" },
    p_approval_required: false, p_buffer_minutes: 15, p_available: true,
  });
  check("admin can create a new resource", !resCreateErr && !!newResource, resCreateErr?.message);
  if (newResource) cleanup.resources.push(newResource.id);

  const { error: studentResErr } = await alice.sb.rpc("admin_upsert_resource", {
    p_id: null, p_campus_id: campusId, p_name: `should fail ${suffix}`, p_resource_type: "room",
    p_location_id: null, p_capacity: 1, p_opening_hours: {}, p_approval_required: false, p_buffer_minutes: 0, p_available: true,
  });
  check("a plain student cannot create a resource", !!studentResErr);

  const { data: listedResources } = await alice.sb.from("resources").select("id").eq("id", newResource?.id ?? "");
  check("the new resource is readable by any signed-in student (resources_read)", (listedResources?.length ?? 0) === 1);

  const { data: booking, error: bookingErr } = await alice.sb.rpc("create_booking", {
    p_resource_id: newResource.id, p_start_time: new Date(Date.now() + 3600_000).toISOString(),
    p_end_time: new Date(Date.now() + 7200_000).toISOString(), p_notes: "LiveCheck",
  });
  check("the new resource can actually be booked end-to-end", !bookingErr && !!booking, bookingErr?.message);

  const { error: deleteWithBookingErr } = await admin.sb.rpc("admin_delete_resource", { p_id: newResource.id });
  check("deleting a resource with a pending booking is refused", !!deleteWithBookingErr && /upcoming or pending/.test(deleteWithBookingErr.message), deleteWithBookingErr?.message);

  await svc.from("bookings").update({ status: "CANCELLED" }).eq("id", booking.id);
  const { error: deleteAfterCancelErr } = await admin.sb.rpc("admin_delete_resource", { p_id: newResource.id });
  check("deleting a resource with only cancelled bookings soft-deletes it", !deleteAfterCancelErr, deleteAfterCancelErr?.message);
  cleanup.resources = cleanup.resources.filter((id) => id !== newResource.id); // already handled

  // =========================================================
  // PART C -- lost & found matching
  // =========================================================
  console.log("\n--- Lost & found matching ---");

  const sharedTitle = `LiveCheck black wallet ${suffix}`;
  const { data: lostItem, error: lostErr } = await svc.from("lost_found_items").insert({
    campus_id: campusId, user_id: alice.userId, item_type: "lost", title: sharedTitle,
    description: "leather wallet with cards", category: "Wallet/Purse", location: "Library",
  }).select().single();
  check("lost report inserts cleanly (trigger doesn't break the insert)", !lostErr && !!lostItem, lostErr?.message);
  if (lostItem) cleanup.lostFound.push(lostItem.id);

  const { data: foundItem, error: foundErr } = await svc.from("lost_found_items").insert({
    campus_id: campusId, user_id: bob.userId, item_type: "found", title: sharedTitle,
    description: "leather wallet with cards, found near the library", category: "Wallet/Purse", location: "Library",
  }).select().single();
  check("found report inserts cleanly", !foundErr && !!foundItem, foundErr?.message);
  if (foundItem) cleanup.lostFound.push(foundItem.id);

  const { data: matches, error: matchErr } = await bob.sb.rpc("list_lost_found_matches", { p_item_id: foundItem.id });
  check("list_lost_found_matches finds the corresponding open lost report", !matchErr && matches?.some((m) => m.id === lostItem.id), matchErr?.message || matches);

  const { data: aliceNotifs } = await svc.from("notifications").select("id").eq("user_id", alice.userId).eq("action_id", lostItem.id).eq("action_type", "lost_found_item");
  check("the trigger notified alice her lost item might have a match", (aliceNotifs?.length ?? 0) > 0);

  const { data: bobNotifs } = await svc.from("notifications").select("id").eq("user_id", bob.userId).eq("action_id", foundItem.id).eq("action_type", "lost_found_item");
  check("the trigger notified bob his found item might have a match", (bobNotifs?.length ?? 0) > 0);

  // =========================================================
  // PART D -- support tickets
  // =========================================================
  console.log("\n--- Support tickets ---");

  const { data: ticket, error: ticketErr } = await alice.sb.rpc("create_support_ticket", {
    p_category: "technical", p_subject: `LiveCheck ${suffix}`, p_description: "The app crashed on checkout.", p_attachment_url: null,
  });
  check("a student can create a support ticket", !ticketErr && !!ticket, ticketErr?.message);
  if (ticket) cleanup.tickets.push(ticket.id);

  const { error: bobReadDenied } = await bob.sb.from("support_tickets").select("id").eq("id", ticket.id).single();
  check("a stranger cannot read someone else's ticket", !!bobReadDenied);

  const { data: adminTickets, error: adminListErr } = await admin.sb.from("support_tickets").select("id").eq("id", ticket.id);
  check("college_admin can see the ticket via support.manage/admin", !adminListErr && (adminTickets?.length ?? 0) === 1, adminListErr?.message);

  const { error: replyErr } = await admin.sb.rpc("add_support_ticket_message", { p_ticket_id: ticket.id, p_body: "Looking into it.", p_attachment_url: null });
  check("staff can reply to the ticket", !replyErr, replyErr?.message);

  const { data: afterReply } = await svc.from("support_tickets").select("status").eq("id", ticket.id).single();
  check("a staff reply auto-advances an open ticket to in_progress", afterReply?.status === "in_progress", afterReply);

  const { error: assignErr } = await admin.sb.rpc("assign_support_ticket", { p_ticket_id: ticket.id, p_staff_id: admin.userId });
  check("admin can assign the ticket", !assignErr, assignErr?.message);

  const { error: resolveErr } = await admin.sb.rpc("set_support_ticket_status", { p_ticket_id: ticket.id, p_status: "resolved" });
  check("admin can resolve the ticket", !resolveErr, resolveErr?.message);

  const { error: reopenErr } = await alice.sb.rpc("add_support_ticket_message", { p_ticket_id: ticket.id, p_body: "Still broken, please reopen.", p_attachment_url: null });
  check("a student reply on a resolved ticket succeeds", !reopenErr, reopenErr?.message);
  const { data: afterReopen } = await svc.from("support_tickets").select("status").eq("id", ticket.id).single();
  check("a student reply on a resolved ticket reopens it", afterReopen?.status === "open", afterReopen);

  // =========================================================
  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
}

async function cleanupAll(userIds) {
  console.log("\nCleaning up test data...");
  if (cleanup.tickets.length) await svc.from("support_tickets").delete().in("id", cleanup.tickets);
  if (cleanup.lostFound.length) await svc.from("lost_found_items").delete().in("id", cleanup.lostFound);
  if (cleanup.resources.length) await svc.from("resources").delete().in("id", cleanup.resources);
  await svc.from("resources").delete().ilike("name", `LiveCheck Room ${suffix}%`);
  if (cleanup.stores.length) await svc.from("stores").delete().in("id", cleanup.stores);
  if (cleanup.canteens.length) await svc.from("canteens").delete().in("id", cleanup.canteens);
  for (const id of userIds || []) forceRole(id, "student"); // leave e2e accounts as plain students for the next run
}

main()
  .catch((err) => {
    console.error("FATAL:", err);
    failCount++;
  })
  .finally(async () => {
    await cleanupAll(testUserIds);
    process.exit(failCount > 0 ? 1 : 0);
  });
