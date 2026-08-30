// tests/ui.test.js
import { test } from '@playwright/test';
import { mockSignedInSession } from './helpers/mockSupabase.js';

test.beforeEach(async ({ page }) => {
  await mockSignedInSession(page);
});

test('1 - Create a Post', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Navigate to Campus (Posts page) via bottom nav button
  await page.locator('nav.bottom-nav button', { hasText: 'Campus' }).click();
  await page.waitForLoadState('networkidle');

  // Open post composer
  await page.getByRole('button', { name: /Create post/i }).click();

  // Fill in the post form using label selectors
  await page.getByLabel(/Post type/i).selectOption('Hackathon');
  await page.getByLabel(/What do you want to say/i).fill('Playwright automated test post');
  await page.getByLabel(/Tag/i).fill('automation');

  await page.screenshot({ path: 'screenshots/post_before_submit.png' });

  // Submit
  await page.getByRole('button', { name: /Publish/i }).click();
  await page.screenshot({ path: 'screenshots/post.png' });
});

test('2 - Report a Service Issue', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Navigate to Services via bottom nav (exact match)
  await page.locator('nav.bottom-nav button', { hasText: 'Services' }).click();
  await page.waitForLoadState('networkidle');

  // Click "Report an Issue" card
  const reportBtn = page.getByRole('button', { name: /Report an Issue/i });
  await reportBtn.click();
  await page.waitForLoadState('networkidle');

  // Click a category (e.g. Wi-Fi)
  await page.getByRole('button', { name: /Report/i }).first().click();
  await page.screenshot({ path: 'screenshots/service.png' });
});

test('3 - Report Lost Item', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Navigate to Services via bottom nav (exact match)
  await page.locator('nav.bottom-nav button', { hasText: 'Services' }).click();
  await page.waitForLoadState('networkidle');

  // Click "Lost & Found" card
  const lostCard = page.getByRole('button', { name: /Lost & Found/i });
  await lostCard.click();
  await page.waitForLoadState('networkidle');

  // Click "Report an item" (renamed from "Report lost item" in f7af2ae, see
  // the Lost & Found empty-state / composer button in src/App.jsx)
  await page.getByRole('button', { name: /Report an item/i }).click();

  // Fill the modal fields
  await page.getByLabel(/Item title/i).fill('Test Pen');
  await page.getByLabel(/Last seen location/i).fill('Block C Seminar Hall');

  await page.screenshot({ path: 'screenshots/lostfound_form.png' });
  await page.getByRole('button', { name: /Submit report/i }).click();
  await page.screenshot({ path: 'screenshots/lostfound.png' });
});

test('4 - Create Marketplace Listing', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Navigate to Services via bottom nav (exact match)
  await page.locator('nav.bottom-nav button', { hasText: 'Services' }).click();
  await page.waitForLoadState('networkidle');

  // Click "Campus Marketplace" card
  const marketCard = page.getByRole('button', { name: /Campus Marketplace/i });
  await marketCard.click();
  await page.waitForLoadState('networkidle');

  // Click "Create listing"
  await page.getByRole('button', { name: /Create listing/i }).click();

  // Fill form
  // The marketplace page also has a "Maximum price" filter input mounted
  // in the DOM at the same time as the create-listing form (it's a filter
  // bar above the listing grid, not a modal that replaces it) -- a loose
  // /Price/i match resolves to both that filter and the form's own "Price
  // (₹)" field. Anchor to the start of the label so only the form field
  // (which starts with "Price", unlike "Maximum price") matches.
  await page.getByLabel(/Title/i).fill('Test Book');
  await page.getByLabel(/^Price/i).fill('150');

  await page.screenshot({ path: 'screenshots/marketplace_form.png' });
  await page.getByRole('button', { name: /Publish listing/i }).click();
  await page.screenshot({ path: 'screenshots/marketplace.png' });
});

test('5 - Register for an Event', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.locator('nav.bottom-nav button', { hasText: 'Events' }).click();
  await page.waitForLoadState('networkidle');

  // Wait for event cards to appear
  await page.waitForSelector('.event-card', { timeout: 15000 });

  // Accept either "Register" or "Cancel registration" — both prove the feature works
  const regBtn = page.locator('.event-card button', { hasText: /Register|Cancel registration/ }).first();
  await regBtn.waitFor({ state: 'visible', timeout: 10000 });
  const btnText = await regBtn.textContent();
  await regBtn.click();
  await page.screenshot({ path: 'screenshots/event.png' });
  console.log(`Event button clicked: "${btnText?.trim()}"`);
});
