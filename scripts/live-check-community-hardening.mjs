// Live verification script for the "Community hardening" pass (saved
// posts, real post image upload, profanity filtering, duplicate/spam
// content detection, suspension appeals) --
// supabase/migrations/20260818000600_community_hardening.sql. Everything
// else on the original Community checklist (posts/comments/replies, likes,
// reporting, blocking, moderation, rate limiting, account suspension,
// content-removal audit trail) already existed and is covered by
// live-check-community-discovery.mjs and the app's own pre-existing tests --
// not re-verified here.
//
// Environment-aware (see docs/ENVIRONMENTS.md): defaults to staging, same
// as every other script in this directory.
//
// Usage: node scripts/live-check-community-hardening.mjs
//        node scripts/live-check-community-hardening.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, target, sessionsFile, root } = resolveTarget();

// e2e.alice/bob/carol no longer have fixed hardcoded passwords (see the
// 2026-08-18 credential-rotation incident in SECURITY.md) -- read the
// current ones from the same gitignored file scripts/setup-test-users.mjs
// itself reads/writes, same convention as every other live-check script
// written since that rotation.
const isStaging = sessionsFile.includes(".staging.");
const credsFile = sessionsFile.replace(/\.sessions(\.staging)?\.json$/, `.e2e-credentials${isStaging ? ".staging" : ""}.local.json`);
const creds = JSON.parse(fs.readFileSync(credsFile, "utf8"));
const passwordFor = (email) => {
  const found = creds.find((r) => r.email === email)?.password;
  if (!found) throw new Error(`No saved password for ${email} in ${credsFile} -- run scripts/setup-test-users.mjs first.`);
  return found;
};

const ALICE = { email: "e2e.alice@nhce.edu.in", password: passwordFor("e2e.alice@nhce.edu.in") };
const BOB = { email: "e2e.bob@nhce.edu.in", password: passwordFor("e2e.bob@nhce.edu.in") };

// Admin's password isn't a fixed constant either -- see setup-admin-account.mjs's
// header for why (an earlier version hardcoded "Sanjay@123" here; compromised).
const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
const adminCredsPath = path.join(root, "scripts", adminCredsFile);
if (!fs.existsSync(adminCredsPath)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first (the account already exists, so a plain run won't write this file).`);
const ADMIN = { email: "1nh25cs265@usn.campusos.internal", password: JSON.parse(fs.readFileSync(adminCredsPath, "utf8")).password };

let passCount = 0;
let failCount = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  [pass] ${label}`);
    passCount++;
  } else {
    console.log(`  [FAIL] ${label}${extra !== undefined ? ` -- ${JSON.stringify(extra)}` : ""}`);
    failCount++;
  }
}

async function signIn({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

function client(token) {
  const headers = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${token}` };
  return {
    async rpc(name, args = {}) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
    async post(table, body, extraHeaders = {}) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation", ...extraHeaders },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
    async get(table, query) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
    async del(table, query) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { method: "DELETE", headers });
      return { ok: res.ok, status: res.status };
    },
    async uploadImage(path, bytes) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/post-media/${path}`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
        body: bytes,
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
  };
}

const svc = client(SERVICE_ROLE_KEY);

// The smallest possible valid PNG (1x1 transparent pixel) -- enough to
// exercise the real storage upload path (bucket policy, owner-folder scoping)
// without depending on a real image asset in the repo.
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function cleanupPost(title) {
  await svc.del("posts", `title=eq.${encodeURIComponent(title)}`);
}

async function main() {
  console.log(`Running against ${target}…`);
  console.log("Signing in test accounts…");
  const alice = await signIn(ALICE);
  const bob = await signIn(BOB);
  const admin = await signIn(ADMIN);
  const aliceC = client(alice.token);
  const bobC = client(bob.token);
  const adminC = client(admin.token);

  const { data: campuses } = await svc.get("campuses", "select=id,slug&slug=eq.nhce&limit=1");
  const campusId = campuses[0].id;

  // Clean up any leftover fixtures from a previous run before starting.
  await cleanupPost("E2E hardening post");
  await cleanupPost("E2E hardening post two");
  await cleanupPost("E2E hardening post near-dup");

  /* ===================== PROFANITY FILTER ===================== */
  console.log("\n=== Profanity filter ===");

  const profanePost = await aliceC.post("posts", {
    author_id: alice.userId, campus_id: campusId, title: "This is fucking spam", content: "test",
  });
  check("a post containing a banned word is rejected", !profanePost.ok, profanePost.data);
  check("...with the PROFANITY_DETECTED code", JSON.stringify(profanePost.data || "").includes("PROFANITY_DETECTED"), profanePost.data);

  const cleanPost = await aliceC.post("posts", {
    author_id: alice.userId, campus_id: campusId, title: "E2E hardening post", content: "a perfectly clean post about robotics",
  });
  check("a clean post is accepted", cleanPost.ok, cleanPost.data);
  const cleanPostId = cleanPost.data?.[0]?.id;

  const profaneComment = cleanPostId
    ? await bobC.post("comments", { author_id: bob.userId, post_id: cleanPostId, content: "what bullshit" })
    : { ok: false };
  check("a comment containing a banned word is rejected", !profaneComment.ok, profaneComment.data);

  const addWord = await adminC.rpc("admin_add_banned_word", { p_word: "e2etestbannedword" });
  check("admin can add a word to the profanity filter", addWord.ok, addWord.data);
  const studentAddWord = await aliceC.rpc("admin_add_banned_word", { p_word: "shouldnotwork" });
  check("a plain student cannot manage the profanity filter", !studentAddWord.ok, studentAddWord.data);

  const nowBlocked = await aliceC.post("posts", {
    author_id: alice.userId, campus_id: campusId, title: "E2E hardening post two", content: "contains e2etestbannedword right here",
  });
  check("a freshly-admin-added word is enforced immediately", !nowBlocked.ok, nowBlocked.data);

  const removeWord = await adminC.rpc("admin_remove_banned_word", { p_word: "e2etestbannedword" });
  check("admin can remove a word from the profanity filter", removeWord.ok, removeWord.data);
  const nowAllowed = await aliceC.post("posts", {
    author_id: alice.userId, campus_id: campusId, title: "E2E hardening post two", content: "contains e2etestbannedword right here",
  });
  check("the removed word no longer blocks a post", nowAllowed.ok, nowAllowed.data);
  if (nowAllowed.ok) await cleanupPost("E2E hardening post two");

  /* ===================== DUPLICATE / SPAM DETECTION ===================== */
  console.log("\n=== Duplicate / spam content detection ===");

  const nearDupPost = await aliceC.post("posts", {
    author_id: alice.userId, campus_id: campusId, title: "E2E hardening post", content: "a perfectly clean post about robotics",
  });
  check("posting near-identical content again within minutes is rejected as a duplicate", !nearDupPost.ok, nearDupPost.data);
  check("...with the DUPLICATE_POST code", JSON.stringify(nearDupPost.data || "").includes("DUPLICATE_POST"), nearDupPost.data);

  const differentPost = await aliceC.post("posts", {
    author_id: alice.userId, campus_id: campusId, title: "E2E hardening post near-dup", content: "a totally different unrelated topic about hostel wifi",
  });
  check("a genuinely different post from the same author is still accepted", differentPost.ok, differentPost.data);
  if (differentPost.ok) await cleanupPost("E2E hardening post near-dup");

  const firstComment = cleanPostId
    ? await bobC.post("comments", { author_id: bob.userId, post_id: cleanPostId, content: "thanks for sharing" })
    : { ok: false };
  check("a normal comment is accepted", firstComment.ok, firstComment.data);

  const dupComment = cleanPostId
    ? await bobC.post("comments", { author_id: bob.userId, post_id: cleanPostId, content: "thanks for sharing" })
    : { ok: false };
  check("posting the exact same comment again within minutes is rejected", !dupComment.ok, dupComment.data);
  check("...with the DUPLICATE_COMMENT code", JSON.stringify(dupComment.data || "").includes("DUPLICATE_COMMENT"), dupComment.data);

  /* ===================== SAVED POSTS ===================== */
  console.log("\n=== Saved posts ===");

  if (cleanPostId) {
    const save = await bobC.post("saved_posts", { post_id: cleanPostId, user_id: bob.userId });
    check("bob can save alice's post", save.ok, save.data);

    const saved = await bobC.get("saved_posts", `user_id=eq.${bob.userId}&post_id=eq.${cleanPostId}`);
    check("the saved post shows up in bob's saved list", saved.ok && saved.data?.length === 1, saved.data);

    const aliceReadsBobsSaves = await aliceC.get("saved_posts", `user_id=eq.${bob.userId}`);
    check("another user cannot read bob's saved-posts list (RLS own-only)", aliceReadsBobsSaves.ok && aliceReadsBobsSaves.data?.length === 0, aliceReadsBobsSaves.data);

    const unsave = await bobC.del("saved_posts", `post_id=eq.${cleanPostId}&user_id=eq.${bob.userId}`);
    check("bob can unsave it again", unsave.ok, unsave);
  }

  /* ===================== POST IMAGES (real storage upload) ===================== */
  console.log("\n=== Post images ===");

  const imgPath = `${alice.userId}/e2e-hardening-${Date.now()}.png`;
  const upload = await aliceC.uploadImage(imgPath, ONE_PX_PNG);
  check("a signed-in user can upload into their own post-media folder", upload.ok, upload.data);

  const bobUploadIntoAlicesFolder = await bobC.uploadImage(`${alice.userId}/should-not-work.png`, ONE_PX_PNG);
  check("a different user cannot upload into someone else's post-media folder", !bobUploadIntoAlicesFolder.ok, bobUploadIntoAlicesFolder.data);

  if (cleanPostId && upload.ok) {
    const patched = await fetch(`${SUPABASE_URL}/rest/v1/posts?id=eq.${cleanPostId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${alice.token}`, Prefer: "return=representation" },
      body: JSON.stringify({ image_urls: [`${SUPABASE_URL}/storage/v1/object/public/post-media/${imgPath}`] }),
    });
    const patchedBody = await patched.json().catch(() => null);
    check("image_urls round-trips on the post row", patched.ok && patchedBody?.[0]?.image_urls?.length === 1, patchedBody);
  }
  // Clean up the uploaded object regardless of pass/fail above.
  await fetch(`${SUPABASE_URL}/storage/v1/object/post-media/${imgPath}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  }).catch(() => {});

  /* ===================== SUSPENSION APPEALS ===================== */
  console.log("\n=== Suspension appeals ===");

  // Bob is temporarily suspended for this section only -- captured/restored
  // exactly like every other shared-account temporary-state test in this
  // repo (see live-check-academic-module.mjs's finally-block convention).
  try {
    const suspend = await adminC.rpc("admin_set_user_status", { p_target_user: bob.userId, p_status: "suspended", p_reason: "e2e hardening test" });
    check("admin can suspend bob", suspend.ok, suspend.data);

    const aliceAppealAttempt = await aliceC.rpc("submit_suspension_appeal", { p_reason: "I am not suspended" });
    check("a non-suspended user cannot submit an appeal", !aliceAppealAttempt.ok, aliceAppealAttempt.data);

    const appeal = await bobC.rpc("submit_suspension_appeal", { p_reason: "This was a mistake, please review" });
    check("a suspended user can submit an appeal", appeal.ok && appeal.data?.status === "pending", appeal.data);
    const appealId = appeal.data?.id;

    const dupAppeal = await bobC.rpc("submit_suspension_appeal", { p_reason: "Second attempt" });
    check("a second appeal is rejected while one is already pending", !dupAppeal.ok, dupAppeal.data);

    const mine = await bobC.rpc("get_my_suspension_appeal");
    check("bob can read his own appeal back", mine.ok && mine.data?.id === appealId, mine.data);

    const studentList = await aliceC.rpc("admin_list_suspension_appeals", { p_status: "pending" });
    check("a plain student cannot list suspension appeals", !studentList.ok, studentList.data);

    const adminList = await adminC.rpc("admin_list_suspension_appeals", { p_status: "pending" });
    check("admin can list pending appeals and sees bob's", adminList.ok && adminList.data?.some((a) => a.id === appealId), adminList.data);

    const studentResolve = await aliceC.rpc("resolve_suspension_appeal", { p_appeal_id: appealId, p_decision: "approved" });
    check("a plain student cannot resolve an appeal", !studentResolve.ok, studentResolve.data);

    const resolve = await adminC.rpc("resolve_suspension_appeal", { p_appeal_id: appealId, p_decision: "approved" });
    check("admin can approve the appeal", resolve.ok && resolve.data?.status === "approved", resolve.data);

    const profileAfter = await svc.get("profiles", `id=eq.${bob.userId}&select=status`);
    check("approving the appeal reactivates the account", profileAfter.data?.[0]?.status === "active", profileAfter.data);

    const doubleResolve = await adminC.rpc("resolve_suspension_appeal", { p_appeal_id: appealId, p_decision: "denied" });
    check("an already-resolved appeal cannot be resolved again", !doubleResolve.ok, doubleResolve.data);
  } finally {
    // Always leave bob active regardless of pass/fail above -- other
    // live-check scripts depend on this shared account.
    await svc.rpc("admin_set_user_status", { p_target_user: bob.userId, p_status: "active", p_reason: null });
    const restored = await svc.get("profiles", `id=eq.${bob.userId}&select=status`);
    check("(cleanup) bob's account is restored to active", restored.data?.[0]?.status === "active", restored.data);
  }

  /* ===================== CLEANUP ===================== */
  await cleanupPost("E2E hardening post");
  await cleanupPost("E2E hardening post two");
  await cleanupPost("E2E hardening post near-dup");

  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
