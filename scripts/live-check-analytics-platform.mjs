// One-off live verification script (not part of the automated suite) --
// exercises the new student/vendor/admin analytics RPCs from
// supabase/migrations/20260815001300_analytics_platform.sql against real
// signed-in sessions. Same shape as scripts/live-check-store-variants-stock.mjs.
//
// Usage: node scripts/live-check-analytics-platform.mjs                       (staging, default)
//        node scripts/live-check-analytics-platform.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, root, target } = resolveTarget();
const storeCredsFile = target === "production" ? ".store-credentials.local.json" : ".store-credentials.staging.local.json";
const vendorCredsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";
const storeCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", storeCredsFile), "utf8"));
const vendorCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", vendorCredsFile), "utf8"));
const udupi = vendorCreds.find((v) => v.vendor === "Udupi Canteen");
const printShop = vendorCreds.find((v) => v.vendor === "Print Shop");
const aliceEmail = "e2e.alice@nhce.edu.in";
const alicePassword = "TestPass!2026Alice";
const adminEmail = "1nh25cs265@usn.campusos.internal";
const adminPassword = "Sanjay@123";

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
  console.log(`=== Analytics Platform (${target}) ===`);

  const alice = await signIn(aliceEmail, alicePassword);
  const storeVendor = await signIn(storeCreds.email, storeCreds.password);
  const udupiVendor = await signIn(udupi.email, udupi.password);
  const printVendor = await signIn(printShop.email, printShop.password);
  const admin = await signIn(adminEmail, adminPassword);
  const anon = client();

  console.log("\n=== Student analytics ===");
  const { data: summary, error: summaryErr } = await alice.sb.rpc("student_activity_summary");
  const row = summary?.[0];
  check("student_activity_summary resolves for a signed-in student", !summaryErr && !!row, summaryErr);
  check("total_spent is a real non-negative number", row && Number(row.total_spent) >= 0, row);
  check("clubs_joined_count is present (was hardcoded 0 on Profile before this)", row && row.clubs_joined_count != null, row);

  const { data: series, error: seriesErr } = await alice.sb.rpc("student_spending_series", { p_days: 7 });
  check("student_spending_series returns one row per day", !seriesErr && Array.isArray(series) && series.length === 7, seriesErr);

  const { error: anonSummaryErr } = await anon.rpc("student_activity_summary");
  check("An anonymous caller is rejected by student_activity_summary", !!anonSummaryErr, anonSummaryErr?.message);

  console.log("\n=== Vendor analytics ===");
  const { data: topProducts, error: topProductsErr } = await storeVendor.sb.rpc("vendor_top_products", { p_days: 30 });
  check("vendor_top_products resolves for a store owner", !topProductsErr && Array.isArray(topProducts), topProductsErr);

  const { data: printProducts, error: printProductsErr } = await printVendor.sb.rpc("vendor_top_products", { p_days: 30 });
  check("vendor_top_products returns an empty set (not an error) for the print shop, which has no catalog", !printProductsErr && Array.isArray(printProducts) && printProducts.length === 0, { printProductsErr, printProducts });

  const { data: peakHours, error: peakHoursErr } = await udupiVendor.sb.rpc("vendor_peak_hours", { p_days: 30 });
  check("vendor_peak_hours returns all 24 hours for a canteen owner", !peakHoursErr && Array.isArray(peakHours) && peakHours.length === 24, peakHoursErr);

  const { data: repeat, error: repeatErr } = await udupiVendor.sb.rpc("vendor_repeat_customers", { p_days: 90 });
  check("vendor_repeat_customers resolves for a canteen owner", !repeatErr && repeat?.[0] != null, repeatErr);

  const { data: cancelRefund, error: cancelRefundErr } = await udupiVendor.sb.rpc("vendor_cancellations_refunds", { p_days: 90 });
  check("vendor_cancellations_refunds resolves for a canteen owner", !cancelRefundErr && cancelRefund?.[0] != null, cancelRefundErr);

  const { data: printCancelRefund, error: printCancelRefundErr } = await printVendor.sb.rpc("vendor_cancellations_refunds", { p_days: 90 });
  check("vendor_cancellations_refunds returns 0 refunded_amount for print (no refund concept)", !printCancelRefundErr && Number(printCancelRefund?.[0]?.refunded_amount) === 0, { printCancelRefundErr, printCancelRefund });

  const { error: aliceVendorErr } = await alice.sb.rpc("vendor_top_products", { p_days: 30 });
  check("A student with no vendor profile is rejected by vendor_top_products", !!aliceVendorErr, aliceVendorErr?.message);

  console.log("\n=== Admin analytics ===");
  const { data: vendorPerf, error: vendorPerfErr } = await admin.sb.rpc("admin_vendor_performance", { p_days: 90 });
  check("admin_vendor_performance returns rows for all 3 vendor types", !vendorPerfErr && Array.isArray(vendorPerf), vendorPerfErr);
  const types = new Set((vendorPerf || []).map((v) => v.vendor_type));
  check("...covering canteen, print_shop, and store", ["canteen", "print_shop", "store"].every((t) => types.has(t)), [...types]);
  const sortedDesc = (vendorPerf || []).every((v, i, arr) => i === 0 || Number(arr[i - 1].gmv) >= Number(v.gmv));
  check("...ordered by GMV descending (the UNION's column-alias fix)", sortedDesc, vendorPerf);

  const { data: eventsSummary, error: eventsSummaryErr } = await admin.sb.rpc("admin_events_summary", { p_days: 90 });
  check("admin_events_summary resolves", !eventsSummaryErr && eventsSummary?.[0] != null, eventsSummaryErr);

  const { data: topEvents, error: topEventsErr } = await admin.sb.rpc("admin_top_events", { p_days: 90 });
  check("admin_top_events resolves", !topEventsErr && Array.isArray(topEvents), topEventsErr);

  const { data: facilitiesSummary, error: facilitiesSummaryErr } = await admin.sb.rpc("admin_facilities_summary", { p_days: 90 });
  check("admin_facilities_summary resolves", !facilitiesSummaryErr && facilitiesSummary?.[0] != null, facilitiesSummaryErr);

  const { data: ticketsByCategory, error: ticketsByCategoryErr } = await admin.sb.rpc("admin_tickets_by_category", { p_days: 90 });
  check("admin_tickets_by_category resolves", !ticketsByCategoryErr && Array.isArray(ticketsByCategory), ticketsByCategoryErr);

  const { data: marketplaceSummary, error: marketplaceSummaryErr } = await admin.sb.rpc("admin_marketplace_summary", { p_days: 90 });
  check("admin_marketplace_summary resolves", !marketplaceSummaryErr && marketplaceSummary?.[0] != null, marketplaceSummaryErr);

  const { data: notifSummary, error: notifSummaryErr } = await admin.sb.rpc("admin_notifications_summary", { p_days: 90 });
  check("admin_notifications_summary resolves", !notifSummaryErr && notifSummary?.[0] != null, notifSummaryErr);

  const { data: health, error: healthErr } = await admin.sb.rpc("admin_platform_health", { p_days: 90 });
  check("admin_platform_health resolves", !healthErr && health?.[0] != null, healthErr);

  const { data: errorTrend, error: errorTrendErr } = await admin.sb.rpc("admin_error_trend", { p_days: 7 });
  check("admin_error_trend returns one row per day", !errorTrendErr && Array.isArray(errorTrend) && errorTrend.length === 7, errorTrendErr);

  console.log("\n=== Admin RLS ===");
  const { error: aliceAdminErr } = await alice.sb.rpc("admin_vendor_performance", { p_days: 30 });
  check("A student is rejected by admin_vendor_performance", !!aliceAdminErr, aliceAdminErr?.message);
  const { error: vendorAdminErr } = await udupiVendor.sb.rpc("admin_platform_health", { p_days: 30 });
  check("A vendor (holds analytics.read, but not admin) IS allowed into admin_platform_health -- matches admin_gmv_series' existing has_permission-OR-admin gate", !vendorAdminErr, vendorAdminErr?.message);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
