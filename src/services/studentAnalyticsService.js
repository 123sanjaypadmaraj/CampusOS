import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Student self-analytics (doc §14) -- backed by
| supabase/migrations/20260815001300_analytics_platform.sql's
| student_activity_summary()/student_spending_series(). Both are scoped
| server-side to auth.uid(); there is no student-facing parameter to pass a
| different user's id.
|--------------------------------------------------------------------------
*/

function throwIfError(error) {
  if (error) throw error;
}

// Single-row summary: spending, food/store orders, event registrations
// (registered vs. already happened), club memberships, marketplace
// listings/sales, opportunity applications, mentor requests. Returns null
// (not throw) when signed out, matching the "nothing to show" convention
// most read helpers in this codebase use rather than forcing every caller
// to try/catch a sign-in error.
export async function getStudentActivitySummary() {
  const { data, error } = await supabase.rpc("student_activity_summary");
  throwIfError(error);
  return data?.[0] || null;
}

export async function getStudentSpendingSeries(days = 30) {
  const { data, error } = await supabase.rpc("student_spending_series", { p_days: days });
  throwIfError(error);
  return data || [];
}
