/**
 * LOST & FOUND -- photo upload + matching (supabase/migrations/
 * 20260819000500_lost_found_matching.sql). Same compress-then-upload-then-
 * getPublicUrl shape as uploadMarketplaceImage/uploadFoodImage, targeting
 * the lost-found-media bucket that's existed unused since 20260814001500.
 */

import { supabase } from "../../lib/supabase";
import { isUuid } from "../../utils/mvpHelpers";
import { throwIfError } from "./_shared.js";
import { logStorageErrorIfAny } from "./errorLogging.js";

function compressLostFoundImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onerror = reject;
      img.onload = () => {
        const maxEdge = 1280;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadLostFoundImage(file, ownerId) {
  const blob = await compressLostFoundImage(file);
  const path = `${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from("lost-found-media").upload(path, blob, { contentType: "image/jpeg" });
  logStorageErrorIfAny("lost-found-media", error);
  throwIfError(error);
  const { data } = supabase.storage.from("lost-found-media").getPublicUrl(path);
  return data.publicUrl;
}

export async function createLostFoundItemWithImages({ userId, campusId, itemType, title, description, category, location, imageUrls = [] }) {
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
      image_urls: imageUrls,
    })
    .select()
    .single();

  throwIfError(error);
  return data;
}

export async function listLostFoundMatches(itemId) {
  const { data, error } = await supabase.rpc("list_lost_found_matches", { p_item_id: itemId });
  throwIfError(error);
  return data || [];
}
