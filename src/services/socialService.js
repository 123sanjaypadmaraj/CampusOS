import { supabase } from "../lib/supabase";


export async function getPosts(campusId) {
  let query = supabase
    .from("posts")
    .select(`
      *,
      profiles!posts_author_id_fkey (
        id,
        name,
        avatar_url,
        course,
        year
      )
    `);

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error
  } = await query.order(
    "created_at",
    { ascending: false }
  );

  if (error) throw error;

  return data || [];
}


export async function createPost({
  userId,
  campusId,
  type = "General",
  title,
  content = "",
  tags = []
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  const {
    data,
    error
  } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      campus_id: campusId,
      type,
      title,
      content,
      tags
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}


export async function likePost({
  postId,
  userId
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  const {
    data: existing
  } = await supabase
    .from("post_likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const {
      error
    } = await supabase
      .from("post_likes")
      .delete()
      .eq("id", existing.id);

    if (error) throw error;

    return {
      liked: false
    };
  }

  const {
    error
  } = await supabase
    .from("post_likes")
    .insert({
      post_id: postId,
      user_id: userId
    });

  if (error) throw error;

  return {
    liked: true
  };
}


export async function addComment({
  postId,
  userId,
  content
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
    error
  } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_id: userId,
      content: content.trim()
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}


export async function getComments(postId) {
  const {
    data,
    error
  } = await supabase
    .from("comments")
    .select(`
      *,
      profiles!comments_author_id_fkey (
        id,
        name,
        avatar_url
      )
    `)
    .eq("post_id", postId)
    .order("created_at");

  if (error) throw error;

  return data || [];
}