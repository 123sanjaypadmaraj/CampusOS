# iOS: App Store submission — everything short of the Xcode build

Android is submission-ready (`android/RELEASE_BACKUP_CHECKLIST.md`). iOS is
categorically blocked on the same one thing every pass on this project has
hit: **compiling, signing, and archiving an iOS app requires a Mac with
Xcode** — Apple doesn't offer a Linux/Windows path, CocoaPods vs. SPM
doesn't change that, and no cloud CI substitute was set up for this repo.
This document gets everything else as close to "paste into Xcode / App
Store Connect and go" as possible from a Windows machine with no Mac.

## 0. What was finalized in the project itself this pass

Real config changes, committed to `ios/`:

- **`Info.plist`**: added the two usage-description strings the app
  actually needs — `NSCameraUsageDescription` (event QR check-in scanning
  in `ClubManage.jsx` uses `getUserMedia`, which WKWebView routes through
  the same iOS camera permission as a native call) and
  `NSLocationWhenInUseUsageDescription` (the SOS emergency flow's
  `getBestEffortLocation()` in `src/services/mvpService/emergency.js` calls
  `navigator.geolocation`). Without these keys, iOS kills the app instead
  of showing a permission prompt the first time either API is called —
  this was a real gap, not a formality. Also added
  `ITSAppUsesNonExemptEncryption = false` so every future App Store
  Connect build upload skips the export-compliance question (CampusOS only
  uses standard HTTPS/TLS, which qualifies for the exemption).
- **`AppDelegate.swift`**: added the two `UIApplicationDelegate` methods
  Capacitor's push-notifications plugin requires
  (`didRegisterForRemoteNotificationsWithDeviceToken` /
  `didFailToRegisterForRemoteNotificationsWithError`, forwarding to
  `NotificationCenter`). The Capacitor scaffold does not add these on its
  own — without them the JS-side `registration`/`registrationError`
  listeners in `src/services/pushService.js` would simply never fire on
  iOS, silently. This was missing and is now fixed; APNs credentials
  themselves are still a separate open item (see §5).
- **`project.pbxproj`**: changed `TARGETED_DEVICE_FAMILY` from `"1,2"`
  (iPhone + iPad, the Capacitor default) to `1` (iPhone only). CampusOS's
  layout is a responsive web wrapper tuned for phone widths, not an
  iPad-adapted layout — shipping it universal would mean App Store Connect
  requiring a 13" iPad screenshot set for a layout nobody has actually
  verified at that size. iPhone-only mirrors the Android submission scope
  (phone-only there too). Easy to revert (`"1,2"`) later if iPad support
  becomes a real target.
- **App icon**: already real, not a placeholder — confirmed
  `Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` is 1024×1024,
  8-bit RGB **with no alpha channel**, which is exactly Apple's
  requirement (App Store Connect rejects icons with transparency). This
  was generated from the real CampusOS logo mark in the same pass that
  replaced the letter-mark placeholder app-wide (`d9072d5`); no further
  icon work needed.
- Bundle ID `in.edu.nhce.campusos`, matching Android's `applicationId` —
  intentional, keeps both stores under one identity.

Everything below is Apple-account/Xcode-side and needs the user.

## 1. Prerequisites (before opening Xcode)

- [ ] A Mac (any recent macOS) with Xcode installed (current stable
  release — Xcode itself enforces a minimum macOS version).
- [ ] An **Apple Developer Program** membership ($99/year) — required for
  App Store distribution, separate from a free Apple ID used for
  development-only builds.
- [ ] Xcode signed in with that Apple ID (Xcode → Settings → Accounts).

## 2. Exact Xcode steps

```bash
# On the Mac, after cloning/copying this repo:
npm install
npm run build          # produces dist/
npx cap sync ios        # copies dist/ + plugin config into ios/
npx cap open ios        # opens ios/App/App.xcworkspace... (see note below)
```

**Open `ios/App/App.xcodeproj` in Xcode** (there's no `.xcworkspace` in
this repo — Capacitor's iOS platform here uses Swift Package Manager for
plugin dependencies, not CocoaPods, so `cap open ios` will open the
`.xcodeproj` directly; that's correct, not a missing-file problem).

1. **Select the `App` target → Signing & Capabilities tab.**
   - Team: pick your Apple Developer team from the dropdown.
     `CODE_SIGN_STYLE` is already `Automatic` in the project, so Xcode
     will provision and sign for you once a team is selected — no manual
     certificate/profile juggling needed for a standard submission.
   - Bundle Identifier is pre-set to `in.edu.nhce.campusos` — register
     this exact App ID in your Apple Developer account if Xcode doesn't
     auto-create it (Signing & Capabilities will offer to do this for you
     the first time you pick a team).
   - Click **+ Capability → Push Notifications**. This is the one piece
     that categorically cannot be prepared from Windows — adding a
     capability in Xcode writes a new `App.entitlements` file and wires it
     into the project automatically; hand-editing the `.pbxproj` to fake
     this without Xcode itself risks corrupting the project file, so it
     was deliberately left for this step rather than attempted here.
   - Also add **+ Capability → Background Modes** → check **Remote
     notifications** (lets a silent push wake the app to refresh data).
2. **General tab**: confirm Version `1.0` / Build `1` (already set via
   `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in the project — bump
   Build on every re-upload of the same version, same as Android's
   `versionCode`).
3. **Product → Destination → Any iOS Device (arm64)**, then
   **Product → Archive**. This is the step that requires a real Mac +
   Xcode and cannot be simulated, scripted, or pre-verified from here.
4. When the Organizer window opens after a successful archive, click
   **Distribute App → App Store Connect → Upload**, accept the defaults
   (automatic signing, include bitcode is no longer relevant on current
   Xcode versions, symbols on).
5. **[ ] Physical device test** — like the Android APK, this project has
   never been run on any physical iOS device or even the iOS Simulator
   (no Mac has touched this repo). Test on at least one real device before
   submitting for review, especially the camera QR-scan and geolocation
   SOS flows added this pass, since `getUserMedia`/`getCurrentPosition`
   permission prompts inside WKWebView are worth confirming fire correctly
   on-device.

## 3. App Store Connect listing

Create the app at [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
(**My Apps → +**) using the same bundle ID once it's registered via Xcode.
Bundle ID `in.edu.nhce.campusos`; SKU can be anything unique, e.g.
`campusos-ios-1`.

### App name / subtitle

- **Name** (≤30 chars): `CampusOS`
- **Subtitle** (≤30 chars): `Campus life, one app`

### Description (reused from the Android listing draft, adapted)

Same copy as `android/RELEASE_BACKUP_CHECKLIST.md`'s draft — App Store
descriptions have no hard length ceiling below Apple's 4000-char limit, so
it fits unedited:

> CampusOS is your college's everyday app — one place for food, events, clubs, and campus services, so you're not juggling five different apps and a WhatsApp group for student life.
>
> 🍽️ **Food & Print** — Order from campus canteens and the print shop, and track your order status live.
>
> 🎉 **Events & Clubs** — Discover what's happening today, RSVP, and check in with a QR code. Club organizers can run their own event calendar, take attendance, and issue certificates.
>
> 🛍️ **Marketplace & Lost & Found** — Buy and sell with other verified students, and report or claim lost items with built-in matching.
>
> 🧑‍🤝‍🧑 **Connect** — Find classmates by branch and year, form hackathon teams around the skills you need, and reach out to mentors.
>
> 🛠️ **Campus Services** — Raise a facilities ticket, book shared resources (labs, equipment, rooms), and track it through to resolution.
>
> 🤖 **Campus AI** — Ask questions about campus life and get quick answers.
>
> Every account is verified against your college email/USN, so you're only ever interacting with people from your own campus. Export or delete your data at any time from your profile.
>
> Currently deployed for [your college's full name] — CampusOS is built to run as one platform per campus.

Same placeholder note as the Android draft: replace
`[your college's full name]` before submitting — same edit needed in both
store listings, keep them in sync.

### Keywords (≤100 chars total, comma-separated, no spaces after commas)

```
campus,college,student,events,clubs,canteen,food order,marketplace,lost and found,QR checkin
```
(99 chars — Apple strips the word "app" and generic terms like "free"
from consideration, so they're left out here.)

### Promotional text (≤170 chars, editable without a new build)

```
One app for canteen orders, campus events with QR check-in, clubs, marketplace, lost & found, and campus services — verified for your college only.
```

### URLs

- **Support URL**: needs a real page — CampusOS doesn't have a dedicated
  support/contact page distinct from the in-app Support tickets feature.
  Cheapest fix: point this at `https://campusos-amber.vercel.app/legal`
  temporarily (it at least resolves and describes the app) or stand up a
  one-page support contact before submitting; Apple does check this URL
  loads. Flagging rather than guessing — your call.
- **Marketing URL** (optional): leave blank, or the same production URL.
- **Privacy Policy URL** (required): `https://campusos-amber.vercel.app/legal`
  — same URL already verified live for the Play Store listing (loads with
  no login required, confirmed in a real browser during the Android pass).

### Category

Primary: **Education**. Secondary (optional): **Social Networking** or
**Lifestyle** — your call based on which weighs more for App Store search;
Education alone is a safe default given the verified-campus-only scope.

### Age rating questionnaire

Apple's current questionnaire (as of recent App Store Connect versions)
asks about content types rather than assigning a single age band directly.
Answer key items honestly based on what's actually in the app:

- **Unrestricted Web Access**: No (the app doesn't embed an open browser).
- **User-Generated Content**: Yes — posts/comments, marketplace listings,
  lost & found reports, club content, and 1:1/group messages are all
  user-generated. Apple will ask if this content is moderated: CampusOS
  has an admin/moderator role and a Support-ticket/report pipeline
  (`get_report_context`, moderator tooling from prior passes), so answer
  **Yes, moderated**.
- **Messaging/communication with other users**: Yes (Messages feature).
- Gambling, contests, mature/suggestive/violent content, alcohol/tobacco/
  drug references: No to all — none of this exists in the app.
- **Result**: with moderated UGC and messaging but no other flagged
  content, this typically lands at **12+** in Apple's current model
  (unmoderated UGC + messaging often forces 17+; moderated UGC is what
  keeps it lower) — but Apple's own questionnaire computes the final
  rating from your answers, so treat 12+ as an expectation to sanity-check
  against the actual questionnaire result, not a value to hand-enter.

### App Privacy ("nutrition label")

Apple asks you to declare, per data category: is it **collected**, is it
**linked to the user's identity**, and is it used for **tracking**
(cross-app/cross-site advertising — CampusOS does none of this, so
**Tracking: No** across the board). Based on what the app actually stores
(cross-checked against `docs/DATA_RETENTION.md` and `export_my_data()`'s
scope rather than guessed):

| Data type | Collected? | Linked to user? | Purpose |
|---|---|---|---|
| Name | Yes | Yes | App Functionality (account, USN/branch verification) |
| Email Address | Yes | Yes | App Functionality (auth, campus-domain verification) |
| Phone Number | Yes | Yes | App Functionality (emergency contacts, order contact) |
| Physical Address | No | — | — |
| Precise Location | Yes | Yes | App Functionality (SOS emergency alert location only — not collected in the background, only on explicit SOS trigger) |
| Photos or Videos | Yes | Yes | App Functionality (avatar, marketplace/lost-found/food listing images, ID verification document) |
| User Content (messages, posts) | Yes | Yes | App Functionality (Messages, community posts/comments, support tickets) |
| Identifiers (User ID) | Yes | Yes | App Functionality (account) |
| Purchase History | Yes | Yes | App Functionality (canteen/print/marketplace/event order history) |
| Other Financial Info | No | — | Payment card data is handled entirely by Razorpay's hosted checkout — CampusOS never receives or stores card/bank details itself, only order amounts and Razorpay-issued transaction references |
| Device ID / Push Token | Yes | Yes | App Functionality (native push notifications) |
| Diagnostics (crash/perf data) | Yes | No (aggregate) | App Functionality (`error_logs` — see `docs/DATA_RETENTION.md`) |
| Contacts | No | — | — |
| Browsing/Search History | No | — | — |

None of this is used for third-party advertising or sold to data brokers,
so every row's "used for tracking" answer is **No**. This table is a
careful draft from reading the actual data-handling code and the existing
DPDP/data-retention documentation — **you are the one submitting this to
Apple, so review it against the live app before answering the actual
questionnaire**, don't paste it in blind.

## 4. Screenshots — requirements and why they weren't generated here

### What Apple requires

For an iPhone-only app (this pass set `TARGETED_DEVICE_FAMILY = 1`), App
Store Connect requires at minimum one complete screenshot set for the
**6.9" display** (iPhone 16 Pro Max class): **1320 × 2868 px, portrait**
(2868 × 1320 if you also want a landscape set — not needed here, the app
is portrait-oriented). Apple auto-generates the smaller iPhone display
sizes from this set; a legacy **6.5" (1242 × 2688 or 1284 × 2778)** set is
no longer mandatory on current App Store Connect but can be added
separately if you want pixel-exact control over how the app looks on
older devices in the listing. 3–10 screenshots per set; Apple recommends
leading with your strongest 2–3 since only those show before a tap.

### Suggested shot list (5 screens, matching the description's feature order)

1. **Home / Food ordering** — the canteen order flow, CampusOS's most
   frequent daily action.
2. **Events** — the events list with an RSVP/QR check-in visible, ties to
   the "check in with a QR code" line in the description.
3. **Clubs** — a club page or the club dashboard, showing the
   community/organizer angle.
4. **Marketplace / Lost & Found** — a listing grid, shows the peer-to-peer
   feature set.
5. **Profile / verified-campus messaging** — reinforces the
   "verified against your college" trust angle from the description.

### Why these weren't captured in this pass

Generating real on-device-accurate screenshots needs a phone-width
viewport. Two things were tried against the live staging app
(`https://campusos-staging.vercel.app`, using an existing e2e test
account) in this sandbox and both are hard-blocked, not skill issues:

1. **The browser tool's window-resize is stuck at a fixed 1280×800
   virtual display** in this environment — confirmed by requesting
   several different sizes and reading back `window.innerWidth`/
   `screen.width` afterward; none took effect. This exact failure mode
   was already hit and documented in an earlier native-apps pass
   (`campusos-native-apps-capacitor-pass` memory) — it's an environment
   constraint of this sandbox, not something retrying fixes.
2. As a workaround, embedding the site in an `<iframe>` sized to a real
   phone viewport (which *would* have gotten a genuinely narrow layout
   width regardless of the outer window) was tried — and correctly
   **refused to load**, because `campusos-security-headers-pass` added a
   `frame-ancestors` CSP / `X-Frame-Options` header specifically to stop
   the app being framed (clickjacking protection). That control did
   exactly its job here; it was **not** bypassed to force a screenshot —
   deliberately weakening a real security header for a marketing asset
   is a worse trade than an unfinished screenshot set.

### The real way to get these (fast, and higher quality than this sandbox could produce anyway)

Once you have the Mac from §1, this is a 10-minute job and will look
better than anything scripted here (real Retina rendering, no upscaling):

```bash
npx cap run ios   # or: open the project in Xcode, pick an iPhone 16 Pro Max simulator, Cmd+R
```

Navigate to each of the 5 screens above in the Simulator, then
**Simulator → File → Save Screen** (or `Cmd+S`) for a pixel-exact PNG
matching the simulator's device size exactly — pick the "iPhone 16 Pro
Max" simulator specifically to get 1320×2868 directly with zero
resizing/scaling needed. Text/UI can optionally be added over the raw
screenshots (App Store screenshots commonly have a caption bar and phone
frame added) using any design tool — not required, Apple accepts plain
device screenshots.

## 5. Not covered here (separate, larger topics)

- **The Xcode build/archive/upload itself** — needs the Mac from §1,
  categorically can't happen from this repo's environment.
- **APNs push credentials** (`.p8` key, Key ID, Team ID) — needed before
  native push actually delivers on iOS; the client/server code is already
  built (`docs/PLATFORM_ADAPTIVE_LAYOUT.md` has the exact secret names).
  Requires the same paid Apple Developer account as this whole checklist.
- **Content rating / Data safety equivalents beyond what's drafted above**
  — the tables in §3 are a careful draft, not a substitute for your own
  read of the live questionnaire.
- **Any billing/monetization declarations** — CampusOS is free with no
  in-app purchases; if that changes, the App Privacy table and age rating
  answers above would need revisiting.
