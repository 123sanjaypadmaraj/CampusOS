import { supabase } from "../lib/supabase";
import { calculatePrintJobPrice, hasValidBookingRange, isUuid } from "../utils/mvpHelpers";
import { isValidUsn, usnToEmail } from "../features/auth/usn";
import { cacheRead, cacheWrite, withOfflineCache } from "../utils/offlineCache";

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

export async function logClientError(message, { stack, severity = "error", context = {}, category = null } = {}) {
  try {
    if (!message) return;
    const fingerprint = `${severity}:${category || ""}:${String(message).slice(0, 200)}`;
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
      p_category: category,
    });
  } catch {
    // Never let error logging itself throw -- there is nowhere further to
    // report that failure to.
  }
}

// Shared by every supabase.storage upload call site in this app (here and
// in the other services that upload media): logs a failed upload to
// error_logs (category 'storage') before the caller's own throwIfError()
// raises it. No-ops silently when there's no error.
export function logStorageErrorIfAny(bucket, error) {
  if (error) {
    logClientError(`Storage upload failed: ${bucket}`, {
      severity: "error",
      category: "storage",
      context: { bucket, error: error.message },
    });
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
  if (!isValidUsn(usn || "")) throw new Error("Enter a valid NHCE USN, e.g. 1NH22CS201.");
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
  // Deliberately NOT isValidUsn() here -- that's the strict NHCE-format
  // check signUpWithUsn() gates new accounts on. This is a LOGIN against an
  // already-existing account, which may predate that stricter format; all
  // this needs is "non-empty enough to derive an email from."
  if (!usn?.trim()) throw new Error("Enter your USN.");
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
    .select("id, name, email, usn, course, year, role, status, suspended_reason, ai_blocked, ai_blocked_reason, created_at")
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

// Role-assignment approval (doc "Admin" checklist item) -- the maker-checker
// path a college_admin now goes through instead of admin_set_user_role()
// directly (that RPC is super_admin-only as of the role-escalation fix).
// listRoleChangeRequests()/decideRoleChange() are also how a super_admin
// approves a college_admin's proposal.
export async function proposeRoleChange(userId, newRole, reason) {
  const { data, error } = await supabase.rpc("propose_role_change", {
    p_target_user: userId,
    p_new_role: newRole,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

export async function listRoleChangeRequests(status = "pending") {
  let query = supabase
    .from("role_change_requests")
    .select("*, target:profiles!role_change_requests_target_user_fkey(name, email, role), proposer:profiles!role_change_requests_requested_by_fkey(name)")
    .order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function decideRoleChange(requestId, approve, reason) {
  const { data, error } = await supabase.rpc("decide_role_change", {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

// Account deletion request (doc "Student" checklist item) -- self-service
// request, admin-executed soft-delete. request_account_deletion()/
// cancel_account_deletion_request() are self-scoped by auth.uid() server-side
// (no userId param needed); getMyAccountDeletionRequest() still takes one to
// match getMyVerification()'s existing shape used the same way in Profile.
export async function requestAccountDeletion(reason) {
  const { data, error } = await supabase.rpc("request_account_deletion", { p_reason: reason || null });
  throwIfError(error);
  return data;
}

export async function cancelAccountDeletionRequest(requestId) {
  const { error } = await supabase.rpc("cancel_account_deletion_request", { p_request_id: requestId });
  throwIfError(error);
}

// Suspension appeal (supabase/migrations/20260818000600_community_hardening.sql)
// -- the one path a suspended account has left, since reject_if_suspended()
// blocks nearly everything else. Self-scoped server-side (no userId param).
export async function submitSuspensionAppeal(reason) {
  const { data, error } = await supabase.rpc("submit_suspension_appeal", { p_reason: reason });
  throwIfError(error);
  return data;
}

export async function getMySuspensionAppeal() {
  const { data, error } = await supabase.rpc("get_my_suspension_appeal");
  throwIfError(error);
  return data || null;
}

export async function getMyAccountDeletionRequest(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  throwIfError(error);
  return data;
}

export async function listAccountDeletionRequests(status = "pending") {
  let query = supabase
    .from("account_deletion_requests")
    .select("*, profiles!account_deletion_requests_user_id_fkey(name, email, usn, role)")
    .order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function adminProcessAccountDeletion(requestId, action, note) {
  const { data, error } = await supabase.rpc("admin_process_account_deletion", {
    p_request_id: requestId,
    p_action: action,
    p_note: note || null,
  });
  throwIfError(error);
  return data;
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
   ADMIN: AI ASSISTANT (doc "AI" checklist -- security hardening, trust &
   quality, feedback/analytics). Access kill-switch reuses profiles.role's
   own admin-gate pattern (admin_set_ai_access); knowledge base and
   analytics are new RPC-only surfaces added in
   20260817001300_ai_hardening.sql.
========================================================================= */

export async function setAiAccess(userId, blocked, reason) {
  const { data, error } = await supabase.rpc("admin_set_ai_access", {
    p_target_user: userId,
    p_blocked: blocked,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

export async function listAiKnowledge() {
  const { data, error } = await supabase.rpc("admin_list_ai_knowledge");
  throwIfError(error);
  return data || [];
}

export async function upsertAiKnowledge({ id, question, answer, campusId, active }) {
  const { data, error } = await supabase.rpc("upsert_ai_knowledge", {
    p_id: id || null,
    p_question: question,
    p_answer: answer,
    p_campus_id: campusId || null,
    p_active: active !== false,
  });
  throwIfError(error);
  return data;
}

export async function deleteAiKnowledge(id) {
  const { error } = await supabase.rpc("delete_ai_knowledge", { p_id: id });
  throwIfError(error);
}

export async function getAiUsageSummary(days = 30) {
  const { data, error } = await supabase.rpc("ai_admin_usage_summary", { p_days: days });
  throwIfError(error);
  return data?.[0] || null;
}

export async function listAiReports(limit = 50) {
  const { data, error } = await supabase.rpc("ai_admin_list_reports", { p_limit: limit });
  throwIfError(error);
  return data || [];
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

// Conversation reports only ever showed the last message's snippet -- a
// moderator reviewing one has no way to see (or remove) the actual
// offending message otherwise, since they aren't a participant and plain
// RLS blocks them. See 20260817001000_message_delete_moderation.sql;
// deleteMessage() (messagingService.js) is the same RPC-backed removal
// used here, sender-side and moderator-side both go through delete_message().
export async function adminGetConversationMessages(conversationId, limit = 50) {
  const { data, error } = await supabase.rpc("admin_get_conversation_messages", {
    p_conversation_id: conversationId,
    p_limit: limit,
  });
  throwIfError(error);
  return data || [];
}

export async function resolveReport(reportId, reviewerId, status = "resolved") {
  const { error } = await supabase
    .from("content_reports")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", reportId);
  throwIfError(error);
}

/* =========================================================================
   PROFANITY FILTER WORD LIST + SUSPENSION APPEALS
   (supabase/migrations/20260818000600_community_hardening.sql)
========================================================================= */

export async function listBannedWords() {
  const { data, error } = await supabase.from("banned_words").select("word, added_by, created_at").order("word");
  throwIfError(error);
  return data || [];
}

export async function addBannedWord(word) {
  const { error } = await supabase.rpc("admin_add_banned_word", { p_word: word });
  throwIfError(error);
}

export async function removeBannedWord(word) {
  const { error } = await supabase.rpc("admin_remove_banned_word", { p_word: word });
  throwIfError(error);
}

// Marketplace prohibited-item term list (supabase/migrations/
// 20260818000700_marketplace_hardening.sql) -- separate list from
// banned_words above since "profanity" and "prohibited item" are different
// moderation reasons, same admin-managed-list shape either way.
export async function listProhibitedListingTerms() {
  const { data, error } = await supabase.from("prohibited_listing_terms").select("term, added_by, created_at").order("term");
  throwIfError(error);
  return data || [];
}

export async function addProhibitedListingTerm(term) {
  const { error } = await supabase.rpc("admin_add_prohibited_term", { p_term: term });
  throwIfError(error);
}

export async function removeProhibitedListingTerm(term) {
  const { error } = await supabase.rpc("admin_remove_prohibited_term", { p_term: term });
  throwIfError(error);
}

export async function listSuspensionAppeals(status = "pending") {
  const { data, error } = await supabase.rpc("admin_list_suspension_appeals", { p_status: status });
  throwIfError(error);
  return data || [];
}

export async function resolveSuspensionAppeal(appealId, decision, adminNote) {
  const { data, error } = await supabase.rpc("resolve_suspension_appeal", {
    p_appeal_id: appealId,
    p_decision: decision,
    p_admin_note: adminNote || null,
  });
  throwIfError(error);
  return data;
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
    // Fire-and-forget housekeeping: flips any report whose expires_at has
    // passed from 'open' to 'archived' (supabase/migrations/
    // 20260819001600_lost_found_hardening.sql) -- same "best-effort, never
    // block the feed load" posture as getMarketplaceListings' equivalent call.
    Promise.resolve(supabase.rpc("expire_stale_lost_found_items")).catch(() => {});

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

// Direct admin overrides (mark resolved without a claim, archive/restore, or
// remove a bogus/spam report) -- covered by the lost_found_admin_manage/
// _delete RLS policies (20260815000200), not by either RPC above. Restoring
// to 'open' also resets expires_at (20260819001600) -- otherwise a report
// restored from 'archived' would already be past its old expiry and get
// re-archived by the very next expire_stale_lost_found_items() housekeeping
// call.
export async function setLostFoundItemStatusAdmin(itemId, status) {
  const patch = status === "open" ? { status, expires_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString() } : { status };
  const { data, error } = await supabase.from("lost_found_items").update(patch).eq("id", itemId).select().single();
  throwIfError(error);
  return data;
}

export async function deleteLostFoundItemAdmin(itemId) {
  const { error } = await supabase.from("lost_found_items").delete().eq("id", itemId);
  throwIfError(error);
}

export async function getMarketplaceListings(campusId, search = "", { limit = 30, cursor = null } = {}) {
  try {
    // Fire-and-forget housekeeping: flips any listing whose expires_at has
    // passed from 'active' to 'expired' (supabase/migrations/
    // 20260818000700_marketplace_hardening.sql). Best-effort, not a hard
    // SLA -- deliberately not awaited so a slow/failed call here never
    // delays the actual feed load, same "swallow and move on" posture as
    // touchActivity().
    Promise.resolve(supabase.rpc("expire_stale_listings")).catch(() => {});

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

export async function createMarketplaceListing({ userId, campusId, title, description, category, price, condition, location, imageUrls = [] }) {
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
      image_urls: imageUrls,
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

// This user's own listings, active or not (getMarketplaceListings above is
// the public feed -- it only ever shows status='active' and no other
// seller's own listing history). Used by the "Your Activity" hub.
export async function getMyMarketplaceListings(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("id, title, price, category, condition, status, created_at, updated_at, expires_at")
    .eq("seller_id", userId)
    .order("created_at", { ascending: false });

  throwIfError(error);

  return data || [];
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
      image_urls,
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
    images: post.image_urls || [],
    accent: "violet",
    verified: true,
  }));
}

// Client-side compression before upload -- same technique as
// features/vendor/api.js's compressImage (longest edge to 1280px, JPEG
// q0.8), duplicated locally rather than imported since mvpService.js is a
// shared/core service and vendor/api.js is a feature module -- importing
// the other way round would be the wrong dependency direction.
async function compressImage(file, maxDim = 1280, quality = 0.8) {
  if (typeof document === "undefined" || !file.type?.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file; // best-effort -- never block an upload on a compression failure
  }
}

// post-media is a public bucket, RLS-scoped so a caller can only write into
// their own `${auth.uid()}/...` folder (20260814001500_storage_buckets.sql
// already created it and its policies -- this was the one caller missing).
export async function uploadPostImage(file, ownerId) {
  if (!ownerId) throw new Error("Please sign in first.");
  const compressed = await compressImage(file);
  const path = `${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from("post-media").upload(path, compressed, { contentType: "image/jpeg" });
  logStorageErrorIfAny("post-media", error);
  throwIfError(error);
  const { data } = supabase.storage.from("post-media").getPublicUrl(path);
  return data.publicUrl;
}

export async function publishPost({
  userId,
  campusId,
  type = "General",
  title,
  content = "",
  tags = [],
  imageUrls = [],
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
      image_urls: imageUrls,
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
  const fetchEvents = async () => {
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
  };

  // Doc §9 "Offline Mode": "previously loaded events" -- only cache/serve
  // the first page. A paginated "load more" while offline should just
  // fail normally rather than silently re-showing page one as if it were
  // the next page.
  if (cursor) return fetchEvents();
  return withOfflineCache(`events:${campusId || "default"}`, fetchEvents);
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
  // Doc §9 "Offline Mode": "saved content" -- this is the only real saved/
  // bookmarked-content list in the app today.
  return withOfflineCache(`saved_events:${userId}`, async () => {
    const { data, error } = await supabase.from("saved_events").select("event_id").eq("user_id", userId);
    throwIfError(error);
    return (data || []).map((row) => row.event_id);
  });
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

// Saved posts (20260818000600_community_hardening.sql) -- same shape/pattern
// as saved_events above, just against public.posts instead of public.events.
export async function getSavedPosts(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from("saved_posts").select("post_id").eq("user_id", userId);
  throwIfError(error);
  return (data || []).map((row) => row.post_id);
}

export async function toggleSavedPost({ postId, userId }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(postId)) throw new Error("Invalid post ID.");
  const { data: existing, error: readError } = await supabase.from("saved_posts").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle();
  throwIfError(readError);
  if (existing) {
    const { error } = await supabase.from("saved_posts").delete().eq("post_id", postId).eq("user_id", userId);
    throwIfError(error);
    return false;
  }
  const { error } = await supabase.from("saved_posts").insert({ post_id: postId, user_id: userId });
  throwIfError(error);
  return true;
}


/* =========================================================================
   FOOD
========================================================================= */

export async function getCampusFood(campusId) {
  // Doc §9 "Offline Mode": "previously loaded menus".
  return withOfflineCache(`food:${campusId || "default"}`, async () => {
    const [
      canteenResult,
      foodResult,
      hoursResult,
      closuresResult,
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
          dietary_tags,
          allergens,
          spice_level,
          calories,
          available_days,
          available_from,
          available_to,
          food_categories (
            id,
            name
          ),
          food_item_variants (
            id, name, price, available, active
          ),
          food_item_addon_groups (
            id, name, min_select, max_select, active,
            food_item_addon_options ( id, name, price_delta, available, active )
          )
        `)
        .eq("available", true)
        .order("name"),

      supabase.from("canteen_hours").select("canteen_id, day_of_week, opens_at, closes_at, closed"),
      supabase.from("canteen_closures").select("canteen_id, starts_at, ends_at, reason").gte("ends_at", new Date().toISOString()),
    ]);

    throwIfError(
      canteenResult.error
    );

    throwIfError(
      foodResult.error
    );
    throwIfError(hoursResult.error);
    throwIfError(closuresResult.error);

    const canteens =
      canteenResult.data || [];
    const hoursByCanteen = {};
    for (const h of hoursResult.data || []) {
      (hoursByCanteen[h.canteen_id] ||= []).push(h);
    }
    const closuresByCanteen = {};
    for (const c of closuresResult.data || []) {
      (closuresByCanteen[c.canteen_id] ||= []).push(c);
    }

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
          hours: hoursByCanteen[canteen.id] || [],
          closures: closuresByCanteen[canteen.id] || [],
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
        dietaryTags: item.dietary_tags || [],
        allergens: item.allergens || [],
        spiceLevel: item.spice_level || null,
        calories: item.calories ?? null,
        availableDays: item.available_days || null,
        availableFrom: item.available_from || null,
        availableTo: item.available_to || null,
        variants: (item.food_item_variants || [])
          .filter((v) => v.active)
          .map((v) => ({ id: v.id, name: v.name, price: Number(v.price), available: v.available })),
        addonGroups: (item.food_item_addon_groups || [])
          .filter((g) => g.active)
          .map((g) => ({
            id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select,
            options: (g.food_item_addon_options || [])
              .filter((o) => o.active)
              .map((o) => ({ id: o.id, name: o.name, priceDelta: Number(o.price_delta), available: o.available })),
          })),
      })),
    };
  });
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

  // mergeCartItem() already keeps `cart` as at most one entry per distinct
  // (item, variant, add-on selection) with a real running `.quantity` on
  // that entry -- it never creates duplicate rows for the same line. This
  // used to re-derive quantity by counting array entries per food_item_id
  // instead of reading item.quantity, which silently placed every order at
  // quantity 1 no matter how many of an item were actually in the cart
  // (found while wiring in variant/add-on support -- fixed here).
  const items = cart.map((item) => ({
    food_item_id: item.id,
    quantity: Number(item.quantity) || 1,
    special_instructions: item.specialInstructions || null,
    variant_id: item.variantId || null,
    addon_option_ids: item.addonOptionIds && item.addonOptionIds.length ? item.addonOptionIds : null,
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
    logClientError(`create_food_order failed: ${error.message}`, { severity: "error", category: "order_creation", context: { canteenId } });
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

// Generates (or, on a repeat call, just returns) the GST invoice for a paid
// food order -- see generate_order_invoice() (doc Phase 3 "Invoice
// generation"). Idempotent server-side; safe to call every time a receipt
// is opened rather than caching the result client-side.
export async function getOrCreateOrderInvoice(orderId) {
  const { data, error } = await supabase.rpc("generate_order_invoice", { p_order_id: orderId });
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
   PAYMENTS
========================================================================= */

// The payment ledger only ever links to a food order (`payments.order_id ->
// orders`, see supabase/migrations/20260814000400_payments.sql) -- there's
// no student-facing row for store/booking/print charges yet. RLS
// (payments_read) already restricts this to payments on the caller's own
// orders, so no explicit .eq("user_id", ...) is needed or even possible
// here -- the filter has to go through the embedded orders join instead.
export async function getMyPayments(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("payments")
    .select(`
      id,
      gateway,
      amount,
      currency,
      status,
      created_at,
      orders (
        id,
        total,
        status,
        canteens ( name )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  throwIfError(error);

  return data || [];
}


/* =========================================================================
   PRINT
========================================================================= */

export const PRINT_FILE_MAX_BYTES = 26214400; // 25MB, mirrors the print-files bucket's own limit
const PRINT_FILE_ALLOWED_TYPES = ["application/pdf"];

// Real, honest structural validation (file type + size) run before ever
// touching the network -- not virus scanning (deliberately out of scope,
// no AV engine is reachable from an Edge Function in this deployment), just
// the same checks the bucket enforces server-side anyway, surfaced as a
// friendly error instead of a raw storage-API failure.
export function validatePrintFile(file) {
  if (!file) throw new Error("Choose a document.");
  const looksLikePdf = file.type
    ? PRINT_FILE_ALLOWED_TYPES.includes(file.type)
    : /\.pdf$/i.test(file.name || "");
  if (!looksLikePdf) {
    throw new Error("Only PDF files can be printed.");
  }
  if (file.size > PRINT_FILE_MAX_BYTES) {
    throw new Error(`File is too large (max ${PRINT_FILE_MAX_BYTES / 1024 / 1024}MB).`);
  }
}

export async function getPrintRateCard(campusId) {
  let query = supabase.from("print_rate_card").select("*");
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function getPrintBindingRates(campusId) {
  let query = supabase.from("print_binding_rates").select("*");
  query = campusId ? query.eq("campus_id", campusId).maybeSingle() : query.limit(1).maybeSingle();
  const { data, error } = await query;
  throwIfError(error);
  return data || null;
}

export async function getPrintShopStatus(campusId) {
  let query = supabase.from("print_shop_status").select("*");
  query = campusId ? query.eq("campus_id", campusId).maybeSingle() : query.limit(1).maybeSingle();
  const { data, error } = await query;
  throwIfError(error);
  return data || null;
}

// Two-step flow: upload the file + create an AWAITING_PAYMENT job (price is
// computed server-side from the rate card, never trusted from the browser),
// then the caller drives startPrintJobPayment() to actually charge for it.
// A job that's never paid for just expires (see 20260817001200_printing_v2.sql).
export async function uploadPrintJob({
  userId,
  file,
  pages = 1,
  copies = 1,
  colorMode = "black_white",
  paperSize = "A4",
  binding = "none",
  duplex = false,
}) {
  if (!userId) {
    throw new Error("Please sign in first.");
  }

  validatePrintFile(file);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("print-files")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });

  throwIfError(uploadError);

  // Price is computed server-side from the campus rate card inside
  // create_print_job() (doc §29, §66) -- calculatePrintJobPrice() is only
  // used for the pre-upload UI estimate, never as the charged amount.
  // `file_url` stores the storage path; only the owner or print.manage/admin
  // can ever resolve it to a signed URL (storage RLS), never a raw link.
  const { data: job, error: jobError } = await supabase.rpc("create_print_job", {
    p_file_url: path,
    p_file_name: file.name,
    p_pages: Number(pages),
    p_copies: Number(copies),
    p_color_mode: colorMode,
    p_paper_size: paperSize,
    p_binding: binding || "none",
    p_duplex: Boolean(duplex),
    p_file_size_bytes: file.size ?? null,
  });

  if (jobError) {
    await supabase.storage.from("print-files").remove([path]);
    throw new Error(jobError.message || "Unable to create print job");
  }

  return job;
}

// Mirrors startFoodOrderPayment() -- asks create-razorpay-order for a
// gateway order to open Checkout against; the job only actually becomes
// UPLOADED (visible to the print shop) once razorpay-webhook verifies the
// payment server-side.
export async function startPrintJobPayment(printJobId) {
  const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
    body: { print_job_id: printJobId },
  });
  if (error) throw new Error(error.message || "Unable to start payment");
  return data; // { key_id, gateway_order_id, amount, currency, payment_id }
}

// Self-service cancellation (doc §29 "Cancellation"/"Refund"). Only legal
// before printing has actually started -- see cancel_print_job()'s own
// status check. If a captured payment existed, a 'pending' refund row comes
// back too; the caller is expected to immediately drive it through the
// razorpay-refund Edge Function the same way a vendor-initiated food refund
// does (see startPrintJobRefund below).
export async function cancelPrintJob(jobId, reason) {
  const { data, error } = await supabase.rpc("cancel_print_job", {
    p_job_id: jobId,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data; // { job, refund_id }
}

export async function startPrintJobRefund(refundId) {
  const { data, error } = await supabase.functions.invoke("razorpay-refund", {
    body: { refund_id: refundId },
  });
  if (error) throw new Error(error.message || "Unable to process refund");
  return data;
}

// A student re-opening their own past job's file (e.g. to confirm what they
// uploaded) -- same signed-URL convention as documents/club-files/message
// attachments (300s). Storage RLS already restricts this to the owner.
export async function getMyPrintFileUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("print-files").createSignedUrl(path, 300);
  throwIfError(error);
  return data?.signedUrl || null;
}

export async function getMyPrintJobs(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

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

  // Doc §9 "Offline Mode": only cache/serve the first page -- same
  // reasoning as getCampusEvents' cursor guard above.
  const cacheKey = cursor ? null : `notifications:${userId}`;

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
      if (cacheKey) {
        const cached = await cacheRead(cacheKey);
        if (cached) return cached.data;
      }
      return [];
    }

    const notifications = (data || []).map(
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

    if (cacheKey) cacheWrite(cacheKey, notifications);
    return notifications;
  } catch (err) {
    console.warn("getUserNotifications catch:", err);
    if (cacheKey) {
      const cached = await cacheRead(cacheKey);
      if (cached) return cached.data;
    }
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
   Every .subscribe() in this app used to pass no status callback at all --
   a CHANNEL_ERROR or TIMED_OUT (dropped websocket, RLS misconfig, etc.) was
   silently invisible. realtimeStatusLogger() is the shared callback: pass
   its return value into .subscribe(...) at every channel call site (here
   and in the other services that open channels) to report those into
   error_logs (category 'realtime') without changing any channel's own
   postgres_changes wiring.
========================================================================= */
export function realtimeStatusLogger(label) {
  return (status, err) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      logClientError(`Realtime channel error: ${label} (${status})`, {
        severity: "warning",
        category: "realtime",
        context: { channel: label, error: err?.message },
      });
    }
  };
}

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
      .subscribe(realtimeStatusLogger("notifications"));

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
      .subscribe(realtimeStatusLogger("orders"));

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
    .subscribe(realtimeStatusLogger("posts"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToEvents(callback) {
  const channel = supabase
    .channel("public:events_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "event_registrations" }, callback)
    .subscribe(realtimeStatusLogger("events"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToFood(callback) {
  const channel = supabase
    .channel("public:food_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "canteens" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "food_items" }, callback)
    .subscribe(realtimeStatusLogger("food"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToClubs(callback) {
  const channel = supabase
    .channel("public:clubs_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "clubs" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "club_members" }, callback)
    .subscribe(realtimeStatusLogger("clubs"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToMarketplace(callback) {
  const channel = supabase
    .channel("public:marketplace_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "marketplace_listings" }, callback)
    .subscribe(realtimeStatusLogger("marketplace"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToLostFound(callback) {
  const channel = supabase
    .channel("public:lost_found_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "lost_found_items" }, callback)
    .subscribe(realtimeStatusLogger("lost_found"));

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
    .subscribe(realtimeStatusLogger("sos_alerts"));

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

/* =========================================================================
   CAMPUS EMERGENCY DIRECTORY (supabase/migrations/20260817000100_emergency_directory.sql)
   -- verified campus office contacts (security/medical/facilities/transport/
   hostel), distinct from the next-of-kin emergency_contacts above. Backend
   shipped 2026-08-17; this is its first frontend consumer.
========================================================================= */

export async function listEmergencyDirectory() {
  const { data, error } = await supabase.rpc("list_emergency_directory");
  throwIfError(error);
  return data || [];
}

export async function adminListEmergencyDirectory() {
  const { data, error } = await supabase.rpc("admin_list_emergency_directory");
  throwIfError(error);
  return data || [];
}

export async function upsertEmergencyDirectoryEntry({
  id = null, category, name, designation, description, phone, altPhone, email,
  location, priority = "standard", is24x7 = false, weeklyHours = null, hoursNote,
  campusId = null, displayOrder = 0,
}) {
  const { data, error } = await supabase.rpc("upsert_emergency_directory_entry", {
    p_id: id, p_category: category, p_name: name, p_designation: designation || null,
    p_description: description || null, p_phone: phone, p_alt_phone: altPhone || null,
    p_email: email || null, p_location: location || null, p_priority: priority,
    p_is_24x7: !!is24x7, p_weekly_hours: weeklyHours, p_hours_note: hoursNote || null,
    p_campus_id: campusId, p_display_order: displayOrder,
  });
  throwIfError(error);
  return data;
}

export async function verifyEmergencyDirectoryEntry(id, verified, notes = null) {
  const { data, error } = await supabase.rpc("verify_emergency_directory_entry", { p_id: id, p_verified: verified, p_notes: notes });
  throwIfError(error);
  return data;
}

export async function setEmergencyDirectoryActive(id, active) {
  const { data, error } = await supabase.rpc("set_emergency_directory_active", { p_id: id, p_active: active });
  throwIfError(error);
  return data;
}

// campuses.support_email/support_phone (20260818001100_campus_settings.sql)
// existed unused until this pass -- every other "contact support" surface
// (SOS, tickets, appeals) had nowhere campus-specific to point to.
export async function getCampusContactInfo(campusId) {
  if (!campusId) return null;
  const { data, error } = await supabase.from("campuses").select("support_email, support_phone").eq("id", campusId).maybeSingle();
  throwIfError(error);
  return data;
}

/* =========================================================================
   SUPPORT TICKETS (supabase/migrations/20260819000600_support_tickets.sql)
========================================================================= */

export async function createSupportTicket({ category, subject, description, attachmentUrl = null }) {
  const { data, error } = await supabase.rpc("create_support_ticket", {
    p_category: category, p_subject: subject, p_description: description || "", p_attachment_url: attachmentUrl,
  });
  throwIfError(error);
  return data;
}

// support-media is a private bucket (20260819001100_support_priority_
// escalation_attachments.sql) -- a payment/account screenshot can carry
// personal info, so unlike post-media/lost-found-media this is never
// public-read. Stores the object path, not a public URL; the path is what
// gets saved on the message row, and getSupportAttachmentUrl() below signs
// it on demand for whoever's allowed to see it.
export async function uploadSupportAttachment(file, ownerId) {
  if (!ownerId) throw new Error("Please sign in first.");
  const compressed = await compressImage(file);
  const path = `${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from("support-media").upload(path, compressed, { contentType: "image/jpeg" });
  logStorageErrorIfAny("support-media", error);
  throwIfError(error);
  return path;
}

export async function getSupportAttachmentUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("support-media").createSignedUrl(path, 3600);
  throwIfError(error);
  return data?.signedUrl || null;
}

export async function getMySupportTickets(userId) {
  const { data, error } = await supabase.from("support_tickets").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

export async function listSupportTicketsAdmin({ status = null } = {}) {
  let query = supabase.from("support_tickets")
    .select("*, reporter:profiles!support_tickets_user_id_fkey(name,email), assignee:profiles!support_tickets_assigned_to_fkey(name)")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function getSupportTicketMessages(ticketId) {
  const { data, error } = await supabase.from("support_ticket_messages")
    .select("*, sender:profiles!support_ticket_messages_sender_id_fkey(name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function addSupportTicketMessage(ticketId, body, attachmentUrl = null) {
  const { data, error } = await supabase.rpc("add_support_ticket_message", { p_ticket_id: ticketId, p_body: body, p_attachment_url: attachmentUrl });
  throwIfError(error);
  return data;
}

export async function setSupportTicketStatus(ticketId, status) {
  const { data, error } = await supabase.rpc("set_support_ticket_status", { p_ticket_id: ticketId, p_status: status });
  throwIfError(error);
  return data;
}

export async function setSupportTicketPriority(ticketId, priority) {
  const { data, error } = await supabase.rpc("set_support_ticket_priority", { p_ticket_id: ticketId, p_priority: priority });
  throwIfError(error);
  return data;
}

// Owner or staff; sets priority to urgent and notifies the support.manage/
// admin pool for the ticket's campus (see the RPC's own header for why
// there's no separate escalation tier).
export async function escalateSupportTicket(ticketId, reason = "") {
  const { data, error } = await supabase.rpc("escalate_support_ticket", { p_ticket_id: ticketId, p_reason: reason || null });
  throwIfError(error);
  return data;
}

export async function assignSupportTicket(ticketId, staffId) {
  const { data, error } = await supabase.rpc("assign_support_ticket", { p_ticket_id: ticketId, p_staff_id: staffId });
  throwIfError(error);
  return data;
}

/* =========================================================================
   SUPPORT / HELP CENTRE FAQ (supabase/migrations/20260819001200_support_faq.sql)
========================================================================= */

// Public read (works signed-out) -- global rows (campus_id null) plus
// whatever's scoped to the caller's own campus, same fallback shape as
// getCampusContactInfo above.
export async function getSupportFaqs(campusId) {
  let query = supabase.from("support_faqs").select("*").eq("is_active", true).order("category").order("sort_order");
  const { data, error } = campusId
    ? await query.or(`campus_id.is.null,campus_id.eq.${campusId}`)
    : await query.is("campus_id", null);
  throwIfError(error);
  return data || [];
}

export async function adminListSupportFaqs() {
  const { data, error } = await supabase.from("support_faqs").select("*").order("category").order("sort_order");
  throwIfError(error);
  return data || [];
}

export async function adminUpsertSupportFaq({ id = null, campusId = null, category, question, answer, sortOrder = 0, isActive = true }) {
  const { data, error } = await supabase.rpc("admin_upsert_support_faq", {
    p_id: id, p_campus_id: campusId, p_category: category, p_question: question,
    p_answer: answer, p_sort_order: sortOrder, p_is_active: isActive,
  });
  throwIfError(error);
  return data;
}

export async function adminDeleteSupportFaq(id) {
  const { error } = await supabase.rpc("admin_delete_support_faq", { p_id: id });
  throwIfError(error);
}

/* =========================================================================
   RESOURCE CATALOG MANAGEMENT (supabase/migrations/20260819000400_resource_management.sql)
========================================================================= */

export async function listResourcesAdmin(campusId) {
  let query = supabase.from("resources").select("*, locations(name)").order("name");
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function upsertResourceAdmin({
  id = null, campusId, name, resourceType, locationId = null, capacity = null,
  openingHours = null, approvalRequired = false, bufferMinutes = 0, available = true,
}) {
  const { data, error } = await supabase.rpc("admin_upsert_resource", {
    p_id: id, p_campus_id: campusId, p_name: name, p_resource_type: resourceType || null,
    p_location_id: locationId, p_capacity: capacity, p_opening_hours: openingHours,
    p_approval_required: !!approvalRequired, p_buffer_minutes: bufferMinutes, p_available: !!available,
  });
  throwIfError(error);
  return data;
}

export async function deleteResourceAdmin(id) {
  const { error } = await supabase.rpc("admin_delete_resource", { p_id: id });
  throwIfError(error);
}

/* =========================================================================
   VENDOR MANAGER ACCOUNTS -- store/print (supabase/migrations/
   20260819000300_vendor_manager_accounts.sql). Canteen's equivalents
   (listCanteenStaffAccounts/add/removeCanteenStaffAccount) already live in
   src/features/vendor/api.js -- these two extend the same mechanism to
   store and print.
========================================================================= */

export async function listStoreStaffAccounts(storeId) {
  const { data, error } = await supabase.from("store_staff_accounts").select("*, profiles(name,email)").eq("store_id", storeId);
  throwIfError(error);
  return data || [];
}

export async function addStoreStaffAccount(storeId, email) {
  const { data, error } = await supabase.rpc("add_store_staff_account", { p_store_id: storeId, p_email: email });
  throwIfError(error);
  return data;
}

export async function removeStoreStaffAccount(staffAccountId) {
  const { error } = await supabase.rpc("remove_store_staff_account", { p_staff_account_id: staffAccountId });
  throwIfError(error);
}

export async function listPrintStaffAccounts(campusId) {
  const { data, error } = await supabase.from("print_staff_accounts").select("*, profiles(name,email)").eq("campus_id", campusId);
  throwIfError(error);
  return data || [];
}

export async function addPrintStaffAccount(campusId, email) {
  const { data, error } = await supabase.rpc("add_print_staff_account", { p_campus_id: campusId, p_email: email });
  throwIfError(error);
  return data;
}

export async function removePrintStaffAccount(staffAccountId) {
  const { error } = await supabase.rpc("remove_print_staff_account", { p_staff_account_id: staffAccountId });
  throwIfError(error);
}

/* =========================================================================
   LOST & FOUND -- photo upload + matching (supabase/migrations/
   20260819000500_lost_found_matching.sql). Same compress-then-upload-then-
   getPublicUrl shape as uploadMarketplaceImage/uploadFoodImage, targeting
   the lost-found-media bucket that's existed unused since 20260814001500.
========================================================================= */

function compressLostFoundImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onerror = reject;
      img.onload = () => {
        const maxEdge = 1280;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadLostFoundImage(file, ownerId) {
  const blob = await compressLostFoundImage(file);
  const path = `${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from("lost-found-media").upload(path, blob, { contentType: "image/jpeg" });
  logStorageErrorIfAny("lost-found-media", error);
  throwIfError(error);
  const { data } = supabase.storage.from("lost-found-media").getPublicUrl(path);
  return data.publicUrl;
}

export async function createLostFoundItemWithImages({ userId, campusId, itemType, title, description, category, location, imageUrls = [] }) {
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
      image_urls: imageUrls,
    })
    .select()
    .single();

  throwIfError(error);
  return data;
}

export async function listLostFoundMatches(itemId) {
  const { data, error } = await supabase.rpc("list_lost_found_matches", { p_item_id: itemId });
  throwIfError(error);
  return data || [];
}
