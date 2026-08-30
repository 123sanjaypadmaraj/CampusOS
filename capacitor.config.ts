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
// build) -- there is no offline shell anymore. Revisit if that's a real
// problem: either point this back at a bundled dist/ build, or add an
// OTA JS-bundle updater (e.g. capacitor-updater) to get updates without
// requiring network on *every* launch. See docs/PLATFORM_ADAPTIVE_LAYOUT.md
// for how platform-specific chrome is wired on top of this one shared build.
const config: CapacitorConfig = {
  appId: 'in.edu.nhce.campusos',
  appName: 'CampusOS',
  webDir: 'dist',
  server: {
    url: 'https://campusos-amber.vercel.app',
    androidScheme: 'https',
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
  },
};

export default config;
