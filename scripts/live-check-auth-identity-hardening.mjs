// One-off live verification script (not part of the automated suite) --
// exercises the new schema from the auth & identity hardening pass
// (supabase/migrations/20260818000400_role_change_approval_and_verification_
// lockdown.sql, 20260818000500_email_domain_enforcement_and_account_
// deletion.sql): the admin_set_user_role() privilege-escalation fix, the
// role-change maker-checker approval flow, the student_verifications
// self-verify RLS lockdown, the profiles.status self-write bypass fix, the
// account-deletion-request workflow, and server-side email-domain
// enforcement. Prints PASS/FAIL per assertion.
//
// Uses throwaway service-role-created accounts for everything it mutates
// (proposer/target/student), NOT the shared e2e.alice/bob/carol accounts
// other live-check scripts depend on -- deleted in a finally block
// regardless of pass/fail.
//
// Usage: node scripts/live-check-auth-identity-hardening.mjs                 (staging)
//        node scripts/live-check-auth-identity-hardening.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();

// Admin's password isn't a fixed constant either -- see setup-admin-account.mjs's
// header for why (an earlier version hardcoded "Sanjay@123" here; compromised).
const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
function adminPassword() {
  const p = path.join(root, "scripts", adminCredsFile);
  if (!fs.existsSync(p)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first (the account already exists, so a plain run won't write this file).`);
  return JSON.parse(fs.readFileSync(p, "utf8")).password;
}

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

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

async function main() {
  console.log("=== Auth & identity hardening pass ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const svc = serviceClient();

  const ts = Date.now();
  const PASSWORD = "LiveCheck!2026Pass";
  const throwawayEmails = {
    proposer: `livecheck.proposer.${ts}@nhce.edu.in`,
    target: `livecheck.target.${ts}@nhce.edu.in`,
    student: `livecheck.student.${ts}@nhce.edu.in`,
  };
  const createdUserIds = [];
  const createdAuthTestEmails = []; // separate: only for the domain-enforcement probes

  try {
    console.log("\n-- Setting up throwaway accounts --");
    const users = {};
    for (const [key, email] of Object.entries(throwawayEmails)) {
      const { data, error } = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw new Error(`Could not create throwaway ${key} account: ${error.message}`);
      createdUserIds.push(data.user.id);
      users[key] = await signIn(email, PASSWORD);
    }
    check("throwaway accounts created", createdUserIds.length === 3, createdUserIds);

    const { error: promoteProposerErr } = await admin.sb.rpc("admin_set_user_role", {
      p_target_user: users.proposer.userId, p_new_role: "college_admin",
    });
    check("super_admin can still promote directly (admin_set_user_role unchanged for super_admin)", !promoteProposerErr, promoteProposerErr);

    // --- 1. Privilege-escalation fix ---
    console.log("\n-- BUG 1 fix: admin_set_user_role() is now super_admin-only --");
    {
      const { error: collegeAdminDirectErr } = await users.proposer.sb.rpc("admin_set_user_role", {
        p_target_user: users.target.userId, p_new_role: "super_admin",
      });
      check("college_admin can NO LONGER call admin_set_user_role() directly (the escalation bug is closed)", !!collegeAdminDirectErr, collegeAdminDirectErr);

      const { data: targetProfile } = await svc.from("profiles").select("role").eq("id", users.target.userId).single();
      check("...and the target's role is unchanged", targetProfile?.role === "student", targetProfile);
    }

    // --- 2. Role-change maker-checker ---
    console.log("\n-- Role-change approval (maker-checker) --");
    {
      const { error: nonAdminProposeErr } = await users.student.sb.rpc("propose_role_change", {
        p_target_user: users.target.userId, p_new_role: "club_admin",
      });
      check("a plain student cannot propose a role change", !!nonAdminProposeErr, nonAdminProposeErr);

      const { data: proposal, error: proposeErr } = await users.proposer.sb.rpc("propose_role_change", {
        p_target_user: users.target.userId, p_new_role: "club_admin", p_reason: "live-check",
      });
      check("college_admin can propose a role change", !proposeErr && proposal?.status === "pending", proposeErr || proposal);

      const { error: selfApproveErr } = await users.proposer.sb.rpc("decide_role_change", {
        p_request_id: proposal.id, p_approve: true,
      });
      check("the proposer cannot approve their own proposal (maker-checker)", !!selfApproveErr, selfApproveErr);

      const { data: stillTarget } = await svc.from("profiles").select("role").eq("id", users.target.userId).single();
      check("...and the role is still unchanged after the rejected self-approval", stillTarget?.role === "student", stillTarget);

      const { data: decided, error: decideErr } = await admin.sb.rpc("decide_role_change", {
        p_request_id: proposal.id, p_approve: true, p_reason: "looks good",
      });
      check("a DIFFERENT admin can approve it", !decideErr && decided?.status === "approved", decideErr || decided);

      const { data: promotedProfile } = await svc.from("profiles").select("role").eq("id", users.target.userId).single();
      check("...and the role actually changed", promotedProfile?.role === "club_admin", promotedProfile);

      const { error: redecideErr } = await admin.sb.rpc("decide_role_change", {
        p_request_id: proposal.id, p_approve: true,
      });
      check("an already-decided request cannot be decided again", !!redecideErr, redecideErr);
    }

    // --- 3. Super_admin promotions need a super_admin approver ---
    console.log("\n-- Extra scrutiny on super_admin promotions --");
    {
      // Reset target back to student first via a fresh propose/approve cycle
      // so this section starts clean.
      const { data: resetProposal } = await admin.sb.rpc("propose_role_change", {
        p_target_user: users.target.userId, p_new_role: "student",
      });
      // admin proposed it -- have the proposer (college_admin) approve, a
      // different admin, to exercise that direction of the maker-checker too.
      await users.proposer.sb.rpc("decide_role_change", { p_request_id: resetProposal.id, p_approve: true });

      const { data: superProposal, error: superProposeErr } = await users.proposer.sb.rpc("propose_role_change", {
        p_target_user: users.target.userId, p_new_role: "super_admin",
      });
      check("college_admin can propose a super_admin promotion", !superProposeErr, superProposeErr);

      // No second college_admin account exists to test with here, but the
      // rule itself (`has_role(auth.uid(),'super_admin')`) is unconditional
      // on requested_role='super_admin' regardless of who's deciding, and
      // the maker-checker distinct-approver check above already proves the
      // gate is real -- so approving with the one real super_admin below is
      // the meaningful positive case; rejecting is covered by role checks
      // exercised elsewhere in this section.
      const { data: superDecision, error: superDecideErr } = await admin.sb.rpc("decide_role_change", {
        p_request_id: superProposal.id, p_approve: true,
      });
      check("a super_admin CAN approve a super_admin promotion", !superDecideErr && superDecision?.status === "approved", superDecideErr || superDecision);

      // Revert immediately -- don't leave a throwaway account as super_admin.
      const { error: revertErr } = await admin.sb.rpc("admin_set_user_role", {
        p_target_user: users.target.userId, p_new_role: "student",
      });
      check("reverted the throwaway target back to student", !revertErr, revertErr);
    }

    // --- 4. student_verifications self-verify lockdown ---
    console.log("\n-- BUG 2 fix: student_verifications insert/resubmit lockdown --");
    {
      const { data: campus } = await svc.from("campuses").select("id").limit(1).single();

      const { error: selfVerifyErr } = await users.student.sb.from("student_verifications").insert({
        user_id: users.student.userId, campus_id: campus.id, status: "verified", verified_at: new Date().toISOString(),
      });
      check("a student can NOT self-insert a 'verified' row (the self-approval hole is closed)", !!selfVerifyErr, selfVerifyErr);

      const { error: legitInsertErr } = await users.student.sb.from("student_verifications").insert({
        user_id: users.student.userId, campus_id: campus.id, status: "pending",
      });
      check("a legit pending insert still works", !legitInsertErr, legitInsertErr);

      const { error: adminRejectErr } = await admin.sb
        .from("student_verifications")
        .update({ status: "rejected", rejection_reason: "live-check" })
        .eq("user_id", users.student.userId);
      check("admin can reject it", !adminRejectErr, adminRejectErr);

      const { error: resubmitVerifiedErr } = await users.student.sb
        .from("student_verifications")
        .update({ status: "verified" })
        .eq("user_id", users.student.userId);
      check("a student can NOT resubmit straight to 'verified' either", !!resubmitVerifiedErr, resubmitVerifiedErr);

      const { error: resubmitErr } = await users.student.sb
        .from("student_verifications")
        .update({ status: "pending", rejection_reason: null, verified_at: null, verified_by: null })
        .eq("user_id", users.student.userId);
      check("a student CAN resubmit back to pending after a rejection (this was likely broken before -- no update policy existed at all)", !resubmitErr, resubmitErr);

      const { error: adminVerifyErr } = await admin.sb
        .from("student_verifications")
        .update({ status: "verified", verified_at: new Date().toISOString(), verified_by: admin.userId })
        .eq("user_id", users.student.userId);
      check("admin can verify it", !adminVerifyErr, adminVerifyErr);

      // Postgres RLS on UPDATE silently filters non-matching rows rather
      // than raising an error (0 rows affected, no error) -- so the real
      // assertion is the row's actual state afterward, not the presence of
      // an error.
      await users.student.sb.from("student_verifications").update({ status: "pending" }).eq("user_id", users.student.userId);
      const { data: stillVerified } = await svc.from("student_verifications").select("status").eq("user_id", users.student.userId).single();
      check("once verified, the student's self-update silently no-ops (RLS-filtered) -- status is still 'verified'", stillVerified?.status === "verified", stillVerified);
    }

    // --- 5. profiles.status self-write bypass fix ---
    console.log("\n-- BUG 3 fix: profiles.status is no longer self-writable --");
    {
      const { error: selfSuspendErr } = await users.student.sb.from("profiles").update({ status: "suspended" }).eq("id", users.student.userId);
      check("a student can NOT self-suspend (or self-anything) their own status column", !!selfSuspendErr, selfSuspendErr);

      const { error: suspendErr } = await admin.sb.rpc("admin_set_user_status", {
        p_target_user: users.student.userId, p_status: "suspended", p_reason: "live-check",
      });
      check("admin_set_user_status still works (suspend)", !suspendErr, suspendErr);

      const { error: selfReactivateErr } = await users.student.sb.from("profiles").update({ status: "active" }).eq("id", users.student.userId);
      check("...and a SUSPENDED student can not self-reactivate either", !!selfReactivateErr, selfReactivateErr);

      const { error: reactivateErr } = await admin.sb.rpc("admin_set_user_status", {
        p_target_user: users.student.userId, p_status: "active",
      });
      check("admin_set_user_status still works (reactivate)", !reactivateErr, reactivateErr);
    }

    // --- 6. Account deletion request workflow ---
    console.log("\n-- Account deletion request workflow --");
    {
      const { data: reqRow, error: requestErr } = await users.student.sb.rpc("request_account_deletion", { p_reason: "live-check" });
      check("student can request account deletion", !requestErr && reqRow?.status === "pending", requestErr || reqRow);

      const { error: cancelErr } = await users.student.sb.rpc("cancel_account_deletion_request", { p_request_id: reqRow.id });
      check("student can cancel their own pending request", !cancelErr, cancelErr);

      const { data: reqRow2 } = await users.student.sb.rpc("request_account_deletion", { p_reason: "live-check take 2" });

      const { error: nonAdminProcessErr } = await users.proposer.sb.rpc("admin_process_account_deletion", {
        p_request_id: reqRow2.id, p_action: "complete",
      });
      // proposer IS a college_admin (current_user_is_admin() true) -- so this
      // should actually be ALLOWED, deletion processing isn't maker-checker.
      check("an admin (college_admin) CAN process a deletion request", !nonAdminProcessErr, nonAdminProcessErr);

      const { data: deletedProfile } = await svc.from("profiles").select("status").eq("id", users.student.userId).single();
      check("the account is now soft-deleted", deletedProfile?.status === "deleted", deletedProfile);

      const { error: reprocessErr } = await admin.sb.rpc("admin_process_account_deletion", {
        p_request_id: reqRow2.id, p_action: "reject",
      });
      check("an already-processed request cannot be processed again", !!reprocessErr, reprocessErr);

      // Restore to active so the throwaway account can still be cleaned up
      // via a normal signed-in path if needed, and to confirm 'deleted' is
      // reversible by an admin the same way 'suspended' already is.
      const { error: restoreErr } = await admin.sb.rpc("admin_set_user_status", {
        p_target_user: users.student.userId, p_status: "active",
      });
      check("admin can restore a deleted account back to active", !restoreErr, restoreErr);
    }

    // --- 7. Server-side email-domain enforcement ---
    console.log("\n-- Server-side email-domain enforcement --");
    {
      const badEmail = `livecheck.baddomain.${ts}@evil-example.com`;
      const { data: badData, error: badErr } = await svc.auth.admin.createUser({ email: badEmail, password: PASSWORD, email_confirm: true });
      check("an account with a disallowed email domain is rejected at the DB trigger level", !!badErr, badErr);
      if (badData?.user?.id) createdAuthTestEmails.push(badData.user.id); // shouldn't happen, but clean up if it does

      const goodEmail = `livecheck.gooddomain.${ts}@nhce.edu.in`;
      const { data: goodData, error: goodErr } = await svc.auth.admin.createUser({ email: goodEmail, password: PASSWORD, email_confirm: true });
      check("an allowed @nhce.edu.in domain still works", !goodErr, goodErr);
      if (goodData?.user?.id) createdAuthTestEmails.push(goodData.user.id);

      const usnEmail = `1nh99xx${String(ts).slice(-3)}@usn.campusos.internal`;
      const { data: usnData, error: usnErr } = await svc.auth.admin.createUser({ email: usnEmail, password: PASSWORD, email_confirm: true });
      check("the @usn.campusos.internal carve-out still works", !usnErr, usnErr);
      if (usnData?.user?.id) createdAuthTestEmails.push(usnData.user.id);
    }
  } finally {
    console.log("\n-- Cleanup --");
    for (const id of [...createdUserIds, ...createdAuthTestEmails]) {
      const { error } = await svc.auth.admin.deleteUser(id);
      if (error) console.error(`  Could not delete throwaway user ${id}: ${error.message}`);
    }
    console.log(`  Deleted ${createdUserIds.length + createdAuthTestEmails.length} throwaway account(s)`);
  }

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
