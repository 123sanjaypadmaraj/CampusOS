# Native apps (iOS/Android) via Capacitor + platform-adaptive layout

CampusOS ships from **one** React codebase (`src/App.jsx` + `src/index.css`)
to three places: a plain browser tab, an installed iOS app, and an
installed Android app. [Capacitor](https://capacitorjs.com) wraps the same
production web build (`dist/`) in a native shell per platform — there is no
separate native codebase to keep in sync.

## How platform detection works

`src/App.jsx` computes a module-level constant once, the same way it
already has module-level constants like `navItems`/`ROUTABLE_KEYS`:

```js
const PLATFORM = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'
const IS_NATIVE = Capacitor.isNativePlatform();
```

`PLATFORM` is applied as a class on the root `.app-shell` div, right next
to the existing `dark-mode`/`light-mode` toggle it already does for theme:

```jsx
<div className={`app-shell ${darkMode ? "dark-mode" : "light-mode"} platform-${PLATFORM}`}>
```

`src/index.css` has a `PLATFORM-ADAPTIVE LAYOUT` block (search for that
heading) with rules scoped to `.platform-ios`/`.platform-android` only.
**`.platform-web` (the default, in every browser) has zero rules written
against it** — the existing floating pill bottom-nav and topbar render
exactly as they always have for web/PWA users. iOS gets an edge-to-edge
translucent/blurred tab bar (matching UIKit's default look); Android gets
a solid Material-style elevated bar. Both account for
`env(safe-area-inset-*)` (the iPhone notch/Dynamic Island, the
gesture-nav strip) — see `index.html`'s `viewport-fit=cover` meta tag,
which is what makes those `env()` values non-zero in the first place.

## What else is platform-gated

- **Service worker** (`public/sw.js`, offline app-shell cache + Web Push):
  skipped entirely on native (`if (IS_NATIVE) return;` before
  `navigator.serviceWorker.register(...)`) — Web Push doesn't work in an
  iOS WebView at all, and there's no separate offline app-shell to protect
  on native either now that the shell loads production directly (see
  below).
- **Native push notifications**: built via `@capacitor/push-notifications`
  (see `src/services/pushService.js`'s `IS_NATIVE` branches and
  `registerNativePushListeners()`, wired from `src/App.jsx`). The same
  `PushToggle` UI, `push_subscriptions` table, and `create_notification()` →
  trigger → `send-push` pipeline used for Web Push now also carries native
  tokens — the 20260831001200 migration added a `platform` column
  (`web`/`android`/`ios`) so `send-push` can route each subscription to the
  right gateway (Web Push, FCM, or APNs). **This is all code/plumbing only
  right now**: FCM needs a real Firebase project + `google-services.json` in
  `android/app/` + the `FCM_SERVICE_ACCOUNT_JSON` Edge Function secret, and
  APNs needs a Mac-built iOS app + an Apple Developer `.p8` key (
  `APNS_AUTH_KEY`/`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_BUNDLE_ID` secrets) —
  see the comment block at the top of `supabase/functions/send-push/index.ts`
  for the exact secret names and where to get each one. Until those are
  set, native push registration attempts fail gracefully (a clear in-app
  error, not a crash) and `send-push` just skips that platform's
  subscriptions with `GATEWAY_NOT_CONFIGURED`/`skipped` — Web Push
  continues to work unaffected either way.
- **Auto-updating on push to production**: `capacitor.config.ts` sets
  `server.url` to `https://campusos-amber.vercel.app` instead of bundling
  `dist/` offline, so the installed app always shows whatever is live in
  production — no separate APK rebuild/republish needed for web-only
  changes, and no Play Store listing needed for that either (there isn't
  one yet — see `android/RELEASE_BACKUP_CHECKLIST.md`). Trade-off: the app
  now needs network on cold start; there's no offline shell anymore. A
  new APK build/publish is still only needed for *native*-level changes
  (icons, permissions, native plugins, this config file itself).
- **Android hardware/gesture back button**: `@capacitor/app`'s
  `backButton` listener reuses the app's existing history-based navigation
  (`go()` → `history.pushState`, a `popstate` listener → `setActive(...)`)
  instead of building a second navigation stack — one step back just calls
  `window.history.back()`, and only exits the app from the root screen.
  No-op on iOS/web (iOS has no hardware back button).
- **Status bar / splash screen**: `@capacitor/status-bar` and
  `@capacitor/splash-screen` calls are guarded by `IS_NATIVE` and, for the
  status bar, kept in sync with the same `darkMode` state that already
  drives the rest of the theme. On Android 16 (`targetSdkVersion` 36),
  edge-to-edge is enforced by the OS and `StatusBar.setBackgroundColor()`
  becomes a no-op (see `shouldSetStatusBarColor()` in
  `@capacitor/status-bar`'s Android source) — the colored strip behind the
  transparent status bar comes from `.topbar`'s own background plus the
  `env(safe-area-inset-top)` padding above, not from that native call. Same
  story for the bottom: `.bottom-nav`'s background plus
  `env(safe-area-inset-bottom)` paints behind the transparent gesture-nav
  area, not any native API.
- **Native theme colors** (`android/app/src/main/res/values{,-night}/colors.xml`):
  `styles.xml`'s `AppTheme.NoActionBar` — the theme `BridgeActivity`
  actually applies at runtime, not the unused `AppTheme` above it — sets
  `colorPrimary`/`colorPrimaryDark`/`colorAccent` from these files. They
  didn't exist until this pass, so those items silently resolved to
  `@capacitor/android`'s own bundled library defaults (stock Material demo
  indigo `#3F51B5` / pink `#FF4081`, confirmed via the merged resource set
  under `node_modules/@capacitor/android`), not CampusOS purple. Fixed with
  real brand colors matching `src/index.css`'s `--purple`/`--purple-deep`/
  `--purple2` (light) and `--accent`/`--bg` under `.dark-mode` (night) —
  this is what tints the recents/task-switcher card and any native-chrome
  UI (autofill/selection popups). Verified end-to-end with `aapt2 dump
  resources` against a real `assembleDebug` build, and confirmed
  `assembleRelease`/`bundleRelease` still build and sign correctly
  afterward.

## Building the native apps

This repo can scaffold and sync the native projects with just Node (no
Android SDK or Xcode needed for `add`/`sync`), but actually **compiling,
running, or visually verifying** either app needs platform tooling this
environment doesn't have:

```bash
npm run build      # produces dist/
npx cap sync        # copies dist/ into android/ and ios/, updates plugin config
```

- **Android**: install Android Studio (it brings the SDK), then
  `npx cap open android` and run from there on an emulator or device.
- **iOS**: needs a Mac with Xcode. Plugins are wired via Swift Package
  Manager (no CocoaPods step was needed to add/sync on Windows), so
  `npx cap sync ios` then `npx cap open ios` should be enough — set a
  signing team in Xcode before running on a simulator/device.

## Known gaps / follow-up work

- **App icon/splash source art**: `assets/*.png` are generated from the
  real CampusOS logo mark (not placeholders — see `assets/README.md`), and
  every derived icon (Android mipmaps, iOS `AppIcon.appiconset`, PWA icons)
  was regenerated from it via `npx capacitor-assets generate`. The iOS
  1024×1024 `AppIcon-512@2x.png` is RGB with no alpha channel, matching
  Apple's requirement exactly.
- **Native push notifications** — the client and server code is built (see
  above), including the iOS `AppDelegate.swift` device-token forwarding
  Capacitor's plugin needs; only the FCM/APNs credentials themselves are
  missing, and those need a Firebase project + (for iOS) a paid Apple
  Developer account first.
- **Android**: submission-ready — see `android/RELEASE_BACKUP_CHECKLIST.md`.
- **iOS**: project config finalized (permission strings, push delegate
  methods, iPhone-only device family, real icon art) as far as possible
  without a Mac. Exact Xcode build/sign/submit steps, App Store Connect
  listing copy, App Privacy answers, and the screenshot set are in
  `ios/APP_STORE_SUBMISSION.md` — the actual Xcode build/archive/upload
  still needs a Mac with Xcode, which this repo has never had access to.
