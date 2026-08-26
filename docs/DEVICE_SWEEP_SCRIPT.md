# Real-device sweep script

Prep for readiness-audit phase 9's last open item (go-live runbook step 7).
Code-level accessibility/responsive work is done — 16 breakpoints,
autoprefixer, touch targets, focus traps, contrast, form labeling. What's
left needs a human on real hardware, because browser automation in this
environment can't reliably resize past a desktop viewport (see
`campusos-form-labeling-pass` — it tried and gave up, falling back to a
code audit instead of the real thing).

Run this once per device: one Android phone, one iPhone (Safari — the only
non-Chrome-family browser this app has ever been exercised on), and desktop
Firefox. ~10–15 minutes each. Use a real (or disposable e2e) student
account, not the admin account.

## Before you start

- Production URL: `https://campusos-amber.vercel.app`
- Have a test account's login handy (email + password)
- Note the device + OS + browser version at the top of your results

## The pass (same sequence on every device)

1. **Sign in.** Watch for: keyboard covering the password field, autofill
   working, error message readable if you fumble the password.
2. **Land on the home feed.** Check the topbar doesn't overlap or wrap
   awkwardly at this width (this is exactly where the `campos-cross-device-pass`
   bug lived — confirm it's actually gone on a real device, not just in a
   resized browser window).
3. **Place a food order.** Browse a canteen menu, add an item, check out.
   Watch for: tap targets too small, the cart drawer/modal trapping focus
   oddly, checkout button visible without excessive scrolling.
4. **Open a club page.** Any club → its posts/events tab. Watch for: images
   not breaking layout, join/leave button reachable and legible.
5. **Submit a print job** (or a resource booking if print shop isn't set up
   for this college yet). Watch for: file picker working on mobile, date/time
   pickers usable with a touch keyboard, not just mouse.
6. **Check a notification.** Trigger one naturally (e.g. from the order
   above) or open the notification bell. Watch for: toast/banner readable,
   dismissible, doesn't block other UI.
7. **Rotate the device** (phones only) and repeat step 2 briefly — landscape
   is the one orientation the code-level pass couldn't simulate at all.

## What counts as a real finding

Anything that would make a real student give up: unreadable text, a button
they can't tap, a modal they can't close, content cut off with no way to
scroll to it, or anything that outright crashes/white-screens. Minor visual
roughness (slightly uneven spacing) isn't worth a bug report on its own —
flag it only if it also affects usability.

## Recording results

For each device, note pass/fail per step above plus a one-line description
of any real finding (what you did, what you expected, what happened). Send
findings back and they'll be triaged against the actual code, the same way
the two live bugs from the 24 Aug launch-acceptance walkthrough were fixed.

| Device | OS / Browser | Result |
|---|---|---|
| Android phone | | |
| iPhone (Safari) | | |
| Desktop Firefox | | |
