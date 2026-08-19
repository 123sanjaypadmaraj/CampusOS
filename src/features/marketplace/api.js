// Data layer for the campus marketplace + seller-rating depth. Listing
// CRUD reuses the RPCs/tables from supabase/migrations/
// 20260814000900_marketplace_lostfound.sql; ratings are the RPCs/view added
// in 20260814004900_marketplace_seller_ratings.sql.

import { supabase } from "../../lib/supabase";

function throwIfError(error) {
  if (error) throw error;
}

export async function getSellerRatingSummary(sellerIds) {
  if (!sellerIds?.length) return {};
  const { data, error } = await supabase
    .from("seller_rating_summary")
    .select("seller_id, avg_rating, rating_count, positive_count")
    .in("seller_id", sellerIds);
  throwIfError(error);
  const map = {};
  (data || []).forEach((r) => { map[r.seller_id] = r; });
  return map;
}

export async function getSellerReviews(sellerId) {
  const { data, error } = await supabase
    .from("seller_ratings")
    .select("id, rating, comment, created_at, rater_id, listing_id")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false })
    .limit(30);
  throwIfError(error);
  const reviews = data || [];
  if (!reviews.length) return [];

  // Same "fetch rows, then resolve names via get_profile_snippets" pattern
  // getMarketplaceListings already uses (mvpService.js) -- profiles RLS
  // doesn't extend to "any authenticated user can see any rater's name".
  const raterIds = [...new Set(reviews.map((r) => r.rater_id))];
  const { data: profiles } = await supabase.rpc("get_profile_snippets", { p_ids: raterIds });
  const profileMap = {};
  (profiles || []).forEach((p) => { profileMap[p.id] = p; });
  return reviews.map((r) => ({ ...r, rater: profileMap[r.rater_id] || null }));
}

export async function submitSellerRating({ sellerId, listingId, rating, comment }) {
  const { data, error } = await supabase.rpc("submit_seller_rating", {
    p_seller_id: sellerId,
    p_listing_id: listingId,
    p_rating: rating,
    p_comment: comment || null,
  });
  throwIfError(error);
  return data;
}

export async function getMyUnratedPurchases() {
  const { data, error } = await supabase.rpc("get_my_unrated_purchases");
  throwIfError(error);
  return data || [];
}

// Lets a seller pick a real buyer (by name/USN/skill search) when marking
// a listing sold, reusing the same directory search the Connect page/People
// finder already use -- no separate "inquiries" system exists (messaging is
// explicitly out of scope, see 0009's header comment).
export async function searchBuyers(campusId, query) {
  if (!query?.trim()) return [];
  const { data, error } = await supabase.rpc("search_people", {
    p_campus_id: campusId,
    p_query: query.trim(),
    p_limit: 8,
  });
  throwIfError(error);
  return data || [];
}

// Client-side compression before upload, same shape as vendor/api.js's
// uploadFoodImage() -- resizes the longest edge to 1280px and re-encodes as
// JPEG q0.8 via <canvas>, falling back to the original file untouched if
// canvas/createImageBitmap isn't available rather than blocking the upload.
async function compressImage(file, maxDim = 1280, quality = 0.8) {
  if (typeof document === "undefined" || !file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

// marketplace-media is a public bucket, RLS-scoped so a caller can only
// write into their own `${auth.uid()}/...` folder (already existed, unused,
// in 20260814001500_storage_buckets.sql).
export async function uploadMarketplaceImage(file, ownerId) {
  const compressed = await compressImage(file);
  const path = `${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from("marketplace-media").upload(path, compressed, { contentType: "image/jpeg" });
  throwIfError(error);
  const { data } = supabase.storage.from("marketplace-media").getPublicUrl(path);
  return data.publicUrl;
}

export async function updateMarketplaceListing({ listingId, title, description, category, price, condition, location, imageUrls }) {
  const { data, error } = await supabase.rpc("update_marketplace_listing", {
    p_listing_id: listingId,
    p_title: title,
    p_description: description,
    p_category: category,
    p_price: Number(price),
    p_condition: condition,
    p_location: location,
    p_image_urls: imageUrls ?? null,
  });
  throwIfError(error);
  return data;
}

export async function renewMarketplaceListing(listingId) {
  const { data, error } = await supabase.rpc("renew_marketplace_listing", { p_listing_id: listingId });
  throwIfError(error);
  return data;
}

// Read-only, seller/moderator/admin-scoped by marketplace_listing_edits' own
// RLS (20260818000700) -- no RPC needed, a plain table select is enough.
export async function getListingEditHistory(listingId) {
  const { data, error } = await supabase
    .from("marketplace_listing_edits")
    .select("id, old_values, new_values, created_at")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}
