// playwright.responsive.config.cjs
//
// Runs tests/responsive.spec.js -- breakpoint-precision CSS/layout
// regression checks -- across every CSS breakpoint in src/index.css and
// all three engines Playwright ships (Chromium, Firefox, WebKit), as
// proxies for Chrome/Android, desktop Firefox, and Safari/iOS
// respectively. See docs/DEVICE_SWEEP_SCRIPT.md for what this can't
// replace (real touch input, real device chrome, real hardware).
//
// A dedicated port (5181) so this can run alongside the default mocked-
// backend suite (playwright.config.cjs, port 5173) or the cross-browser
// functional suite (playwright.crossbrowser.config.cjs, port 5180)
// without colliding with a dev server another project on this machine
// already has bound.
//
// Run: npm run test:ui:responsive
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['responsive.spec.js'],
  timeout: 60000,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  retries: 0,
  // Each test drives its own page.setViewportSize() -- keep workers
  // serial per project so a resized viewport in one test can never bleed
  // into a concurrently-running one on a shared worker.
  workers: 1,
  use: {
    headless: true,
    baseURL: 'http://localhost:5181',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5181 --strictPort',
    url: 'http://localhost:5181',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
