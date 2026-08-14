// Data layer for the per-vendor dashboard (doc §16 vendor portal): CRUD for
// a single canteen's menu, plus print-rate CRUD for the print shop vendor.
// Menu writes reuse the exact same canteens/food_items functions the admin
// CMS already uses (../admin/api.js) -- they were never admin-exclusive in
// the code, only in practice, because only admins held 'food.menu.write'
// before real per-canteen vendor accounts existed. Isolation between
// vendors is now enforced by ownership-scoped RLS, not by which UI calls
// the function -- see supabase/migrations/20260814002200_vendor_dashboard.sql.

import { supabase } from "../../lib/supabase";
import { listFoodCategories, upsertCanteen, upsertFoodItem } from "../admin/api";

export { listFoodCategories, upsertCanteen, upsertFoodItem };

function throwIfError(error) {
  if (error) throw error;
}

// A vendor owns at most one canteen (owner_id is set 1:1 when the account
// is provisioned -- see scripts/setup-vendor-accounts.mjs).
export async function getMyCanteen(userId) {
  const { data, error } = await supabase
    .from("canteens")
    .select("*")
    .eq("owner_id", userId)
    .maybeSingle();
  throwIfError(error);
  return data;
}

export async function listMyFoodItems(canteenId) {
  const { data, error } = await supabase
    .from("food_items")
    .select("*, food_categories(id, name)")
    .eq("canteen_id", canteenId)
    .order("name");
  throwIfError(error);
  return data || [];
}

// Real delete when nothing references the item yet. Items with order
// history can't be hard-deleted -- order_items.food_item_id is a plain
// (RESTRICT) foreign key into food_items on purpose, so past receipts never
// go stale (doc §17) -- fall back to archiving (hidden from the menu,
// unavailable) instead of surfacing a raw FK error to the vendor.
export async function deleteFoodItem(id) {
  const { error } = await supabase.from("food_items").delete().eq("id", id);
  if (!error) return { hardDeleted: true };

  if (error.code === "23503") {
    const { error: archiveError } = await supabase
      .from("food_items")
      .update({ active: false, available: false })
      .eq("id", id);
    throwIfError(archiveError);
    return { hardDeleted: false };
  }

  throw error;
}

// The print shop vendor manages page pricing (Black & White / Colour)
// instead of a SKU catalog -- that's what actually drives create_print_job's
// price calculation. Both rows are provisioned with owner_id set at
// account-creation time, so there's nothing to "add"; price is the only
// editable field.
export async function getMyPrintRateCard(userId) {
  const { data, error } = await supabase
    .from("print_rate_card")
    .select("*")
    .eq("owner_id", userId)
    .order("color_mode");
  throwIfError(error);
  return data || [];
}

export async function updatePrintRate(id, pricePerPage) {
  const { data, error } = await supabase
    .from("print_rate_card")
    .update({ price_per_page: pricePerPage })
    .eq("id", id)
    .select()
    .single();
  throwIfError(error);
  return data;
}
