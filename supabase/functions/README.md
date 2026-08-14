# CampusOS Edge Functions

| Function | Purpose | Auth |
|---|---|---|
| `create-razorpay-order` | Re-derives the authoritative order total server-side and asks Razorpay to create a matching order before checkout opens. | Caller's JWT (student) |
| `razorpay-webhook` | Verifies Razorpay's HMAC signature on the raw webhook body and is the **only** place `orders.payment_status` becomes `paid`. | Razorpay (HMAC secret), no user JWT |

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
npx supabase functions deploy razorpay-webhook --no-verify-jwt
```

`--no-verify-jwt` is required on the webhook because Razorpay calls it
directly with no Supabase session — the function verifies authenticity
itself via the HMAC signature instead.

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
