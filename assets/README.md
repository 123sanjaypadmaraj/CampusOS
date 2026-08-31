# Native app icon/splash source

`icon.png` (flat icon, opaque white bg), `icon-foreground.png` /
`icon-background.png` (Android adaptive-icon pair) and `splash.png` are
generated from the real CampusOS logo mark (`src/assets/campusos-logo-mark.png`,
sourced from the brand's official `CampusOS Logo.png` artwork) — not
placeholders.

`icon-foreground.png` keeps the mark inside Android's ~66% adaptive-icon
safe zone on a transparent background; `icon-background.png` is a flat
white layer behind it; `icon.png` is the same mark at a larger, more
legible size on opaque white for iOS and legacy (non-adaptive) Android
icons.

Re-run this any time the source art in `src/assets/` changes:

```bash
npx capacitor-assets generate
```

This writes into `android/app/src/main/res/**` and
`ios/App/App/Assets.xcassets/**` directly — re-run it any time this
folder's source art changes, then `npx cap sync`.
