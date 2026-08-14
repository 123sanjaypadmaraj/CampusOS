// Separate config for testing the LIVE deployed app with REAL Supabase
// sessions (see scripts/setup-test-users.mjs + tests/live/helpers/realSession.js)
// -- as opposed to playwright.config.cjs, which runs against the local dev
// server with a fully mocked backend. No webServer here: the target is
// already deployed.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/live',
  timeout: 45000,
  reporter: 'list',
  // These tests share one live backend/account set -- running spec files in
  // parallel causes real cross-test interference (event lists reordering
  // mid-test, notification lists accumulating between runs, etc.), not app
  // bugs. Keep it serial.
  workers: 1,
  use: {
    headless: true,
    baseURL: process.env.LIVE_URL || 'https://campusos-amber.vercel.app',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
  },
});
