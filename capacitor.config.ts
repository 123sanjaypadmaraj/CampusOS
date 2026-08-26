import type { CapacitorConfig } from '@capacitor/cli';

// Native wrapper for the same web app (src/App.jsx) served from a locally
// bundled dist/ -- no remote server.url, so the app works fully offline for
// its own shell (Supabase calls still go out over the network as regular
// HTTPS/WebSocket requests, same as the web build). See
// docs/PLATFORM_ADAPTIVE_LAYOUT.md for how platform-specific chrome is
// wired on top of this one shared build.
const config: CapacitorConfig = {
  appId: 'in.edu.nhce.campusos',
  appName: 'CampusOS',
  webDir: 'dist',
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
