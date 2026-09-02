// Temporary feature flags. Everything here defaults to OFF for the current
// deployment phase -- flip a flag back to `true` to bring that surface back
// online, no other code changes needed. See go-live runbook / MEMORY for
// context on why these are off.
export const FEATURES = {
  // Food Hub: student ordering (menu, cart, checkout) and every reference to
  // it elsewhere in the app (Home tile, recommendations, Activity tab, the
  // AI assistant's add-to-cart action). Canteen vendor accounts are
  // unaffected -- their dashboard just won't see new orders.
  food: false,

  // Paid event registration/checkout (Razorpay). Free events (price === 0)
  // still register normally.
  paidEvents: false,

  // Campus Store checkout (placing an order). Store is pay-at-pickup, not a
  // live gateway, but ordering itself is paused along with the rest.
  storeCheckout: false,

  // Print job payment step (Razorpay). Uploading is disabled alongside it
  // since a print job isn't queued until it's paid for.
  printPayments: false,

  // Club/organizer event payouts ledger (Payouts tab in the club dashboard).
  payouts: false,
};
