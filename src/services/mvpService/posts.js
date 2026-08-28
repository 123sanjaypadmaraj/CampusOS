/**
 * POSTS
 *
 * The campus feed: posts (create/list/save) plus likes and comments.
 */

import { supabase } from "../../lib/supabase";
import { compressImage, formatRelativeTime, throwIfError } from "./_shared.js";
import { logStorageErrorIfAny } from "./errorLogging.js";

// `cursor` is the created_at of the last post already loaded -- pass it to
// fetch the next page (doc §90: cursor pagination, never "load everything").
export async function getCampusPosts(
  campusId,
  { limit = 20, cursor = null } = {}
) {
  let query = supabase
    .from("posts")
    .select(`
      id,
      type,
      title,
      content,
      tags,
      image_urls,
      created_at,
      campus_id,
      author_id
    `)
    .eq("status", "visible")
    .order("created_at", {
      ascending: false,
    })
    .limit(limit);

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  let posts = data || [];

  if (!posts.length) {
    return [];
  }

  const authorIds = [...new Set(posts.map(p => p.author_id))];
  if (authorIds.length > 0) {
    // Other authors' full profile rows aren't directly selectable anymore
    // (RLS §42) -- get_profile_snippets() returns only the safe fields.
    const { data: profilesData } = await supabase.rpc("get_profile_snippets", { p_ids: authorIds });

    const profileMap = {};
    if (profilesData) {
      profilesData.forEach(p => profileMap[p.id] = p);
    }

    posts = posts.map(p => ({
      ...p,
      profiles: profileMap[p.author_id] || null
    }));
  }

  const counts =
    await getPostCounts(
      posts.map((post) => post.id)
    );

  return posts.map((post) => ({
    id: post.id,
    type: post.type || "General",
    title: post.title,
    content: post.content || "",
    author:
      post.profiles?.name ||
      "Campus Student",
    authorId: post.author_id,
    avatar:
      post.profiles?.avatar_url ||
      null,
    course:
      post.profiles?.course || "",
    time:
      formatRelativeTime(
        post.created_at
      ),
    createdAt: post.created_at,
    likes:
      counts[post.id]?.likes || 0,
    comments:
      counts[post.id]?.comments || 0,
    liked: false,
    tags: post.tags || [],
    images: post.image_urls || [],
    accent: "violet",
    verified: true,
  }));
}

// post-media is a public bucket, RLS-scoped so a caller can only write into
// their own `${auth.uid()}/...` folder (20260814001500_storage_buckets.sql
// already created it and its policies -- this was the one caller missing).
export async function uploadPostImage(file, ownerId) {
  if (!ownerId) throw new Error("Please sign in first.");
  const compressed = await compressImage(file);
  const path = `${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from("post-media").upload(path, compressed, { contentType: "image/jpeg" });
  logStorageErrorIfAny("post-media", error);
  throwIfError(error);
  const { data } = supabase.storage.from("post-media").getPublicUrl(path);
  return data.publicUrl;
}

export async function publishPost({
  userId,
  campusId,
  type = "General",
  title,
  content = "",
  tags = [],
  imageUrls = [],
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!title?.trim()) {
    throw new Error(
      "Post title cannot be empty."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      campus_id: campusId,
      type,
      title: title.trim(),
      content: content.trim(),
      tags,
      image_urls: imageUrls,
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

export async function deletePost({
  postId,
  userId,
}) {
  if (!postId || !userId) {
    throw new Error(
      "Invalid post request."
    );
  }

  const {
    error,
  } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", userId);

  throwIfError(error);

  return true;
}



/* =========================================================================
   POST LIKES / COMMENTS
========================================================================= */

export async function togglePostLike({
  postId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  const {
    data: existing,
    error: readError,
  } = await supabase
    .from("post_likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfError(readError);

  if (existing) {
    const {
      error,
    } = await supabase
      .from("post_likes")
      .delete()
      .eq("id", existing.id);

    throwIfError(error);

    return false;
  }

  const {
    error,
  } = await supabase
    .from("post_likes")
    .insert({
      post_id: postId,
      user_id: userId,
    });

  throwIfError(error);

  return true;
}








export async function getPostCounts(
  postIds = []
) {
  if (!postIds.length) {
    return {};
  }

  const [
    likesResult,
    commentsResult,
  ] = await Promise.all([
    supabase
      .from("post_likes")
      .select("post_id")
      .in("post_id", postIds),

    supabase
      .from("comments")
      .select("post_id")
      .in("post_id", postIds),
  ]);

  throwIfError(
    likesResult.error
  );

  throwIfError(
    commentsResult.error
  );

  const counts = {};

  postIds.forEach((id) => {
    counts[id] = {
      likes: 0,
      comments: 0,
    };
  });

  (
    likesResult.data || []
  ).forEach((row) => {
    if (counts[row.post_id]) {
      counts[row.post_id].likes++;
    }
  });

  (
    commentsResult.data || []
  ).forEach((row) => {
    if (counts[row.post_id]) {
      counts[row.post_id].comments++;
    }
  });

  return counts;
}


export async function getPostComments(
  postId
) {
  const {
    data,
    error,
  } = await supabase
    .from("comments")
    .select(`
      id,
      post_id,
      author_id,
      content,
      created_at
    `)
    .eq("post_id", postId)
    .order("created_at");

  throwIfError(error);

  let comments = data || [];

  if (comments.length > 0) {
    const authorIds = [...new Set(comments.map(c => c.author_id))];
    const { data: profilesData } = await supabase.rpc("get_profile_snippets", { p_ids: authorIds });

    const profileMap = {};
    if (profilesData) {
      profilesData.forEach(p => profileMap[p.id] = p);
    }
    
    comments = comments.map(c => ({
      ...c,
      profiles: profileMap[c.author_id] || null
    }));
  }

  return comments.map(
    (comment) => ({
      ...comment,
      author:
        comment.profiles?.name ||
        "Campus Student",
      avatar:
        comment.profiles?.avatar_url ||
        null,
      time:
        formatRelativeTime(
          comment.created_at
        ),
    })
  );
}


export async function addPostComment({
  postId,
  userId,
  content,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!content?.trim()) {
    throw new Error(
      "Comment cannot be empty."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_id: userId,
      content: content.trim(),
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}


