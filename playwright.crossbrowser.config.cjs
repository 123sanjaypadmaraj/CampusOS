// playwright.crossbrowser.config.cjs
//
// Runs the mocked-backend functional UI suite (tests/ui.test.js,
// tests/critical-order-flow.spec.js) across real browser-engine AND
// device-viewport combinations, as the automated stand-in for as much of
// the physical device/browser matrix as headless emulation can cover --
// see docs/DEVICE_SWEEP_SCRIPT.md for the short list of things that
// genuinely still need real hardware (real touch input, camera/file-
// picker chrome, autofill, landscape rotation).
//
// Six projects:
//   - Desktop Chrome / Desktop Firefox / Desktop Safari (WebKit) -- desktop
//     engine coverage, matching the "desktop Firefox" leg of the device
//     sweep doc.
//   - Pixel 7 -- Chromium + a real Android viewport/UA/touch profile, a
//     proxy for "Android phone".
//   - iPhone 14 -- WebKit + a real iOS viewport/UA/touch profile, a proxy
//     for "iPhone (Safari)" -- the one non-Chrome-family browser this app
//     has ever shipped to.
//   - iPad Mini -- WebKit + a real tablet viewport/touch profile, coverage
//     the manual device sweep doc never had at all.
//
// A dedicated port (5180) so it can't collide with an unrelated dev
// server another project on this machine already has bound to 5173, and
// so it can run alongside playwright.config.cjs or
// playwright.responsive.config.cjs (port 5181) at the same time.
//
// Run: npm run test:ui:crossbrowser
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['ui.test.js', 'critical-order-flow.spec.js'],
  timeout: 60000,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  retries: 0,
  // Several tests write to the same screenshots/ directory (pre-existing
  // convention, not parallel-safe on all filesystems) -- run serially.
  workers: 1,
  use: {
    headless: true,
    baseURL: 'http://localhost:5180',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-safari', use: { ...devices['Desktop Safari'] } },
    { name: 'android-pixel7', use: { ...devices['Pixel 7'] } },
    { name: 'ios-iphone14', use: { ...devices['iPhone 14'] } },
    { name: 'ipad-mini', use: { ...devices['iPad Mini'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
