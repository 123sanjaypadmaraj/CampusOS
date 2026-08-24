# CampusOS Edge Functions

| Function | Purpose | Auth |
|---|---|---|
| `create-razorpay-order` | Re-derives the authoritative order total server-side and asks Razorpay to create a matching order before checkout opens. | Caller's JWT (student) |
| `razorpay-refund` | Calls Razorpay's refund API for a `pending` refund row and closes the loop via `mark_refund_completed()`. | Caller's JWT (vendor/admin) |
| `razorpay-webhook` | Verifies Razorpay's HMAC signature on the raw webhook body and is the **only** place `orders.payment_status` becomes `paid`. | Razorpay (HMAC secret), no user JWT |
| `payment-reconciliation` | Every 15 minutes (pg_cron), asks Razorpay directly about payments stuck short of a terminal state and self-heals through `record_payment_event()` -- a safety net for a missed webhook delivery, see `supabase/migrations/20260824000800_payment_reconciliation.sql`. | Shared secret (pg_net), no user JWT |

Pickup-code redemption (doc §15) deliberately has **no** Edge Function — the
`redeem_pickup_token()` Postgres RPC already runs `SECURITY DEFINER`, checks
the caller's `food.orders.update` permission, and enforces single-use +
expiry inside a row lock, which gives the same guarantees an Edge Function
wrapper would add nothing to. Call it directly via
`supabase.rpc('redeem_pickup_token', { p_token })` from the vendor-scan UI.

## Deploying

```bash
npx supabase login
npx supabase link --project-ref <ref>

npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
npx supabase secrets set RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxx

npx supabase functions deploy create-razorpay-order
npx supabase functions deploy razorpay-refund
npx supabase functions deploy razorpay-webhook --no-verify-jwt
npx supabase functions deploy payment-reconciliation --no-verify-jwt
```

`--no-verify-jwt` is required on the webhook because Razorpay calls it
directly with no Supabase session — the function verifies authenticity
itself via the HMAC signature instead. `payment-reconciliation` needs it for
the same reason (pg_cron/pg_net calls it, no Supabase session), verifying a
shared secret header instead — see the table above. This isn't only a
webhook thing: `.github/workflows/deploy.yml`'s `NO_VERIFY_JWT_FUNCTIONS`
group lists every function in this repo that needs the flag, which also
includes `send-email`/`send-push`/`send-sms`/`request-password-reset`/
`confirm-password-reset`/`signup-with-usn` — if you're deploying by hand
rather than through CI, check that list before assuming a bare
`supabase functions deploy <name>` is correct for a given function.

After deploying, register the webhook URL in the Razorpay Dashboard under
**Settings → Webhooks**:
`https://<project-ref>.functions.supabase.co/razorpay-webhook`, subscribed to
`payment.authorized`, `payment.captured`, and `payment.failed`.

## Getting test credentials

Razorpay's **Test Mode** keys (`rzp_test_...`) are free and require no KYC —
sign up at https://dashboard.razorpay.com, switch to Test Mode, and generate
API keys under **Settings → API Keys**. The webhook secret is set when you
create the webhook under **Settings → Webhooks**. Test-mode payments never
move real money; Razorpay provides test card/UPI numbers for the checkout
flow.
