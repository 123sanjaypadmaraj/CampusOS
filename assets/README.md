# Native app icon/splash source

`icon.png` / `icon-foreground.png` / `splash.png` here are placeholders
upscaled from `public/icons/icon-512.png` (the largest source art that
existed in the repo) — good enough to scaffold the native projects, not
good enough for an actual App Store/Play Store submission.

Before shipping to either store, replace these with real art (Apple wants
a 1024×1024 App Store icon with no transparency; a dedicated adaptive-icon
foreground/background pair for Android looks much better than one flat
image reused as the foreground) and regenerate:

```bash
npx capacitor-assets generate
```

This writes into `android/app/src/main/res/**` and
`ios/App/App/Assets.xcassets/**` directly — re-run it any time this
folder's source art changes, then `npx cap sync`.
