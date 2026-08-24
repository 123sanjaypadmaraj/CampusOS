import { supabase } from "../lib/supabase";
import { realtimeStatusLogger, logClientError } from "./mvpService";

/*
|--------------------------------------------------------------------------
| Campus Store -- real commerce (doc §28)
|--------------------------------------------------------------------------
| Backed by supabase/migrations/20260815000100_campus_store.sql. Was
| entirely fake before (a hardcoded storeItems array in src/App.jsx, no
| table, no vendor ownership). Mirrors the food-ordering data layer's
| shape (createFoodOrder/transitionOrderStatus in mvpService.js) --
| idempotent order creation, a server-enforced status state machine --
| just without a payment-gateway leg (pay-at-pickup, same as print jobs).
*/

function throwIfError(error) {
  if (error) throw error;
}

export async function getStores(campusId) {
  let query = supabase.from("stores").select("*").eq("active", true);
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query.order("name");
  throwIfError(error);
  return data || [];
}

export async function getStoreItems(storeId) {
  // store_item_variants embed is RLS-filtered to active variants of an
  // active parent item -- no extra .eq() needed here, same as food's
  // canteen/food_items embeds elsewhere in this codebase.
  let query = supabase.from("store_items").select("*, store_item_variants(*)").eq("active", true).eq("available", true);
  if (storeId) query = query.eq("store_id", storeId);
  const { data, error } = await query.order("name");
  throwIfError(error);
  return data || [];
}

export async function createStoreOrder({ storeId, cart, notes = "", idempotencyKey }) {
  const items = (cart || []).map((entry) => ({
    store_item_id: entry.id,
    variant_id: entry.variantId || null,
    quantity: entry.quantity || 1,
  }));

  const { data, error } = await supabase.rpc("create_store_order", {
    p_store_id: storeId,
    p_items: items,
    p_notes: notes,
    p_idempotency_key: idempotencyKey || null,
  });

  if (error) {
    logClientError(`create_store_order failed: ${error.message}`, { severity: "error", category: "order_creation", context: { storeId } });
  }
  throwIfError(error);
  return data;
}

export async function transitionStoreOrderStatus(orderId, toStatus, reason) {
  const { data, error } = await supabase.rpc("transition_store_order_status", {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

export async function getMyStoreOrders(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("store_orders")
    .select("*, stores(name), store_order_items(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

// GST invoice/receipt for a store order -- see generate_store_order_invoice()
// (supabase/migrations/20260824000600_campus_store_gst_invoices_settlement.sql),
// mirroring getOrCreateOrderInvoice() in mvpService.js for food orders.
// Idempotent server-side, and only available once the order reaches
// COMPLETED (pay-at-pickup has no separate "paid" moment to gate on).
export async function getOrCreateStoreOrderInvoice(orderId) {
  const { data, error } = await supabase.rpc("generate_store_order_invoice", { p_order_id: orderId });
  throwIfError(error);
  return data;
}

export function subscribeToStores(callback) {
  const channel = supabase
    .channel("public:store_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "stores" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "store_items" }, callback)
    .subscribe(realtimeStatusLogger("store"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToStoreOrders(userId, callback) {
  if (!userId) return () => {};

  const channel = supabase
    .channel(`store_orders:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "store_orders", filter: `user_id=eq.${userId}` },
      callback
    )
    .subscribe(realtimeStatusLogger("store_orders"));

  return () => {
    supabase.removeChannel(channel);
  };
}
