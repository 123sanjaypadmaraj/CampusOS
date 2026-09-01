// tests/responsive.spec.js
//
// Automated stand-in for readiness-audit phase 9's last open item (a
// physical device/browser matrix) -- see docs/DEVICE_SWEEP_SCRIPT.md for
// what genuinely still needs real hardware. This spec covers what
// browser automation *can* do reliably: precise viewport-width control
// and real computed-style assertions, run against every CSS breakpoint
// in src/index.css across all three rendering engines Playwright ships
// (Chromium, Firefox, WebKit -- proxies for Chrome/Android, desktop
// Firefox, and Safari/iOS respectively; see playwright.responsive.config.cjs).
//
// It is a regression test for one specific, recurring bug class this app
// has shipped three times: a later CSS rule of equal specificity silently
// clobbering an earlier `@media (max-width: ...)` rule's `display` value
// (see src/index.css's "UI REFRESH" comment, campusos-cross-device-pass,
// and campusos-bottom-nav-mobile-fix). scripts/check-css-cascade.mjs
// catches the same bug class statically, without a browser; this spec
// verifies the *rendered* result at real widths, which is what actually
// shipped to users.
//
// Run: npm run test:ui:responsive

import { test, expect } from '@playwright/test';
import { mockSignedInSession } from './helpers/mockSupabase.js';

// Every `max-width` breakpoint declared in src/index.css, plus a few
// representative widths above/below the extremes. Boundaries that have
// actually caused a live bug (620, 900) get a tight ±1px triplet so an
// off-by-one or cascade regression can't hide between two sampled widths;
// the rest get one representative width just above the breakpoint (where
// the mobile/compact rules are active).
const CRITICAL_BOUNDARIES = [620, 900];
const OTHER_WIDTHS = [375, 480, 600, 640, 720, 800, 1050, 1280, 1440];

const WIDTHS = [
  ...CRITICAL_BOUNDARIES.flatMap((bp) => [bp - 1, bp, bp + 1]),
  ...OTHER_WIDTHS,
].sort((a, b) => a - b);

const HEIGHT = 900; // tall enough that vertical scroll never masks a horizontal-overflow bug

for (const width of WIDTHS) {
  test.describe(`viewport ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await mockSignedInSession(page);
    });

    test('home page has no horizontal overflow', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      // +1px tolerance for sub-pixel rounding across engines.
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test('bottom-nav keeps its icon-over-label grid layout, never a cramped row', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const nav = page.locator('nav.bottom-nav');
      await expect(nav).toBeVisible();

      const buttons = nav.locator('button');
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const button = buttons.nth(i);
        // This is the exact root cause of the real, shipped bottom-nav bug
        // (campusos-bottom-nav-mobile-fix): a later batched selector set
        // `display:inline-flex` on `.bottom-nav button`, clobbering the
        // base rule's `display:grid` and crushing the label into a sliver.
        await expect(button).toHaveCSS('display', 'grid');

        // The label must render with real width, not be squeezed to a
        // single truncated character -- assert its box is a substantial
        // fraction of the button's own width, not a token of it.
        const label = button.locator('small');
        const [labelBox, buttonBox] = await Promise.all([label.boundingBox(), button.boundingBox()]);
        expect(labelBox).not.toBeNull();
        expect(buttonBox).not.toBeNull();
        expect(labelBox.width).toBeGreaterThan(buttonBox.width * 0.5);
      }
    });

    test('topbar location block hides below 900px and never wraps when shown', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const location = page.locator('.topbar .location');
      const display = await location.evaluate((el) => getComputedStyle(el).display);

      if (width < 900) {
        // This is the exact root cause of the real, shipped topbar bug
        // (campusos-cross-device-pass): a later "dark mode fix" rule
        // redeclared `display:flex` on `.location`, clobbering the
        // `@media (max-width: 900px) { .location { display: none } }`
        // rule of equal specificity.
        expect(display).toBe('none');
      } else {
        expect(display).not.toBe('none');
        const topbarBox = await page.locator('.topbar').boundingBox();
        const locationBox = await location.boundingBox();
        expect(locationBox).not.toBeNull();
        // A wrapped multi-line .location block blows past the topbar's
        // fixed 74px height (see src/index.css) -- catches the "wrapping
        // across 4 lines, crushing the header" failure mode directly,
        // not just the display:none regression.
        expect(locationBox.height).toBeLessThanOrEqual(topbarBox.height + 2);
      }
    });

    test('the sign-in modal fits inside the viewport with no overflow', async ({ page }) => {
      // Unauthenticated for this one check -- the modal only opens from
      // the signed-out "Sign in" button.
      await page.goto('/');
      await page.evaluate(() => window.localStorage.clear());
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.getByTestId('sign-in-button').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  });
}
