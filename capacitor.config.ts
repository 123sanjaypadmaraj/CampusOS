import type { CapacitorConfig } from '@capacitor/cli';

// Native wrapper for the same web app (src/App.jsx). `server.url` points the
// shell straight at production (campusos-amber.vercel.app) instead of
// loading a bundled dist/ offline -- this is deliberate, not a leftover dev
// setting: CampusOS isn't on the Play Store yet (see
// android/RELEASE_BACKUP_CHECKLIST.md), so a store auto-update channel
// doesn't exist, and the previous fully-offline build meant a `vercel
// --prod` deploy and the installed APK were completely decoupled -- users
// would only ever see whatever web build happened to be bundled at APK
// install time. Loading the live URL means every production push is
// instantly what the app shows, same as opening the site in a browser tab,
// with no separate APK rebuild/republish step required for web-only
// changes. `webDir: 'dist'` is kept so `npx cap sync` still has a build to
// copy (native plugin config, icons, etc.) -- it's just not what gets
// loaded at runtime. Trade-off: the app now needs network on cold start
// (it already needed network for every Supabase call, same as the web
// build) -- there is no offline shell anymore. `server.errorPath` below
// covers the failure mode (a branded "you're offline" screen instead of a
// blank/generic WebView error page) but doesn't remove the dependency --
// revisit if that's still a real problem: either point this back at a
// bundled dist/ build, or add an OTA JS-bundle updater (e.g.
// capacitor-updater) to get updates without requiring network on *every*
// launch. See docs/PLATFORM_ADAPTIVE_LAYOUT.md for how platform-specific
// chrome is wired on top of this one shared build.
const config: CapacitorConfig = {
  appId: 'in.edu.nhce.campusos',
  appName: 'CampusOS',
  webDir: 'dist',
  server: {
    url: 'https://campusos-amber.vercel.app',
    androidScheme: 'https',
    // Capacitor's own WebViewClient auto-redirects the main frame here on
    // any load failure (no connectivity, DNS failure, 5xx from Vercel) --
    // see BridgeWebViewClient#onReceivedError/onReceivedHttpError in
    // @capacitor/android. Served from the bundled webDir via Capacitor's
    // local webserver, not from the network, so it renders even with zero
    // connectivity. public/offline.html has the branded copy + retry.
    errorPath: 'offline.html',
  },
  backgroundColor: '#faf9fc',
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#faf9fc',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    // Without this, iOS silently drops a push that arrives while the app is
    // already in the foreground -- no banner, no sound, nothing (the OS
    // assumes the app itself will handle it, which is what
    // pushNotificationReceived in src/services/pushService.js does with an
    // in-app toast, but the system alert is still worth showing too).
    // Android has no such flag; it always needs local handling to show
    // anything in the foreground, which is the same listener's job.
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
