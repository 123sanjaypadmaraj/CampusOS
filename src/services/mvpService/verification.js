/**
 * STUDENT ID VERIFICATION (doc §7)
 * student_verifications is a real table with real RLS (own row read/insert,
 * admin read/update-any -- see 0011) but had no frontend code at all before
 * this. document_path points into the private 'documents' storage bucket
 * (owner + admin read/write, see 0015) -- never public.
 *
 * A student uploads ID proof; an admin approves or rejects it.
 */

import { supabase } from "../../lib/supabase";
import { isUuid } from "../../utils/mvpHelpers";
import { throwIfError } from "./_shared.js";

export async function getMyVerification(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("student_verifications")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  return data;
}

// Re-submitting after a rejection reuses the same row (unique(user_id,
// campus_id)) and resets it back to 'pending' -- admins only ever see one
// live request per student, not an ever-growing history of attempts.
export async function submitStudentVerification({ userId, campusId, usn, file }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!file) throw new Error("Choose a photo of your student ID card.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/id-card-${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" });
  throwIfError(uploadError);

  const { data, error } = await supabase
    .from("student_verifications")
    .upsert(
      {
        user_id: userId,
        campus_id: campusId,
        usn: usn || null,
        verification_method: "document_upload",
        document_path: path,
        status: "pending",
        verified_at: null,
        verified_by: null,
        rejection_reason: null,
      },
      { onConflict: "user_id,campus_id" }
    )
    .select()
    .single();
  throwIfError(error);
  return data;
}

// Admin: a signed URL into the private bucket, valid briefly, so reviewing
// a submission doesn't require making student ID photos public.
export async function getVerificationDocumentUrl(path) {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 300);
  throwIfError(error);
  return data?.signedUrl;
}

export async function listPendingVerifications(campusId) {
  let query = supabase
    .from("student_verifications")
    .select("*, profiles!student_verifications_user_id_fkey(name, course, year, usn, email)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function reviewStudentVerification(id, status, reason, reviewerId) {
  if (!["verified", "rejected"].includes(status)) throw new Error("Invalid review status");
  const { data, error } = await supabase
    .from("student_verifications")
    .update({
      status,
      verified_at: status === "verified" ? new Date().toISOString() : null,
      verified_by: reviewerId || null,
      rejection_reason: status === "rejected" ? (reason || "Not specified") : null,
    })
    .eq("id", id)
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function getLostFoundItems(campusId, { limit = 30, cursor = null } = {}) {
  try {
    // Fire-and-forget housekeeping: flips any report whose expires_at has
    // passed from 'open' to 'archived' (supabase/migrations/
    // 20260819001600_lost_found_hardening.sql) -- same "best-effort, never
    // block the feed load" posture as getMarketplaceListings' equivalent call.
    Promise.resolve(supabase.rpc("expire_stale_lost_found_items")).catch(() => {});

    let query = supabase.from("lost_found_items").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(limit);
    if (campusId) query = query.eq("campus_id", campusId);
    if (cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query;
    if (error) console.warn("getLostFoundItems warning:", error);
    return data || [];
  } catch (err) {
    console.warn("getLostFoundItems error:", err);
    return [];
  }
}

export async function createLostFoundItem({ userId, campusId, itemType, title, description, category, location }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(userId)) throw new Error("Invalid user ID. Please sign in again.");
  if (!title?.trim() || !location?.trim()) throw new Error("Add an item title and location.");

  const { data, error } = await supabase
    .from("lost_found_items")
    .insert({
      user_id: userId,
      campus_id: campusId,
      item_type: itemType || "lost",
      title: title.trim(),
      description: description?.trim() || "",
      category: category?.trim() || "Other",
      location: location.trim(),
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

// Claiming now requires proof of ownership and staff verification before
// the item is released (doc §44) -- it flips to 'claim_pending', not
// straight to resolved, and goes through claim_lost_found_item() since
// direct table updates are blocked once status leaves 'open'.
export async function claimLostFoundItem({ itemId, userId, proof }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!proof?.trim()) throw new Error("Describe how you can prove this item is yours.");
  const { data, error } = await supabase.rpc("claim_lost_found_item", {
    p_item_id: itemId,
    p_proof: proof.trim(),
  });
  throwIfError(error);
  return data;
}

// Admin CMS "Lost & Found" tab -- every status, not just 'open' (getLostFoundItems
// above only fetches 'open', which is right for the student-facing list but
// hides claim_pending/resolved from the moderation view).
export async function listLostFoundItemsAdmin(campusId, { status = null, limit = 100 } = {}) {
  let query = supabase
    .from("lost_found_items")
    .select("*, reporter:profiles!lost_found_items_user_id_fkey(name), claimant:profiles!lost_found_items_claimed_by_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (campusId) query = query.eq("campus_id", campusId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

// Approve/reject a pending claim -- verify_lost_found_handover() (0009) is
// gated to moderation.act/admin server-side regardless of who calls it.
export async function verifyLostFoundHandover(itemId, approve) {
  const { data, error } = await supabase.rpc("verify_lost_found_handover", {
    p_item_id: itemId,
    p_approve: approve,
  });
  throwIfError(error);
  return data;
}

// Direct admin overrides (mark resolved without a claim, archive/restore, or
// remove a bogus/spam report) -- covered by the lost_found_admin_manage/
// _delete RLS policies (20260815000200), not by either RPC above. Restoring
// to 'open' also resets expires_at (20260819001600) -- otherwise a report
// restored from 'archived' would already be past its old expiry and get
// re-archived by the very next expire_stale_lost_found_items() housekeeping
// call.
export async function setLostFoundItemStatusAdmin(itemId, status) {
  const patch = status === "open" ? { status, expires_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString() } : { status };
  const { data, error } = await supabase.from("lost_found_items").update(patch).eq("id", itemId).select().single();
  throwIfError(error);
  return data;
}

export async function deleteLostFoundItemAdmin(itemId) {
  const { error } = await supabase.from("lost_found_items").delete().eq("id", itemId);
  throwIfError(error);
}

export async function getMarketplaceListings(campusId, search = "", { limit = 30, cursor = null } = {}) {
  try {
    // Fire-and-forget housekeeping: flips any listing whose expires_at has
    // passed from 'active' to 'expired' (supabase/migrations/
    // 20260818000700_marketplace_hardening.sql). Best-effort, not a hard
    // SLA -- deliberately not awaited so a slow/failed call here never
    // delays the actual feed load, same "swallow and move on" posture as
    // touchActivity().
    Promise.resolve(supabase.rpc("expire_stale_listings")).catch(() => {});

    let query = supabase.from("marketplace_listings").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(limit);
    if (campusId) query = query.eq("campus_id", campusId);
    if (search.trim()) query = query.ilike("title", `%${search.trim()}%`);
    if (cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query;
    if (error) console.warn("getMarketplaceListings warning:", error);
    
    let listings = data || [];
    if (listings.length > 0) {
      const sellerIds = [...new Set(listings.map(l => l.seller_id))];
      // Other sellers' full profile rows aren't directly selectable anymore
      // (RLS §42) -- get_profile_snippets() returns only the safe fields.
      const { data: profiles } = await supabase.rpc("get_profile_snippets", { p_ids: sellerIds });
      const profileMap = {};
      if (profiles) profiles.forEach(p => profileMap[p.id] = p);
      listings = listings.map(l => ({ ...l, profiles: profileMap[l.seller_id] || null }));
    }
    return listings;
  } catch (err) {
    console.warn("getMarketplaceListings error:", err);
    return [];
  }
}

export async function createMarketplaceListing({ userId, campusId, title, description, category, price, condition, location, imageUrls = [] }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(userId)) throw new Error("Invalid user ID. Please sign in again.");
  if (!title?.trim() || Number(price) < 0) throw new Error("Add a valid listing title and price.");

  const { data, error } = await supabase
    .from("marketplace_listings")
    .insert({
      seller_id: userId,
      campus_id: campusId,
      title: title.trim(),
      description: description?.trim() || "",
      category: category?.trim() || "Other",
      price: Number(price),
      condition: condition?.trim() || "Used",
      location: location?.trim() || "Campus",
      image_urls: imageUrls,
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

export async function markMarketplaceListingSold({ listingId, buyerId = null }) {
  const { data, error } = await supabase.rpc("mark_listing_sold", { p_listing_id: listingId, p_buyer_id: buyerId });
  throwIfError(error);
  return data;
}

// This user's own listings, active or not (getMarketplaceListings above is
// the public feed -- it only ever shows status='active' and no other
// seller's own listing history). Used by the "Your Activity" hub.
export async function getMyMarketplaceListings(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("id, title, price, category, condition, status, created_at, updated_at, expires_at")
    .eq("seller_id", userId)
    .order("created_at", { ascending: false });

  throwIfError(error);

  return data || [];
}

// Records "this user was active today" (supabase/migrations/
// 20260814005000_analytics.sql) -- powers the admin DAU chart. Fire-and-
// forget: a failure here should never interrupt the app, so callers just
// swallow the error (App.jsx calls this once per session load).
export async function touchActivity() {
  const { error } = await supabase.rpc("touch_activity");
  if (error) console.warn("touchActivity warning:", error);
}



