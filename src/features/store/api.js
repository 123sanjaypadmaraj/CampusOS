// Data layer for the per-vendor Campus Store dashboard (doc §28). Mirrors
// src/features/vendor/api.js's canteen-menu shape exactly -- ownership-scoped
// RLS (stores.owner_id / store_items via stores.owner_id, see
// supabase/migrations/20260815000100_campus_store.sql) is what actually
// isolates one store's vendor from another's, not which UI calls this.

import { supabase } from "../../lib/supabase";
import { transitionStoreOrderStatus } from "../../services/storeService";

export { transitionStoreOrderStatus };

function throwIfError(error) {
  if (error) throw error;
}

// A vendor owns at most one store (owner_id set 1:1 at provisioning, same
// convention as canteens).
export async function getMyStore(userId) {
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .eq("owner_id", userId)
    .maybeSingle();
  throwIfError(error);
  return data;
}

export async function listMyStoreItems(storeId) {
  const { data, error } = await supabase
    .from("store_items")
    .select("*")
    .eq("store_id", storeId)
    .order("name");
  throwIfError(error);
  return data || [];
}

export async function upsertStoreItem(item) {
  const { data, error } = await supabase.from("store_items").upsert(item).select().single();
  throwIfError(error);
  return data;
}

// Real delete when nothing references the item yet; falls back to
// archiving (hidden, unavailable) once it has order history, same
// hard-delete-then-archive-on-FK-violation pattern as deleteFoodItem().
export async function deleteStoreItem(id) {
  const { error } = await supabase.from("store_items").delete().eq("id", id);
  if (!error) return { hardDeleted: true };

  if (error.code === "23503") {
    const { error: archiveError } = await supabase
      .from("store_items")
      .update({ active: false, available: false })
      .eq("id", id);
    throwIfError(archiveError);
    return { hardDeleted: false };
  }

  throw error;
}

// GST config + settlement report (supabase/migrations/20260824000600_
// campus_store_gst_invoices_settlement.sql) -- mirrors updateCanteenGst()/
// getSettlementReport() in src/features/vendor/api.js. No listMyPayouts()
// equivalent: Store is pay-at-pickup, so there's no platform-held money for
// a payout to release -- see that migration's header for why.
export async function updateStoreGst(storeId, { gstRegistered, gstNumber }) {
  const { data, error } = await supabase.from("stores")
    .update({ gst_registered: Boolean(gstRegistered), gst_number: gstNumber || null })
    .eq("id", storeId).select().single();
  throwIfError(error);
  return data;
}

export async function getStoreSettlementReport(startDate, endDate) {
  const { data, error } = await supabase.rpc("store_settlement_report", { p_start: startDate, p_end: endDate });
  throwIfError(error);
  return data || [];
}

export async function listStoreOrders(storeId) {
  const { data, error } = await supabase
    .from("store_orders")
    .select("*, profiles(name), store_order_items(*)")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

// -----------------------------------------------------------------------
// Product variants (supabase/migrations/20260815000900_..._variants_stock_
// analytics.sql). A vendor manages these per item, same ownership-scoped
// RLS as store_items (checked via the item's parent store).
// -----------------------------------------------------------------------

export async function listStoreItemVariants(storeItemId) {
  const { data, error } = await supabase
    .from("store_item_variants")
    .select("*")
    .eq("store_item_id", storeItemId)
    .order("name");
  throwIfError(error);
  return data || [];
}

export async function upsertStoreItemVariant(variant) {
  const { data, error } = await supabase.from("store_item_variants").upsert(variant).select().single();
  throwIfError(error);
  return data;
}

// Real delete, always -- variant_id on store_order_items is ON DELETE SET
// NULL (unlike store_item_id), and item_name/variant_name text snapshots
// keep past orders readable even once the live variant row is gone, so
// there's no hard-delete-then-archive fallback needed here like there is
// for store items/food items.
export async function deleteStoreItemVariant(id) {
  const { error } = await supabase.from("store_item_variants").delete().eq("id", id);
  throwIfError(error);
}
