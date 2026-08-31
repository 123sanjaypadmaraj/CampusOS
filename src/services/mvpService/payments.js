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

// The payment ledger's `payments` row can point at any one of three targets
// (payments_target_xor, extended most recently by
// supabase/migrations/20260831000800_paid_events.sql to add
// event_registration_id alongside the original order_id and print_job_id
// from printing_v2) -- this embeds all three so ActivityPayments can show
// something meaningful regardless of which kind a given row is. RLS
// (payments_read) already restricts this to payments the caller owns via
// one of those three relations, so no explicit .eq("user_id", ...) is
// needed or even possible here.
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
      ),
      print_jobs (
        id,
        pickup_code,
        pages,
        copies
      ),
      event_registrations (
        id,
        events ( title )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  throwIfError(error);

  return data || [];
}


