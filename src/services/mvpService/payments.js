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
//
// print_jobs and event_registrations both need an explicit FK name in their
// embed. printing_v2 (20260817001200) added print_jobs.payment_id ->
// payments.id alongside payments.print_job_id -> print_jobs.id (so a job
// can record whichever payment ultimately succeeded), and paid_events
// (20260831000800) did the same for event_registrations.payment_id /
// payments.event_registration_id -- each pair leaves two FK paths between
// the same two tables. PostgREST can't pick one on its own for an
// unqualified `print_jobs (...)` / `event_registrations (...)` embed and
// throws PGRST201 on every call -- this was silently broken from the day
// each migration shipped (17 Aug / 31 Aug respectively), caught live
// testing the Activity page's Payments tab on 3 Sep. `orders` only has the
// one direction (payments.order_id -> orders.id, no reverse column) so it
// doesn't need qualifying.
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
      print_jobs!payments_print_job_id_fkey (
        id,
        pickup_code,
        pages,
        copies
      ),
      event_registrations!payments_event_registration_id_fkey (
        id,
        events ( title )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  throwIfError(error);

  return data || [];
}


