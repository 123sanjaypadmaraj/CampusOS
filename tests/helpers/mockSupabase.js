// tests/helpers/mockSupabase.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The Playwright test process doesn't get Vite's import.meta.env -- read
// VITE_SUPABASE_URL straight out of .env so the fake session is seeded
// under the exact localStorage key (`sb-<project-ref>-auth-token`) the
// app's real Supabase client (constructed from the same .env) will look
// for. Falls back to a placeholder if .env is missing (e.g. in CI without
// secrets), which still produces a *consistent* mismatch rather than a
// silently-wrong one -- tests will fail loudly instead of "looking logged
// in" without actually exercising the auth-gated code paths.
function readSupabaseUrlFromEnv() {
  try {
    const envPath = path.resolve(__dirname, '..', '..', '.env');
    const contents = fs.readFileSync(envPath, 'utf8');
    const match = contents.match(/^VITE_SUPABASE_URL=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}
//
// Playwright E2E tests run against the local Vite dev server with NO live
// Supabase project behind them (this environment has no service credentials
// to provision one, and doc §94 says never test against production anyway).
// Instead of shipping an auth bypass in the app itself -- which is exactly
// the "kingpin" backdoor this hardening pass removed -- the bypass lives
// here, in the test harness, where it belongs.
//
// Route registration order matters in Playwright: the LAST route registered
// is tried FIRST. Register broad catch-alls before specific overrides.

const FAKE_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "test.student@nhce.edu.in",
  role: "authenticated",
  app_metadata: {},
  user_metadata: { name: "Test Student" },
};

const FAKE_CAMPUS = { id: "22222222-2222-4222-8222-222222222222", name: "New Horizon College of Engineering", slug: "nhce" };

const FAKE_PROFILE = {
  id: FAKE_USER.id,
  campus_id: FAKE_CAMPUS.id,
  name: "Test Student",
  email: FAKE_USER.email,
  usn: "1NH22CS999",
  course: "Computer Science & Engineering",
  year: "3rd Year",
  role: "student",
  skills: [],
  open_to_projects: false,
};

// base64url-encode without padding, matching the format @supabase/auth-js's
// decodeJWT() expects (it validates each segment against BASE64URL_REGEX).
function base64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fakeSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  // access_token has to be a *real 3-part JWT shape* -- not just any string.
  // @supabase/auth-js's GoTrueClient calls decodeJWT() on the session's
  // access_token during its own internal session/expiry bookkeeping (e.g.
  // getClaims(), the periodic auto-refresh check), independent of anything
  // this test mocks at the network level. A plain string like
  // "e2e-fake-access-token" makes that decode throw ("Expected 3 parts in
  // JWT; got 1"), which the app's own error handling then surfaces as real
  // failures (food menu won't load, checkout silently never reaches the
  // order-creation RPC) -- found because it's timing-dependent on exactly
  // when GoTrueClient's internal check runs, so it passed on Chromium/
  // Firefox but reliably broke on WebKit in the same suite. The signature
  // segment is never verified client-side (this app has no real Supabase
  // project behind it in tests), so any base64url string there is fine.
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    sub: FAKE_USER.id,
    email: FAKE_USER.email,
    role: FAKE_USER.role,
    aud: "authenticated",
    exp: expiresAt,
    iat: Math.floor(Date.now() / 1000),
  });
  const signature = base64url({ fake: true });

  return {
    access_token: `${header}.${payload}.${signature}`,
    refresh_token: "e2e-fake-refresh-token",
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: "bearer",
    user: FAKE_USER,
  };
}

/**
 * Seeds a fake signed-in Supabase session and mocks every network call the
 * app's initial bootstrap makes (auth, campus lookup, profile lookup), plus
 * a catch-all for everything else so unmocked reads degrade to "empty" and
 * unmocked writes degrade to a generic success instead of hanging or
 * throwing an uncaught network error.
 */
async function mockSignedInSession(page, { supabaseUrl = readSupabaseUrlFromEnv() || "https://mock.supabase.co" } = {}) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

  await page.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    { key: `sb-${projectRef}-auth-token`, session: fakeSession() }
  );

  // Disable the app's own service-worker registration (public/sw.js) for
  // the duration of the test. It has its own fetch handler that re-issues
  // requests via its own fetch() call inside the worker's execution
  // context -- found live because that passthrough can bypass Playwright's
  // page.route() mocking entirely (a real request escapes to the actual
  // network the test never intended to touch), which showed up as
  // supposedly-mocked RPC calls like get_my_access() coming back with a
  // genuine PGRST301 "wrong key type" error from the real Supabase project
  // instead of the fulfilled mock. It reproduced reliably under WebKit in
  // this suite; a Chromium/Firefox run happening not to trip it on a given
  // day is a timing accident, not proof the passthrough can't happen there
  // too. Offline/caching behavior is exactly what the service worker is
  // for, not something these UI tests are trying to exercise.
  await page.addInitScript(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register = () => Promise.reject(new Error("disabled for tests"));
    }
  });

  // Stub Razorpay's Checkout.js so payment tests never depend on the real
  // external script or a live gateway -- see src/features/payments/razorpay.ts.
  await page.addInitScript(() => {
    window.Razorpay = function FakeRazorpay(options) {
      this.options = options;
      this.open = () => {
        // Simulate the user completing checkout on the gateway's hosted
        // page: call the success handler on the next tick.
        setTimeout(() => options.handler?.({ razorpay_payment_id: "pay_e2e_fake" }), 10);
      };
    };
  });

  // --- broad catch-alls (registered first => tried last) -----------------
  // "**/rest/v1/rpc/**" is a SUBSET of "**/rest/v1/**", not a sibling of it,
  // so it has to be registered AFTER the general rest/v1 route to win
  // (Playwright tries the last-registered matching route first). Getting
  // this backwards is exactly what happened before: the general route's
  // POST fallback (`{}`) shadowed the RPC route's `null` for every RPC
  // call, so callers doing `data || []` on an RPC response got `{}` (an
  // object is truthy, `|| []` never kicks in) instead of `[]` -- invisible
  // until RecommendedForYou's `(items || []).filter(...)` on that `{}`
  // threw and took the whole app down behind the error boundary.
  await page.route("**/rest/v1/**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.route("**/rest/v1/rpc/**", (route) => route.fulfill({ json: null }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({ json: { user: FAKE_USER } }));

  // --- specific overrides (registered last => tried first) ---------------
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: { user: FAKE_USER } }));
  await page.route("**/rest/v1/campuses*", (route) => route.fulfill({ json: [FAKE_CAMPUS] }));
  await page.route("**/rest/v1/profiles*", (route) => route.fulfill({ json: [FAKE_PROFILE] }));

  return { FAKE_USER, FAKE_CAMPUS, FAKE_PROFILE };
}

export { mockSignedInSession, FAKE_USER, FAKE_CAMPUS, FAKE_PROFILE };
