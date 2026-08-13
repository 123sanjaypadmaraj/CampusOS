// playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  testIgnore: ['src/**'],
  use: {
    headless: true,
    baseURL: 'http://localhost:1234',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
  },
});
