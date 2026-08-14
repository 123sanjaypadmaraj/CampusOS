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
