/**
 * PROFILE
 *
 * The signed-in user's own profile (fetch/create/update) plus
 * people-directory lookups: classmates, cohort groups, people-you-may-know.
 */

import { supabase } from "../../lib/supabase";
import { cacheRead, cacheWrite } from "../../utils/offlineCache";
import { throwIfError } from "./_shared.js";

export async function getProfile(userId) {
  if (!userId) return null;

  try {
    const {
      data,
      error,
    } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) console.warn("Profile fetch warning:", error);

    return data || null;
  } catch (err) {
    console.warn("getProfile catch:", err);
    return null;
  }
}


export async function getOrCreateProfile(
  authUser,
  campusId
) {
  if (!authUser?.id) {
    return null;
  }

  // Doc §9 "Offline Mode": Profile is offline-capable, so a real
  // previously-fetched profile row wins over the synthetic
  // auth-metadata-only fallback below whenever the network call itself
  // fails (offline, or any other error).
  const cacheKey = `profile:${authUser.id}`;

  try {
    const existing =
      await getProfile(authUser.id);

    if (existing) {
      // handle_new_user() auto-creates this row on signup (including
      // USN-based signups via the Admin API) without ever setting
      // campus_id -- backfill it here so every profile ends up scoped to a
      // campus, instead of only newly-inserted-by-this-function rows.
      if (!existing.campus_id && campusId) {
        const { data: patched } = await supabase
          .from("profiles")
          .update({ campus_id: campusId })
          .eq("id", authUser.id)
          .select()
          .maybeSingle();
        if (patched) {
          cacheWrite(cacheKey, patched);
          return patched;
        }
      }
      cacheWrite(cacheKey, existing);
      return existing;
    }

    const metadata =
      authUser.user_metadata || {};

    const profile = {
      id: authUser.id,
      campus_id: campusId || null,
      name:
        metadata.name ||
        authUser.email?.split("@")[0] ||
        "Campus Student",
      email: authUser.email || "",
      usn: metadata.usn || "",
      course:
        metadata.course ||
        "Computer Science & Engineering",
      year:
        metadata.year ||
        "2nd Year",
      skills:
        metadata.skills || [],
    };

    // Errors here fall through to the cache/synthesized-profile fallback
    // below rather than throwing -- getOrCreateProfile must never block
    // sign-in just because the upsert failed.
    const { data } = await supabase
      .from("profiles")
      .upsert(profile, {
        onConflict: "id",
      })
      .select()
      .maybeSingle();

    if (data) {
      cacheWrite(cacheKey, data);
      return data;
    }
  } catch (err) {
    console.warn("getOrCreateProfile catch, using fallback:", err);
    const cached = await cacheRead(cacheKey);
    if (cached) return cached.data;
  }

  return {
    id: authUser.id,
    campus_id: campusId || null,
    name: authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Campus Student",
    email: authUser.email || "",
    usn: authUser.user_metadata?.usn || "",
    course: authUser.user_metadata?.course || "Computer Science & Engineering",
    year: authUser.user_metadata?.year || "2nd Year",
    skills: authUser.user_metadata?.skills || [],
  };
}


// RBAC frontend permission layer (readiness-audit phase 2,
// 20260822000100_rbac_frontend_permission_layer.sql): the real permission
// keys, role keys and admin flag for the signed-in user, straight from the
// role_permissions/user_roles tables that already back every RLS policy --
// src/hooks/usePermissions.js is the only caller. Returns the all-empty
// shape rather than throwing when signed out or on a transient error, since
// permission checks should fail closed (hide the gated UI) instead of
// crashing the app shell.
export async function getMyAccess() {
  const { data, error } = await supabase.rpc("get_my_access");
  if (error) {
    console.error("getMyAccess failed:", error);
    return { permissions: [], roles: [], is_admin: false };
  }
  return {
    permissions: data?.permissions || [],
    roles: data?.roles || [],
    is_admin: !!data?.is_admin,
  };
}


export async function updateProfile(
  userId,
  updates
) {
  if (!userId) {
    throw new Error("You must be signed in.");
  }

  const allowed = {
    name: updates.name,
    usn: updates.usn,
    course: updates.course,
    year: updates.year,
    avatar_url: updates.avatar_url,
    bio: updates.bio,
    ...(updates.phone !== undefined ? { phone: updates.phone } : {}),
    ...(updates.roll_number !== undefined ? { roll_number: updates.roll_number } : {}),
    ...(updates.department !== undefined ? { department: updates.department } : {}),
    ...(typeof updates.open_to_projects === "boolean"
      ? { open_to_projects: updates.open_to_projects }
      : {}),
    ...(typeof updates.personalization_enabled === "boolean"
      ? { personalization_enabled: updates.personalization_enabled }
      : {}),
    ...(updates.availability_status !== undefined
      ? { availability_status: updates.availability_status }
      : {}),
    ...(updates.availability_message !== undefined
      ? { availability_message: updates.availability_message?.trim?.() || updates.availability_message || null }
      : {}),
    skills: Array.isArray(updates.skills)
      ? updates.skills
      : [],
    ...(updates.achievements !== undefined
      ? { achievements: Array.isArray(updates.achievements) ? updates.achievements : [] }
      : {}),
    // Empty string would fail the profiles_linkedin_url_check /
    // profiles_github_url_check DB constraints (they only allow null or a
    // real https://linkedin.com|github.com URL) -- normalize blank input to
    // null rather than sending "".
    ...(updates.linkedin_url !== undefined
      ? { linkedin_url: updates.linkedin_url?.trim() || null }
      : {}),
    ...(updates.github_url !== undefined
      ? { github_url: updates.github_url?.trim() || null }
      : {}),
    updated_at: new Date().toISOString(),
  };

  const {
    data,
    error,
  } = await supabase
    .from("profiles")
    .update(allowed)
    .eq("id", userId)
    .select()
    .single();

  throwIfError(error);

  return data;
}


/* =========================================================================
   PEOPLE
========================================================================= */

// Other students' full profile rows are no longer directly selectable (RLS
// restricts `profiles` to the caller's own row + privileged roles -- doc
// §42). search_people() is a SECURITY DEFINER RPC that only ever projects
// the safe, non-sensitive columns, regardless of what's asked for.
export async function getPeople({
  campusId,
  search = "",
  limit = 50,
  cursor = null,
} = {}) {
  try {
    const { data, error } = await supabase.rpc("search_people", {
      p_campus_id: campusId,
      p_query: search?.trim() || null,
      p_limit: limit,
      p_cursor: cursor,
    });

    if (error) console.warn("getPeople query warning:", error);

    return data || [];
  } catch (err) {
    console.warn("getPeople error:", err);
    return [];
  }
}

// "People you may know" -- ranked by shared branch/year, club overlap, and
// shared community-activity tags. See get_people_you_may_know() (0024).
export async function getPeopleYouMayKnow({ limit = 12 } = {}) {
  try {
    const { data, error } = await supabase.rpc("get_people_you_may_know", { p_limit: limit });
    if (error) console.warn("getPeopleYouMayKnow warning:", error);
    return data || [];
  } catch (err) {
    console.warn("getPeopleYouMayKnow error:", err);
    return [];
  }
}

// Auto cohort groups -- one per (campus, course, year), membership derived
// automatically from profiles, nothing to create or join.
export async function getCohortGroups(campusId) {
  try {
    const { data, error } = await supabase.rpc("list_cohort_groups", { p_campus_id: campusId });
    if (error) console.warn("getCohortGroups warning:", error);
    return data || [];
  } catch (err) {
    console.warn("getCohortGroups error:", err);
    return [];
  }
}

export async function getCohortGroupMembers({ campusId, course, year, limit = 30, cursor = null }) {
  const { data, error } = await supabase.rpc("get_cohort_group_members", {
    p_campus_id: campusId,
    p_course: course,
    p_year: year,
    p_limit: limit,
    p_cursor: cursor,
  });
  throwIfError(error);
  return data || [];
}

