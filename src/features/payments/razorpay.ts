// Thin wrapper around Razorpay's Checkout.js. This is the ONLY place the
// gateway's client script is touched -- everything price/verification
// related happens server-side (create-razorpay-order + razorpay-webhook
// Edge Functions, see supabase/functions/README.md).

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

let scriptPromise: Promise<void> | null = null;

export function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the payment gateway. Check your connection and try again."));
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export interface OpenCheckoutArgs {
  keyId: string;
  gatewayOrderId: string;
  amount: number;
  currency: string;
  name?: string;
  description?: string;
  prefillEmail?: string;
  prefillName?: string;
  onDismiss?: () => void;
}

// Resolves once the browser-side checkout closes with a payment attempt
// submitted. It intentionally does NOT resolve with "success" -- the
// razorpay_payment_id/signature returned to the browser are informational
// only; the order only actually becomes PAID once the webhook verifies the
// gateway's signature server-side and the realtime `orders` subscription
// reflects it.
export async function openRazorpayCheckout(args: OpenCheckoutArgs): Promise<void> {
  await loadRazorpayScript();

  return new Promise((resolve) => {
    const razorpay = new window.Razorpay!({
      key: args.keyId,
      order_id: args.gatewayOrderId,
      amount: args.amount,
      currency: args.currency,
      name: args.name || "CampusOS",
      description: args.description || "Campus order",
      prefill: { email: args.prefillEmail, name: args.prefillName },
      theme: { color: "#6945e8" },
      handler: () => resolve(),
      modal: {
        ondismiss: () => {
          args.onDismiss?.();
          resolve();
        },
      },
    });
    razorpay.open();
  });
}
