/**
 * CAMPUS
 *
 * Resolves the single campus this deployment serves, falling back to a
 * hardcoded NHCE record if the `campuses` table isn't seeded yet so the app
 * still loads instead of hard-failing on a fresh/misconfigured database.
 */

import { supabase } from "../../lib/supabase";

export async function getDefaultCampus() {
  try {
    const { data, error } = await supabase
      .from("campuses")
      .select("id,name,slug")
      .eq("slug", "nhce")
      .maybeSingle();

    if (!error && data) return data;

    // Try any campus if nhce slug not found
    const { data: anyCampus } = await supabase
      .from("campuses")
      .select("id,name,slug")
      .limit(1)
      .maybeSingle();

    if (anyCampus) return anyCampus;
  } catch (err) {
    console.warn(
      "[CampusOS] Campus table not ready — run CAMPUSOS_RESET_AND_SEED.sql in Supabase.",
      err.message
    );
  }

  // Graceful fallback: app loads but campus-specific DB queries will be skipped
  // (campusId = null causes useEffect guards to skip data loading)
  return {
    id: null,
    name: "New Horizon College of Engineering",
    slug: "nhce",
  };
}


