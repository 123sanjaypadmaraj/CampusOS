import { supabase } from "../lib/supabase";
import { calculatePrintJobPrice, hasValidBookingRange, isUuid } from "../utils/mvpHelpers";
import { isValidUsn, usnToEmail } from "../features/auth/usn";

/*
|--------------------------------------------------------------------------
| CampusOS data layer
|--------------------------------------------------------------------------
| Browser-safe Supabase client only.
| Never put the service_role key in the frontend.
|--------------------------------------------------------------------------
*/

/* =========================================================================
   ERROR LOGGING (monitoring -- see supabase/migrations/20260814005200_error_logs.sql)
   Fire-and-forget by design: a broken error-reporting call must never itself
   throw and cascade into a second failure on top of whatever it was trying
   to report. Callable while signed out too (log_client_error() is granted
   to `anon`) -- most of what matters here is exactly the crash that happens
   before/during sign-in.
========================================================================= */

// De-dupes identical errors within one tab session so a render loop or a
// polling failure doesn't flood error_logs with hundreds of copies of the
// same message before rl_error_logs (60/hour) even kicks in.
const _loggedErrorFingerprints = new Set();

export async function logClientError(message, { stack, severity = "error", context = {} } = {}) {
  try {
    if (!message) return;
    const fingerprint = `${severity}:${String(message).slice(0, 200)}`;
    if (_loggedErrorFingerprints.has(fingerprint)) return;
    _loggedErrorFingerprints.add(fingerprint);

    await supabase.rpc("log_client_error", {
      p_message: String(message).slice(0, 2000),
      p_stack: stack ? String(stack).slice(0, 8000) : null,
      p_url: typeof window !== "undefined" ? window.location.href : null,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      p_severity: severity,
      p_context: context || {},
      p_source: "client",
    });
  } catch {
    // Never let error logging itself throw -- there is nowhere further to
    // report that failure to.
  }
}

// Admin CMS "Errors" tab. RLS (error_logs_read_admin/_update_admin) already
// restricts this to system.errors.read/admin -- a non-admin caller just
// gets an empty list / a blocked update, not a 403 thrown here.
export async function listErrorLogs({ severity = null, source = null, resolved = null, limit = 100 } = {}) {
  let query = supabase
    .from("error_logs")
    .select("*, reporter:profiles!error_logs_user_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (severity) query = query.eq("severity", severity);
  if (source) query = query.eq("source", source);
  if (resolved !== null) query = query.eq("resolved", resolved);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function setErrorLogResolved(id, resolved) {
  // resolved_by/resolved_at are set server-side by a trigger regardless of
  // what's sent here -- see set_error_log_resolution_meta() in the migration.
  const { data, error } = await supabase.from("error_logs").update({ resolved }).eq("id", id).select().single();
  throwIfError(error);
  return data;
}

/* =========================================================================
   HELPERS
========================================================================= */

function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

function formatRelativeTime(date) {
  if (!date) return "";

  const diff = Math.max(
    0,
    Date.now() - new Date(date).getTime()
  );

  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(date).toLocaleDateString();
}

// Postgres RPC errors raised as `raise exception 'CODE: message'` (doc §81)
// arrive here as error.message === "CODE: message". Split that into a
// machine-readable `.code` and a clean, user-facing `.message` so every
// catch block in the UI shows readable text instead of a shouty prefix.
function throwIfError(error) {
  if (!error) return;

  const match = /^([A-Z][A-Z0-9_]{2,}):\s*(.+)$/.exec(error.message || "");
  if (match) {
    const wrapped = new Error(match[2]);
    wrapped.code = match[1];
    wrapped.cause = error;
    throw wrapped;
  }

  throw error;
}

/* =========================================================================
   AUTH
========================================================================= */

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;

  return user || null;
}

export async function getSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;

  return session || null;
}

export async function sendMagicLink(email) {
  const clean = email?.trim().toLowerCase();

  if (!clean) {
    throw new Error("Enter your college email.");
  }

  if (
    !clean.endsWith("@nhce.edu.in") &&
    !clean.endsWith("@newhorizonindia.edu") &&
    !clean.endsWith("@gmail.com")
  ) {
    throw new Error(
      "Please use an allowed email domain (@nhce.edu.in, @gmail.com)"
    );
  }

  const redirectUrl =
    `${window.location.origin}/`;

  const { error } =
    await supabase.auth.signInWithOtp({
      email: clean,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

  throwIfError(error);

  return true;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  throwIfError(error);
}

/*
 * signInWithPassword — plain email+password auth, used by the vendor login
 * tab (vendor accounts have no USN, so the USN&password flow doesn't apply
 * to them).
 */
export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return data;
}

/*
 * signInWithGoogle — OAuth login via Google. Redirects the browser to
 * Google's consent screen and back; subscribeToAuthChanges() picks up the
 * resulting session exactly like every other login method, no separate
 * handling needed. Does nothing on its own until the 'google' provider is
 * enabled with real credentials in the Supabase project's Auth settings --
 * until then this surfaces Supabase's "Unsupported provider" error.
 */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

/*
 * connectGithub — links a real GitHub account to the *currently signed-in*
 * user via OAuth (as opposed to signInWithOAuth, which would sign in/up as
 * a new session). Redirects the browser to GitHub's consent screen and
 * back; deriveGithubUrlFromIdentities() then turns the returned identity
 * into a real github.com/<username> link once the user's back. Requires
 * both the 'github' provider to be enabled (real GitHub OAuth app
 * credentials in Supabase) AND "Allow manual linking" turned on in the
 * project's Auth settings -- absent either, this surfaces a clear Supabase
 * error rather than silently doing nothing.
 */
export async function connectGithub() {
  const { error } = await supabase.auth.linkIdentity({
    provider: "github",
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

// GitHub OAuth identities carry the GitHub username as user_name (or,
// depending on API version, preferred_username) in identity_data -- that's
// enough to build a real profile URL. Pure function so it's testable
// without a live Supabase session.
export function deriveGithubUrlFromIdentities(identities) {
  const github = (identities || []).find((identity) => identity.provider === "github");
  const username = github?.identity_data?.user_name || github?.identity_data?.preferred_username;
  return username ? `https://github.com/${username}` : null;
}

/*
 * connectLinkedin — same linkIdentity() pattern as connectGithub(), but
 * LinkedIn's "Sign In using OpenID Connect" product doesn't return a
 * profile URL (only name/email/picture) -- getting that back needs
 * LinkedIn's older, partner-approval-gated Profile API. So this only
 * proves account ownership; call markLinkedinVerified() once linked to
 * record that server-side. The profile URL itself stays a manual field.
 */
export async function connectLinkedin() {
  const { error } = await supabase.auth.linkIdentity({
    provider: "linkedin_oidc",
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

// Server-checks auth.identities for a real linked linkedin_oidc identity
// before recording profiles.linkedin_verified_at -- deliberately not a
// plain client-side profiles.update(), so the verified badge can't be
// self-reported without actually completing LinkedIn OAuth.
export async function markLinkedinVerified() {
  const { data, error } = await supabase.rpc("mark_linkedin_verified");
  throwIfError(error);
  return data;
}

export function hasLinkedinIdentity(identities) {
  return (identities || []).some((identity) => identity.provider === "linkedin_oidc");
}

/*
 * Name + USN + Password login (alongside magic link). Supabase Auth is
 * still email-based internally -- signUpWithUsn() creates the account
 * server-side via the signup-with-usn Edge Function (service_role,
 * email_confirm: true, doc-requested flow), which mints a synthetic email
 * deterministically from the USN. signInWithUsn() derives that same email
 * client-side and signs in with the normal password grant -- no Edge
 * Function needed for login, only for the one-time account creation.
 */
export async function signUpWithUsn({ name, usn, password }) {
  if (!name?.trim()) throw new Error("Enter your full name.");
  if (!isValidUsn(usn || "")) throw new Error("USN must be exactly 10 letters/numbers.");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");

  const { data, error } = await supabase.functions.invoke("signup-with-usn", {
    body: { name: name.trim(), usn: usn.trim().toUpperCase(), password },
  });
  if (error) {
    // supabase-js only exposes the HTTP error, not the JSON body, on
    // FunctionsHttpError -- fall back to a generic message when that's all
    // we get, otherwise surface the {code, message} the function returned.
    const context = /** @type {any} */ (error).context;
    let message = error.message;
    try {
      const body = await context?.json?.();
      if (body?.message) message = body.message;
    } catch {
      /* ignore -- use the generic message */
    }
    throw new Error(message || "Unable to create account");
  }
  if (data?.code) {
    throw new Error(data.message || "Unable to create account");
  }

  return signInWithUsn({ usn: usn.trim().toUpperCase(), password });
}

export async function signInWithUsn({ usn, password }) {
  if (!isValidUsn(usn || "")) throw new Error("USN must be exactly 10 letters/numbers.");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usnToEmail(usn),
    password,
  });
  if (error) {
    throw new Error(
      error.message?.toLowerCase().includes("invalid")
        ? "Incorrect USN or password."
        : (error.message || "Unable to sign in")
    );
  }
  return data;
}

export function subscribeToAuthChanges(callback) {
  const {
    data: { subscription },
  } =
    supabase.auth.onAuthStateChange(
      (event, session) => {
        callback({
          event,
          session,
          user: session?.user || null,
        });
      }
    );

  return () => {
    subscription?.unsubscribe();
  };
}




/* =========================================================================
   CAMPUS
========================================================================= */

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


/* =========================================================================
   PROFILE
========================================================================= */

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
        if (patched) return patched;
      }
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

    const {
      data,
      error,
    } = await supabase
      .from("profiles")
      .upsert(profile, {
        onConflict: "id",
      })
      .select()
      .maybeSingle();

    if (data) return data;
  } catch (err) {
    console.warn("getOrCreateProfile catch, using fallback:", err);
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

/* =========================================================================
   ADMIN: USER MANAGEMENT (doc §54-58)
   Admins can read every profiles row directly (RLS bypass via
   current_user_is_admin(), see 0011) -- only the two mutating actions need
   RPCs, since profiles_update_self only allows updating your own row.
========================================================================= */

export async function listAllUsers(campusId, { search = "", role = null, limit = 50, cursor = null } = {}) {
  let query = supabase
    .from("profiles")
    .select("id, name, email, usn, course, year, role, status, suspended_reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (campusId) query = query.eq("campus_id", campusId);
  if (role) query = query.eq("role", role);
  if (search?.trim()) {
    const q = search.trim();
    query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,usn.ilike.%${q}%`);
  }
  if (cursor) query = query.lt("created_at", cursor);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function setUserRole(userId, newRole, reason) {
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_target_user: userId,
    p_new_role: newRole,
    p_reason: reason || null,
  });
  throwIfError(error);
}

export async function setUserStatus(userId, status, reason) {
  const { data, error } = await supabase.rpc("admin_set_user_status", {
    p_target_user: userId,
    p_status: status,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

/* =========================================================================
   ADMIN: MODERATION CONSOLE (doc §40-41, §58)
   moderate_content() (community.sql) already exists and handles hide/
   remove/approve for posts/comments; content_reports RLS already lets a
   moderator read/update any report directly. Only reading "what/who a
   report is actually about" needed an RPC (target_id is polymorphic).
========================================================================= */

export async function listOpenReports(limit = 50) {
  const { data, error } = await supabase
    .from("content_reports")
    .select("*, profiles!content_reports_reporter_id_fkey(name)")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(limit);
  throwIfError(error);
  return data || [];
}

export async function getReportContext(targetType, targetId, reporterId = null) {
  const { data, error } = await supabase.rpc("get_report_context", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reporter_id: reporterId,
  });
  throwIfError(error);
  return data?.[0] || null;
}

export async function moderateContent(targetType, targetId, action, reason) {
  const { error } = await supabase.rpc("moderate_content", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_action: action,
    p_reason: reason || null,
  });
  throwIfError(error);
}

export async function resolveReport(reportId, reviewerId, status = "resolved") {
  const { error } = await supabase
    .from("content_reports")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", reportId);
  throwIfError(error);
}

/* =========================================================================
   CLUB/VENDOR REQUESTS (doc §104)
========================================================================= */

export async function submitOrgRequest({ userId, campusId, requestType, name, description, category, contactPhone }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!name?.trim() || !description?.trim()) throw new Error("Add a name and description.");
  const { data, error } = await supabase
    .from("org_requests")
    .insert({
      requester_id: userId,
      campus_id: campusId,
      request_type: requestType,
      name: name.trim(),
      description: description.trim(),
      category: category?.trim() || null,
      contact_phone: contactPhone?.trim() || null,
    })
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function getMyOrgRequests(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("org_requests")
    .select("*")
    .eq("requester_id", userId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

export async function listPendingOrgRequests(campusId) {
  let query = supabase
    .from("org_requests")
    .select("*, profiles!org_requests_requester_id_fkey(name, course, year)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function approveOrgRequest(requestId, reason) {
  const { data, error } = await supabase.rpc("approve_org_request", { p_request_id: requestId, p_reason: reason || null });
  throwIfError(error);
  return data;
}

export async function rejectOrgRequest(requestId, reason) {
  const { data, error } = await supabase.rpc("reject_org_request", { p_request_id: requestId, p_reason: reason || null });
  throwIfError(error);
  return data;
}

/* =========================================================================
   STUDENT ID VERIFICATION (doc §7)
   student_verifications is a real table with real RLS (own row read/insert,
   admin read/update-any -- see 0011) but had no frontend code at all before
   this. document_path points into the private 'documents' storage bucket
   (owner + admin read/write, see 0015) -- never public.
========================================================================= */

export async function getMyVerification(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("student_verifications")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  return data;
}

// Re-submitting after a rejection reuses the same row (unique(user_id,
// campus_id)) and resets it back to 'pending' -- admins only ever see one
// live request per student, not an ever-growing history of attempts.
export async function submitStudentVerification({ userId, campusId, usn, file }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!file) throw new Error("Choose a photo of your student ID card.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/id-card-${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" });
  throwIfError(uploadError);

  const { data, error } = await supabase
    .from("student_verifications")
    .upsert(
      {
        user_id: userId,
        campus_id: campusId,
        usn: usn || null,
        verification_method: "document_upload",
        document_path: path,
        status: "pending",
        verified_at: null,
        verified_by: null,
        rejection_reason: null,
      },
      { onConflict: "user_id,campus_id" }
    )
    .select()
    .single();
  throwIfError(error);
  return data;
}

// Admin: a signed URL into the private bucket, valid briefly, so reviewing
// a submission doesn't require making student ID photos public.
export async function getVerificationDocumentUrl(path) {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 300);
  throwIfError(error);
  return data?.signedUrl;
}

export async function listPendingVerifications(campusId) {
  let query = supabase
    .from("student_verifications")
    .select("*, profiles!student_verifications_user_id_fkey(name, course, year, usn, email)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function reviewStudentVerification(id, status, reason, reviewerId) {
  if (!["verified", "rejected"].includes(status)) throw new Error("Invalid review status");
  const { data, error } = await supabase
    .from("student_verifications")
    .update({
      status,
      verified_at: status === "verified" ? new Date().toISOString() : null,
      verified_by: reviewerId || null,
      rejection_reason: status === "rejected" ? (reason || "Not specified") : null,
    })
    .eq("id", id)
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function getLostFoundItems(campusId, { limit = 30, cursor = null } = {}) {
  try {
    let query = supabase.from("lost_found_items").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(limit);
    if (campusId) query = query.eq("campus_id", campusId);
    if (cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query;
    if (error) console.warn("getLostFoundItems warning:", error);
    return data || [];
  } catch (err) {
    console.warn("getLostFoundItems error:", err);
    return [];
  }
}

export async function createLostFoundItem({ userId, campusId, itemType, title, description, category, location }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(userId)) throw new Error("Invalid user ID. Please sign in again.");
  if (!title?.trim() || !location?.trim()) throw new Error("Add an item title and location.");

  const { data, error } = await supabase
    .from("lost_found_items")
    .insert({
      user_id: userId,
      campus_id: campusId,
      item_type: itemType || "lost",
      title: title.trim(),
      description: description?.trim() || "",
      category: category?.trim() || "Other",
      location: location.trim(),
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

// Claiming now requires proof of ownership and staff verification before
// the item is released (doc §44) -- it flips to 'claim_pending', not
// straight to resolved, and goes through claim_lost_found_item() since
// direct table updates are blocked once status leaves 'open'.
export async function claimLostFoundItem({ itemId, userId, proof }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!proof?.trim()) throw new Error("Describe how you can prove this item is yours.");
  const { data, error } = await supabase.rpc("claim_lost_found_item", {
    p_item_id: itemId,
    p_proof: proof.trim(),
  });
  throwIfError(error);
  return data;
}

// Admin CMS "Lost & Found" tab -- every status, not just 'open' (getLostFoundItems
// above only fetches 'open', which is right for the student-facing list but
// hides claim_pending/resolved from the moderation view).
export async function listLostFoundItemsAdmin(campusId, { status = null, limit = 100 } = {}) {
  let query = supabase
    .from("lost_found_items")
    .select("*, reporter:profiles!lost_found_items_user_id_fkey(name), claimant:profiles!lost_found_items_claimed_by_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (campusId) query = query.eq("campus_id", campusId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

// Approve/reject a pending claim -- verify_lost_found_handover() (0009) is
// gated to moderation.act/admin server-side regardless of who calls it.
export async function verifyLostFoundHandover(itemId, approve) {
  const { data, error } = await supabase.rpc("verify_lost_found_handover", {
    p_item_id: itemId,
    p_approve: approve,
  });
  throwIfError(error);
  return data;
}

// Direct admin overrides (mark resolved without a claim, or remove a
// bogus/spam report) -- covered by the lost_found_admin_manage/_delete RLS
// policies (20260815000200), not by either RPC above.
export async function setLostFoundItemStatusAdmin(itemId, status) {
  const { data, error } = await supabase.from("lost_found_items").update({ status }).eq("id", itemId).select().single();
  throwIfError(error);
  return data;
}

export async function deleteLostFoundItemAdmin(itemId) {
  const { error } = await supabase.from("lost_found_items").delete().eq("id", itemId);
  throwIfError(error);
}

export async function getMarketplaceListings(campusId, search = "", { limit = 30, cursor = null } = {}) {
  try {
    let query = supabase.from("marketplace_listings").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(limit);
    if (campusId) query = query.eq("campus_id", campusId);
    if (search.trim()) query = query.ilike("title", `%${search.trim()}%`);
    if (cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query;
    if (error) console.warn("getMarketplaceListings warning:", error);
    
    let listings = data || [];
    if (listings.length > 0) {
      const sellerIds = [...new Set(listings.map(l => l.seller_id))];
      // Other sellers' full profile rows aren't directly selectable anymore
      // (RLS §42) -- get_profile_snippets() returns only the safe fields.
      const { data: profiles } = await supabase.rpc("get_profile_snippets", { p_ids: sellerIds });
      const profileMap = {};
      if (profiles) profiles.forEach(p => profileMap[p.id] = p);
      listings = listings.map(l => ({ ...l, profiles: profileMap[l.seller_id] || null }));
    }
    return listings;
  } catch (err) {
    console.warn("getMarketplaceListings error:", err);
    return [];
  }
}

export async function createMarketplaceListing({ userId, campusId, title, description, category, price, condition, location }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(userId)) throw new Error("Invalid user ID. Please sign in again.");
  if (!title?.trim() || Number(price) < 0) throw new Error("Add a valid listing title and price.");

  const { data, error } = await supabase
    .from("marketplace_listings")
    .insert({
      seller_id: userId,
      campus_id: campusId,
      title: title.trim(),
      description: description?.trim() || "",
      category: category?.trim() || "Other",
      price: Number(price),
      condition: condition?.trim() || "Used",
      location: location?.trim() || "Campus",
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

export async function markMarketplaceListingSold({ listingId, buyerId = null }) {
  const { data, error } = await supabase.rpc("mark_listing_sold", { p_listing_id: listingId, p_buyer_id: buyerId });
  throwIfError(error);
  return data;
}

// Records "this user was active today" (supabase/migrations/
// 20260814005000_analytics.sql) -- powers the admin DAU chart. Fire-and-
// forget: a failure here should never interrupt the app, so callers just
// swallow the error (App.jsx calls this once per session load).
export async function touchActivity() {
  const { error } = await supabase.rpc("touch_activity");
  if (error) console.warn("touchActivity warning:", error);
}



/* =========================================================================
   POSTS
========================================================================= */

// `cursor` is the created_at of the last post already loaded -- pass it to
// fetch the next page (doc §90: cursor pagination, never "load everything").
export async function getCampusPosts(
  campusId,
  { limit = 20, cursor = null } = {}
) {
  let query = supabase
    .from("posts")
    .select(`
      id,
      type,
      title,
      content,
      tags,
      created_at,
      campus_id,
      author_id
    `)
    .eq("status", "visible")
    .order("created_at", {
      ascending: false,
    })
    .limit(limit);

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  let posts = data || [];

  if (!posts.length) {
    return [];
  }

  const authorIds = [...new Set(posts.map(p => p.author_id))];
  if (authorIds.length > 0) {
    // Other authors' full profile rows aren't directly selectable anymore
    // (RLS §42) -- get_profile_snippets() returns only the safe fields.
    const { data: profilesData } = await supabase.rpc("get_profile_snippets", { p_ids: authorIds });

    const profileMap = {};
    if (profilesData) {
      profilesData.forEach(p => profileMap[p.id] = p);
    }

    posts = posts.map(p => ({
      ...p,
      profiles: profileMap[p.author_id] || null
    }));
  }

  const counts =
    await getPostCounts(
      posts.map((post) => post.id)
    );

  return posts.map((post) => ({
    id: post.id,
    type: post.type || "General",
    title: post.title,
    content: post.content || "",
    author:
      post.profiles?.name ||
      "Campus Student",
    authorId: post.author_id,
    avatar:
      post.profiles?.avatar_url ||
      null,
    course:
      post.profiles?.course || "",
    time:
      formatRelativeTime(
        post.created_at
      ),
    createdAt: post.created_at,
    likes:
      counts[post.id]?.likes || 0,
    comments:
      counts[post.id]?.comments || 0,
    liked: false,
    tags: post.tags || [],
    accent: "violet",
    verified: true,
  }));
}

export async function publishPost({
  userId,
  campusId,
  type = "General",
  title,
  content = "",
  tags = [],
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!title?.trim()) {
    throw new Error(
      "Post title cannot be empty."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      campus_id: campusId,
      type,
      title: title.trim(),
      content: content.trim(),
      tags,
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

export async function deletePost({
  postId,
  userId,
}) {
  if (!postId || !userId) {
    throw new Error(
      "Invalid post request."
    );
  }

  const {
    error,
  } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", userId);

  throwIfError(error);

  return true;
}



/* =========================================================================
   POST LIKES / COMMENTS
========================================================================= */

export async function togglePostLike({
  postId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  const {
    data: existing,
    error: readError,
  } = await supabase
    .from("post_likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfError(readError);

  if (existing) {
    const {
      error,
    } = await supabase
      .from("post_likes")
      .delete()
      .eq("id", existing.id);

    throwIfError(error);

    return false;
  }

  const {
    error,
  } = await supabase
    .from("post_likes")
    .insert({
      post_id: postId,
      user_id: userId,
    });

  throwIfError(error);

  return true;
}








export async function getPostCounts(
  postIds = []
) {
  if (!postIds.length) {
    return {};
  }

  const [
    likesResult,
    commentsResult,
  ] = await Promise.all([
    supabase
      .from("post_likes")
      .select("post_id")
      .in("post_id", postIds),

    supabase
      .from("comments")
      .select("post_id")
      .in("post_id", postIds),
  ]);

  throwIfError(
    likesResult.error
  );

  throwIfError(
    commentsResult.error
  );

  const counts = {};

  postIds.forEach((id) => {
    counts[id] = {
      likes: 0,
      comments: 0,
    };
  });

  (
    likesResult.data || []
  ).forEach((row) => {
    if (counts[row.post_id]) {
      counts[row.post_id].likes++;
    }
  });

  (
    commentsResult.data || []
  ).forEach((row) => {
    if (counts[row.post_id]) {
      counts[row.post_id].comments++;
    }
  });

  return counts;
}


export async function getPostComments(
  postId
) {
  const {
    data,
    error,
  } = await supabase
    .from("comments")
    .select(`
      id,
      post_id,
      author_id,
      content,
      created_at
    `)
    .eq("post_id", postId)
    .order("created_at");

  throwIfError(error);

  let comments = data || [];

  if (comments.length > 0) {
    const authorIds = [...new Set(comments.map(c => c.author_id))];
    const { data: profilesData } = await supabase.rpc("get_profile_snippets", { p_ids: authorIds });

    const profileMap = {};
    if (profilesData) {
      profilesData.forEach(p => profileMap[p.id] = p);
    }
    
    comments = comments.map(c => ({
      ...c,
      profiles: profileMap[c.author_id] || null
    }));
  }

  return comments.map(
    (comment) => ({
      ...comment,
      author:
        comment.profiles?.name ||
        "Campus Student",
      avatar:
        comment.profiles?.avatar_url ||
        null,
      time:
        formatRelativeTime(
          comment.created_at
        ),
    })
  );
}


export async function addPostComment({
  postId,
  userId,
  content,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!content?.trim()) {
    throw new Error(
      "Comment cannot be empty."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_id: userId,
      content: content.trim(),
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}


/* =========================================================================
   CLUBS
========================================================================= */

export async function getClubs(
  campusId
) {
  // members/events are derived counts (clubs_with_counts view), not
  // hand-maintained integer columns that can drift from reality.
  let query = supabase
    .from("clubs_with_counts")
    .select(`
      id,
      campus_id,
      name,
      category,
      members,
      events,
      description,
      logo_url,
      recruitment_mode,
      recruitment_message
    `)
    .eq("active", true)
    .order("name");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return data || [];
}


export async function joinClub({
  clubId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(clubId)) {
    throw new Error("Invalid club ID.");
  }

  // Plain insert, not upsert: the RLS update policy for club_members
  // requires clubs.manage permission (role changes are staff-only), so an
  // upsert's ON CONFLICT DO UPDATE path would be rejected for a student
  // re-joining a club they're already in. Treat "already a member" as a
  // harmless no-op instead.
  const {
    data,
    error,
  } = await supabase
    .from("club_members")
    .insert({
      club_id: clubId,
      user_id: userId,
      role: "member",
    })
    .select()
    .single();

  if (error?.code === "23505") {
    return { club_id: clubId, user_id: userId, role: "member" };
  }

  throwIfError(error);

  return data;
}


export async function leaveClub({
  clubId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(clubId)) {
    throw new Error("Invalid club ID.");
  }

  const {
    error,
  } = await supabase
    .from("club_members")
    .delete()
    .eq("club_id", clubId)
    .eq("user_id", userId);

  throwIfError(error);

  return true;
}


export async function getMyClubs(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("club_members")
    .select(`
      club_id,
      role,
      joined_at,
      clubs (
        id,
        name,
        category,
        description,
        logo_url
      )
    `)
    .eq("user_id", userId);

  throwIfError(error);

  return data || [];
}


/* =========================================================================
   EVENTS
========================================================================= */

function formatEvent(event) {
  const dateObj = new Date(event.event_date);
  const isValidDate = !isNaN(dateObj.getTime());

  return {
    id: event.id,
    date: isValidDate ? dateObj.getDate().toString() : "12",
    month: isValidDate
      ? dateObj.toLocaleString("en-US", { month: "short" }).toUpperCase()
      : "AUG",
    title: event.title,
    club: event.clubs?.name || "Campus Event",
    time: isValidDate
      ? dateObj.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : "2:00 PM",
    place: event.place || "Campus",
    color:
      event.category === "Hackathon"
        ? "blue"
        : event.category === "Workshop"
        ? "purple"
        : "green",
    category: event.category || "Event",
    attendees: event.attendees || 0,
    description: event.description || "",
  };
}

export async function getCampusEvents(
  campusId,
  { limit = 50, cursor = null } = {}
) {
  // attendees is a derived count (events_with_counts view), not a
  // hand-maintained integer column that can drift from real registrations.
  let query = supabase
    .from("events_with_counts")
    .select(`
      id,
      campus_id,
      club_id,
      title,
      category,
      event_date,
      place,
      description,
      capacity,
      registration_status,
      attendees,
      clubs (
        id,
        name,
        logo_url
      )
    `)
    .order("event_date")
    .limit(limit);

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  if (cursor) {
    query = query.gt("event_date", cursor);
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return (data || []).map(formatEvent);
}


export async function getMyEventRegistrations(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("event_registrations")
    .select(`
      event_id,
      registered_at,
      events (
        id,
        title,
        category,
        event_date,
        place
      )
    `)
    .eq("status", "confirmed")
    .eq("user_id", userId);

  throwIfError(error);

  return data || [];
}


export async function isRegisteredForEvent({
  eventId,
  userId,
}) {
  if (!eventId || !userId || !isUuid(eventId)) {
    return false;
  }

  const {
    data,
    error,
  } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .maybeSingle();

  throwIfError(error);

  return Boolean(data);
}


const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export function isValidPhone(phone) {
  return typeof phone === "string" && PHONE_PATTERN.test(phone.trim());
}

// Capacity enforcement + waitlisting now happens atomically inside
// register_for_event() (doc §35/§38) -- direct inserts into
// event_registrations are no longer permitted (no client insert policy).
// The registration confirmation dialog lets the student edit their display
// name and add a roll number/department per-registration; phone/name are
// validated here, USN/email still come from the signed-in profile inside
// the RPC (unspoofable) -- roll number/department are free text, no format
// to validate client-side.
export async function registerEvent({
  eventId,
  userId,
  contactPhone,
  contactName,
  rollNumber,
  department,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(eventId)) {
    throw new Error("Invalid event ID.");
  }

  if (!isValidPhone(contactPhone)) {
    throw new Error("Enter a valid phone number to register.");
  }

  if (!contactName || !contactName.trim()) {
    throw new Error("Enter a name to register.");
  }

  const {
    data,
    error,
  } = await supabase.rpc("register_for_event", {
    p_event_id: eventId,
    p_contact_phone: contactPhone.trim(),
    p_contact_name: contactName.trim(),
    p_roll_number: rollNumber?.trim() || null,
    p_department: department?.trim() || null,
  });

  throwIfError(error);

  return data; // { status: 'confirmed' | 'waitlisted', registration_id?, ticket_token?, position? }
}

export async function cancelEventRegistration({ eventId }) {
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { error } = await supabase.rpc("cancel_event_registration", { p_event_id: eventId });
  throwIfError(error);
  return true;
}

export async function getMyRegisteredEventIds(userId) {
  const rows = await getMyEventRegistrations(userId);
  return rows.map((row) => row.event_id);
}

export async function getSavedEvents(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from("saved_events").select("event_id").eq("user_id", userId);
  throwIfError(error);
  return (data || []).map((row) => row.event_id);
}

export async function toggleSavedEvent({ eventId, userId }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { data: existing, error: readError } = await supabase.from("saved_events").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
  throwIfError(readError);
  if (existing) {
    const { error } = await supabase.from("saved_events").delete().eq("event_id", eventId).eq("user_id", userId);
    throwIfError(error);
    return false;
  }
  const { error } = await supabase.from("saved_events").insert({ event_id: eventId, user_id: userId });
  throwIfError(error);
  return true;
}


/* =========================================================================
   FOOD
========================================================================= */

export async function getCampusFood(campusId) {
  const [
    canteenResult,
    foodResult,
  ] = await Promise.all([
    (() => {
      let q = supabase
        .from("canteens")
        .select(`
          id,
          name,
          subtitle,
          status,
          eta_min,
          eta_max,
          queue_level,
          load,
          color,
          active
        `)
        .eq("active", true)
        .order("name");
      if (campusId) q = q.eq("campus_id", campusId);
      return q;
    })(),

    supabase
      .from("food_items")
      .select(`
        id,
        canteen_id,
        name,
        description,
        price,
        image_url,
        is_vegetarian,
        available,
        food_categories (
          id,
          name
        )
      `)
      .eq("available", true)
      .order("name"),
  ]);

  throwIfError(
    canteenResult.error
  );

  throwIfError(
    foodResult.error
  );

  const canteens =
    canteenResult.data || [];

  const canteenMap =
    Object.fromEntries(
      canteens.map((c) => [
        c.id,
        c,
      ])
    );

  return {
    canteens: canteens.map(
      (canteen) => ({
        id: canteen.id,
        name: canteen.name,
        subtitle:
          canteen.subtitle || "",
        status:
          canteen.status || "Open",
        eta:
          `${canteen.eta_min}-${canteen.eta_max} min`,
        load:
          canteen.load || 0,
        color:
          canteen.color || "green",
      })
    ),

    items: (
      foodResult.data || []
    ).map((item) => ({
      id: item.id,
      name: item.name,
      description:
        item.description || "",
      price: Number(item.price),
      image:
        item.image_url || "",
      category:
        item.food_categories?.name ||
        "Food",
      vendor:
        canteenMap[item.canteen_id]
          ?.name || "",
      canteenId:
        item.canteen_id,
      veg:
        Boolean(item.is_vegetarian),
      vegetarian:
        Boolean(item.is_vegetarian),
      available:
        item.available,
    })),
  };
}


/* =========================================================================
   FOOD ORDERS
========================================================================= */

// Order creation is fully server-side now (doc §5, §12, §62, §63): pricing,
// stock/availability checks, and the order+items write all happen
// atomically inside the create_food_order() Postgres function, which also
// re-reads prices itself -- nothing here is trusted from the browser.
// `idempotencyKey` should be a stable value for this checkout attempt (e.g.
// generated once when the cart modal opens) so a flaky "Pay" double-click
// can't create two orders.
export async function createFoodOrder({
  userId,
  canteenId,
  cart,
  notes = "",
  fulfillmentType = "pickup",
  idempotencyKey = null,
}) {
  if (!userId) {
    throw new Error("Please sign in before ordering.");
  }
  if (!canteenId) {
    throw new Error("Select a canteen first.");
  }
  if (!cart?.length) {
    throw new Error("Your food cart is empty.");
  }

  const grouped = Object.values(
    cart.reduce((acc, item) => {
      if (!acc[item.id]) acc[item.id] = { ...item, quantity: 0 };
      acc[item.id].quantity++;
      return acc;
    }, {})
  );

  const items = grouped.map((item) => ({
    food_item_id: item.id,
    quantity: item.quantity,
    special_instructions: item.specialInstructions || null,
  }));

  const { data, error } = await supabase.rpc("create_food_order", {
    p_canteen_id: canteenId,
    p_items: items,
    p_notes: notes,
    p_fulfillment_type: fulfillmentType,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    // Surface the {code, message}-style errors raised by the RPC
    // (ORDER_ITEM_UNAVAILABLE, ORDER_SINGLE_CANTEEN, ...) as friendly text.
    const message = (error.message || "").replace(/^[A-Z_]+:\s*/, "");
    throw new Error(message || "Unable to place order");
  }

  return data;
}

// Kicks off payment for an order that's already in PAYMENT_PENDING: asks the
// create-razorpay-order Edge Function for a gateway order to open Checkout
// against. The order only becomes PAID once Razorpay's webhook verifies the
// payment server-side (see supabase/functions/razorpay-webhook).
export async function startFoodOrderPayment(orderId) {
  const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
    body: { order_id: orderId },
  });
  if (error) throw new Error(error.message || "Unable to start payment");
  return data; // { key_id, gateway_order_id, amount, currency, payment_id }
}

export async function transitionOrderStatus(orderId, toStatus, reason) {
  const { data, error } = await supabase.rpc("transition_order_status", {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

// Vendor-side pickup scan (doc §15) -- validates server-side that the token
// is unused, unexpired, and belongs to a READY order, then completes it.
export async function redeemPickupToken(token) {
  const { data, error } = await supabase.rpc("redeem_pickup_token", { p_token: token });
  throwIfError(error);
  return data;
}

export async function getOrderPickupToken(orderId) {
  const { data, error } = await supabase
    .from("order_pickup_tokens")
    .select("token, short_code, expires_at, used_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  return data;
}

// `cursor` is the created_at of the last order already loaded (doc §90).
export async function getMyOrders(
  userId,
  { limit = 20, cursor = null } = {}
) {
  if (!userId) return [];

  let query = supabase
    .from("orders")
    .select(`
      id,
      status,
      subtotal,
      tax_amount,
      platform_fee,
      delivery_fee,
      total,
      payment_status,
      pickup_code,
      notes,
      created_at,
      canteens (
        id,
        name
      ),
      order_items (
        id,
        quantity,
        unit_price,
        total_price,
        item_name
      )
    `)
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    })
    .limit(limit);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;

  throwIfError(error);

  return data || [];
}


/* =========================================================================
   PRINT
========================================================================= */

export async function uploadPrintJob({
  userId,
  file,
  pages = 1,
  copies = 1,
  colorMode = "black_white",
  paperSize = "A4",
  binding = null,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!file) {
    throw new Error(
      "Choose a document."
    );
  }

  const safeName =
    file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

  const path =
    `${userId}/${crypto.randomUUID()}-${safeName}`;

  const {
    error: uploadError,
  } = await supabase.storage
    .from("print-files")
    .upload(
      path,
      file,
      {
        cacheControl: "3600",
        upsert: false,
        contentType:
          file.type ||
          "application/octet-stream",
      }
    );

  throwIfError(uploadError);

  // Price is computed server-side from the campus rate card inside
  // create_print_job() (doc §29, §66) -- calculatePrintJobPrice() above is
  // now only used for the pre-upload UI estimate, never as the charged
  // amount. `file_url` stores the storage path; the print vendor UI resolves
  // it to a signed URL when it actually needs to open the file.
  const { data: job, error: jobError } = await supabase.rpc("create_print_job", {
    p_file_url: path,
    p_file_name: file.name,
    p_pages: Number(pages),
    p_copies: Number(copies),
    p_color_mode: colorMode,
    p_paper_size: paperSize,
    p_binding: binding || "none",
  });

  if (jobError) {
    await supabase.storage
      .from("print-files")
      .remove([path]);

    throw jobError;
  }

  return job;
}


export async function getMyPrintJobs(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    });

  throwIfError(error);

  return data || [];
}


/* =========================================================================
   CAMPUS SERVICES
========================================================================= */

export async function getCampusServices(
  campusId
) {
  let query = supabase
    .from("services")
    .select(`
      id,
      campus_id,
      name,
      description,
      active
    `)
    .eq("active", true)
    .order("name");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return data || [];
}


export async function getMyServiceRequests(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("service_requests")
    .select(`
      id,
      title,
      details,
      status,
      created_at,
      updated_at,
      services (
        id,
        name
      ),
      locations (
        id,
        name,
        building,
        floor,
        room
      )
    `)
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    });

  throwIfError(error);

  return data || [];
}


export async function createCampusServiceRequest({
  userId,
  campusId,
  serviceName,
  title,
  details = {},
  locationId = null,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!serviceName) {
    throw new Error(
      "Select a service."
    );
  }

  const {
    data: service,
    error: serviceError,
  } = await supabase
    .from("services")
    .select("id")
    .eq("campus_id", campusId)
    .eq("name", serviceName)
    .eq("active", true)
    .maybeSingle();

  throwIfError(serviceError);

  if (!service) {
    throw new Error(
      `Service "${serviceName}" is not configured.`
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("service_requests")
    .insert({
      service_id: service.id,
      user_id: userId,
      campus_id: campusId,
      location_id: locationId,
      title,
      details,
      status: "SUBMITTED",
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}


/* =========================================================================
   RESOURCE BOOKING
========================================================================= */

export async function getResources(
  campusId
) {
  // `available` is the canonical column (see supabase/migrations/
  // 20260814000700_services_bookings.sql) -- `active` was only ever a
  // legacy alias some pre-existing installs happened to carry (backfilled
  // into `available` at migration time, not kept in sync afterward). This
  // used to query `active` directly, which 42703'd outright on the staging
  // project (whose resources table never had an `active` column at all),
  // silently emptying the resource list and falling back to hardcoded mock
  // data with no real resource ids -- "Book" then couldn't open the booking
  // modal, only a "not configured" toast.
  let query = supabase
    .from("resources")
    .select(`
      id,
      campus_id,
      name,
      resource_type,
      available,
      locations (
        id,
        name,
        building,
        floor,
        room
      )
    `)
    .eq("available", true)
    .order("name");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return data || [];
}


export async function getMyBookings(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("bookings")
    .select(`
      id,
      resource_id,
      start_time,
      end_time,
      status,
      notes,
      created_at,
      resources (
        id,
        name,
        resource_type
      )
    `)
    .eq("user_id", userId)
    .order("start_time", {
      ascending: true,
    });

  throwIfError(error);

  return data || [];
}


export async function createResourceBooking({
  userId,
  resourceId,
  resourceName,
  startTime,
  endTime,
  notes = "",
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!startTime || !endTime) {
    throw new Error(
      "Select a start and end time."
    );
  }

  if (!hasValidBookingRange(startTime, endTime)) {
    throw new Error(
      "End time must be after start time."
    );
  }

  let resource;

  if (resourceId) {
    const {
      data,
      error,
    } = await supabase
      .from("resources")
      .select("id,name")
      .eq("id", resourceId)
      .single();

    throwIfError(error);

    resource = data;
  } else {
    const {
      data,
      error,
    } = await supabase
      .from("resources")
      .select("id,name")
      .eq("name", resourceName)
      .maybeSingle();

    throwIfError(error);

    resource = data;
  }

  if (!resource) {
    throw new Error(
      "Resource not found."
    );
  }

  // The actual double-booking guard is a PostgreSQL exclusion constraint
  // (doc §35) enforced inside create_booking() -- no client-side
  // pre-check can race it, so we don't bother with one here.
  const { data, error } = await supabase.rpc("create_booking", {
    p_resource_id: resource.id,
    p_start_time: startTime,
    p_end_time: endTime,
    p_notes: notes,
  });

  if (error) {
    const message = (error.message || "").replace(/^[A-Z_]+:\s*/, "");
    throw new Error(
      error.message?.includes("BOOKING_SLOT_TAKEN")
        ? "This resource is already booked for that time."
        : (message || "Unable to create booking")
    );
  }

  return data;
}

export async function setBookingStatus(bookingId, status) {
  const { data, error } = await supabase.rpc("set_booking_status", {
    p_booking_id: bookingId,
    p_status: status,
  });
  throwIfError(error);
  return data;
}

/* =========================================================================
   FACILITIES STAFF DASHBOARD (doc §30-33)
   tickets.read/tickets.update/bookings.approve already existed on the
   facilities_staff role and transition_ticket_status()/set_booking_status()
   already existed as RPCs -- neither had a UI calling them.
========================================================================= */

// RESOLVED is included -- it's not done yet, the UI still needs to show it
// with a "Close ticket" action. Only CLOSED (the true terminal state)
// actually drops off this queue.
const ACTIVE_TICKET_STATUSES = ["SUBMITTED", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING", "RESOLVED"];

export async function listActiveTickets(campusId) {
  let query = supabase
    .from("service_requests")
    .select("*")
    .in("status", ACTIVE_TICKET_STATUSES)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);

  const tickets = data || [];
  if (tickets.length === 0) return tickets;

  // A direct `profiles!...(name)` embed resolves to null here -- facilities
  // staff can read/update tickets (tickets.read/tickets.update) but that
  // permission doesn't extend to profiles RLS, which only trusts
  // `users.read`/admin for reading someone else's row. get_profile_snippets()
  // is the safe, RLS-bypassing way every other feature already shows "who
  // did this" (see getMarketplaceListings above) -- same fix here.
  const reporterIds = [...new Set(tickets.map((t) => t.user_id))];
  const { data: profiles } = await supabase.rpc("get_profile_snippets", { p_ids: reporterIds });
  const profileMap = {};
  (profiles || []).forEach((p) => { profileMap[p.id] = p; });
  return tickets.map((t) => ({ ...t, profiles: profileMap[t.user_id] || null }));
}

export async function transitionTicketStatus(requestId, toStatus, notes) {
  const { data, error } = await supabase.rpc("transition_ticket_status", {
    p_request_id: requestId,
    p_to_status: toStatus,
    p_notes: notes || null,
  });
  throwIfError(error);
  return data;
}

// Not campus-filtered -- bookings has no campus_id of its own (only via
// resources, and this deployment only ever has one campus); a facilities
// staff account already only has one campus's resources to see.
export async function listPendingBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, resources(name)")
    .eq("status", "PENDING")
    .order("start_time", { ascending: true });
  throwIfError(error);

  const bookings = data || [];
  if (bookings.length === 0) return bookings;

  // Same RLS-visibility reason as listActiveTickets() above: a direct
  // profiles embed resolves to null for facilities staff (bookings.approve
  // doesn't extend to profiles RLS).
  const requesterIds = [...new Set(bookings.map((b) => b.user_id))];
  const { data: profiles } = await supabase.rpc("get_profile_snippets", { p_ids: requesterIds });
  const profileMap = {};
  (profiles || []).forEach((p) => { profileMap[p.id] = p; });
  return bookings.map((b) => ({ ...b, profiles: profileMap[b.user_id] || null }));
}


/* =========================================================================
   NOTIFICATIONS
========================================================================= */

export async function getUserNotifications(
  userId,
  { limit = 30, cursor = null } = {}
) {
  if (!userId) return [];

  try {
    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", {
        ascending: false,
      })
      .limit(limit);

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const {
      data,
      error,
    } = await query;

    if (error) {
      console.warn("getUserNotifications warning:", error.message);
      return [];
    }

    return (data || []).map(
      (notification) => ({
        ...notification,
        time:
          formatRelativeTime(
            notification.created_at
          ),
        unread:
          !notification.read,
      })
    );
  } catch (err) {
    console.warn("getUserNotifications catch:", err);
    return [];
  }
}


export async function markNotificationRead(
  notificationId,
  userId
) {
  if (!userId) return;

  const {
    error,
  } = await supabase
    .from("notifications")
    .update({
      read: true,
    })
    .eq("id", notificationId)
    .eq("user_id", userId);

  throwIfError(error);
}


export async function markAllNotificationsRead(
  userId
) {
  if (!userId) return;

  const {
    error,
  } = await supabase
    .from("notifications")
    .update({
      read: true,
    })
    .eq("user_id", userId);

  throwIfError(error);
}


/* =========================================================================
   REALTIME
========================================================================= */

export function subscribeToUserNotifications(
  userId,
  callback
) {
  if (!userId) return () => {};

  const channel =
    supabase
      .channel(
        `notifications:${userId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter:
            `user_id=eq.${userId}`,
        },
        callback
      )
      .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}


export function subscribeToOrders(
  userId,
  callback
) {
  if (!userId) return () => {};

  const channel =
    supabase
      .channel(`orders:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter:
            `user_id=eq.${userId}`,
        },
        callback
      )
      .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}


export function subscribeToPosts(callback) {
  const channel = supabase
    .channel("public:posts_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "post_likes" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToEvents(callback) {
  const channel = supabase
    .channel("public:events_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "event_registrations" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToFood(callback) {
  const channel = supabase
    .channel("public:food_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "canteens" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "food_items" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToClubs(callback) {
  const channel = supabase
    .channel("public:clubs_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "clubs" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "club_members" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToMarketplace(callback) {
  const channel = supabase
    .channel("public:marketplace_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "marketplace_listings" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToLostFound(callback) {
  const channel = supabase
    .channel("public:lost_found_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "lost_found_items" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/* =========================================================================
   REPORTING & AUDIT
========================================================================= */

export async function reportContent(contentType, contentId, reason) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Must be logged in to report content");
  if (!isUuid(contentId)) throw new Error("This content can't be reported.");

  const { data, error } = await supabase
    .from("content_reports")
    .insert([
      {
        reporter_id: user.id,
        target_type: contentType,
        target_id: contentId,
        reason: reason,
      },
    ])
    .select()
    .single();

  throwIfError(error);
  return data;
}

export async function getAuditLogs(limit = 50) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  throwIfError(error);
  return data;
}

/* =========================================================================
   SOS / EMERGENCY (supabase/migrations/20260815000300_sos_alerts.sql)
   Real dispatch: a persisted alert, fanned out to facilities_staff/admins
   as a preference-proof 'emergency' notification, with an audited
   acknowledge/resolve lifecycle -- not a UI-only simulation.
========================================================================= */

// Best-effort geolocation: resolves with { latitude, longitude, accuracy }
// on success, or null on denial/timeout/unsupported browser -- an SOS
// trigger must never block on (or be blocked by) location permission.
export function getBestEffortLocation({ timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      () => resolve(null),
      { timeout, maximumAge: 60000 }
    );
  });
}

export async function triggerSosAlert({ alertType = "general", location } = {}) {
  const { data, error } = await supabase.rpc("trigger_sos_alert", {
    p_alert_type: alertType,
    p_latitude: location?.latitude ?? null,
    p_longitude: location?.longitude ?? null,
    p_location_accuracy_m: location?.accuracy ?? null,
  });
  throwIfError(error);
  return data;
}

export async function cancelMySosAlert(alertId) {
  const { data, error } = await supabase.rpc("cancel_my_sos_alert", { p_alert_id: alertId });
  throwIfError(error);
  return data;
}

export async function listActiveSosAlerts() {
  const { data, error } = await supabase.rpc("list_active_sos_alerts");
  throwIfError(error);
  return data || [];
}

export async function acknowledgeSosAlert(alertId) {
  const { data, error } = await supabase.rpc("acknowledge_sos_alert", { p_alert_id: alertId });
  throwIfError(error);
  return data;
}

export async function resolveSosAlert(alertId, notes = null) {
  const { data, error } = await supabase.rpc("resolve_sos_alert", { p_alert_id: alertId, p_notes: notes });
  throwIfError(error);
  return data;
}

export function subscribeToSosAlerts(callback) {
  const channel = supabase
    .channel("sos-alerts-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/* =========================================================================
   EMERGENCY CONTACTS (doc §113, supabase/migrations/20260815000600_emergency_contacts.sql)
   A verified next-of-kin directory per student, feeding the SOS responder
   flow above -- a responder can pull a student's contacts, but only in the
   context of a real active/acknowledged alert (get_emergency_contacts_for_alert),
   not by browsing the directory at will.
========================================================================= */

export async function listMyEmergencyContacts() {
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select("*")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function upsertEmergencyContact({
  id = null,
  contactName,
  relationship,
  phone,
  altPhone = null,
  email = null,
  isPrimary = false,
}) {
  if (!contactName || !contactName.trim()) throw new Error("Contact name is required.");
  if (!isValidPhone(phone)) throw new Error("Enter a valid phone number for this contact.");
  if (altPhone && altPhone.trim() && !isValidPhone(altPhone)) {
    throw new Error("Enter a valid alternate phone number, or leave it blank.");
  }
  const { data, error } = await supabase.rpc("upsert_emergency_contact", {
    p_id: id,
    p_contact_name: contactName.trim(),
    p_relationship: relationship,
    p_phone: phone.trim(),
    p_alt_phone: altPhone ? altPhone.trim() : null,
    p_email: email ? email.trim() : null,
    p_is_primary: Boolean(isPrimary),
  });
  throwIfError(error);
  return data;
}

export async function deleteEmergencyContact(id) {
  const { error } = await supabase.rpc("delete_emergency_contact", { p_id: id });
  throwIfError(error);
}

// Facilities/admin verification queue (emergency_contacts.verify permission).
export async function listPendingEmergencyContacts() {
  const { data, error } = await supabase.rpc("admin_list_pending_emergency_contacts");
  throwIfError(error);
  return data || [];
}

export async function verifyEmergencyContact(id, verified, notes = null) {
  const { data, error } = await supabase.rpc("verify_emergency_contact", {
    p_id: id,
    p_verified: verified,
    p_notes: notes,
  });
  throwIfError(error);
  return data;
}

// SOS responder pulling a student's contacts for a specific, real,
// currently-active alert -- see the RPC's own comment for why this is
// scoped this way instead of a plain directory read.
export async function getEmergencyContactsForAlert(alertId) {
  const { data, error } = await supabase.rpc("get_emergency_contacts_for_alert", { p_alert_id: alertId });
  throwIfError(error);
  return data || [];
}
