// playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  // tests/live/** targets the deployed production app with real Supabase
  // sessions (see playwright.live.config.cjs) -- it must never run as part
  // of the mocked-backend suite this config drives.
  testIgnore: ['src/**', 'tests/live/**'],
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  retries: process.env.CI ? 1 : 0,
  // Several tests write to the same screenshots/ directory (pre-existing
  // convention, not parallel-safe on all filesystems) -- run serially.
  workers: 1,
  use: {
    headless: true,
    baseURL: 'http://localhost:5173',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
