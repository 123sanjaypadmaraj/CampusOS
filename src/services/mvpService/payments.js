/**
 * PAYMENTS
 *
 * Read-only helpers over the shared payment ledger (`payments` table).
 * Gateway-specific flows (Razorpay order creation, print/food checkout)
 * live next to the feature that owns them (print.js, food.js,
 * src/features/payments/) -- this module is just "show me my payment
 * history" today.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

// The payment ledger only ever links to a food order (`payments.order_id ->
// orders`, see supabase/migrations/20260814000400_payments.sql) -- there's
// no student-facing row for store/booking/print charges yet. RLS
// (payments_read) already restricts this to payments on the caller's own
// orders, so no explicit .eq("user_id", ...) is needed or even possible
// here -- the filter has to go through the embedded orders join instead.
export async function getMyPayments(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("payments")
    .select(`
      id,
      gateway,
      amount,
      currency,
      status,
      created_at,
      orders (
        id,
        total,
        status,
        canteens ( name )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  throwIfError(error);

  return data || [];
}


