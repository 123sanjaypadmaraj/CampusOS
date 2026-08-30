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
  below). Native push notifications are a separate, not-yet-built
  follow-up (would need `@capacitor/push-notifications` + APNs/FCM
  credentials + extending `push_subscriptions`/`supabase/functions/send-push`
  to route native tokens, not just Web Push endpoints).
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
  drives the rest of the theme.

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

- **App icon/splash source art**: `assets/icon.png` etc. are placeholders
  upscaled from the existing 512×512 PWA icon (`public/icons/icon-512.png`)
  — the largest source art in the repo. Apple's App Store wants a real
  1024×1024 icon with no transparency; replace `assets/*.png` with real art
  and re-run `npx capacitor-assets generate` before submitting to either
  store. See `assets/README.md`.
- **Native push notifications** — not built yet, see above.
- **App Store / Play Store listings, signing keys, submission** — not
  attempted from this repo.
