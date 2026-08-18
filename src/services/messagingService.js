import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Messaging -- marketplace buyer/seller + classmate-to-classmate DMs
|--------------------------------------------------------------------------
| Backed by supabase/migrations/20260814004200_messaging.sql. Every write
| goes through a SECURITY DEFINER RPC (no direct insert policy on
| conversations/messages) -- this file is a thin wrapper, same shape as the
| rest of src/services/*.js.
*/

function throwIfError(error) {
  if (error) throw error;
}

export async function startConversation(otherUserId, listingId = null) {
  const { data, error } = await supabase.rpc("start_conversation", {
    p_other_user: otherUserId,
    p_listing_id: listingId,
  });
  throwIfError(error);
  return data;
}

export async function sendMessage(conversationId, body, attachmentPath = null) {
  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: conversationId,
    p_body: body,
    p_attachment_path: attachmentPath,
  });
  throwIfError(error);
  return data;
}

// Uploads to the private 'message-attachments' bucket under
// `${conversationId}/...` -- storage RLS (see the migration) scopes read/
// write to the two conversation participants via is_conversation_participant()
// on that first path segment, same "first path segment is the scoping key"
// convention the rest of the app's buckets use.
export async function uploadMessageAttachment(conversationId, file) {
  if (!file) throw new Error("Choose an image to attach.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${conversationId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("message-attachments")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" });
  throwIfError(error);
  return path;
}

// Attachments are private (participants only), so every render resolves a
// short-lived signed URL rather than a public one -- same pattern as
// getVerificationDocumentUrl() for the 'documents' bucket.
export async function getMessageAttachmentUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("message-attachments").createSignedUrl(path, 300);
  throwIfError(error);
  return data?.signedUrl || null;
}

/*
|--------------------------------------------------------------------------
| Block / unblock -- blocked_users' own RLS ("blocker_id = auth.uid()", see
| 20260814000600) already scopes reads/writes to your own block list, so
| these are plain table calls, not RPCs. Enforcement against a blocked user
| still messaging you lives server-side in start_conversation()/
| send_message() (SECURITY DEFINER, bypasses RLS) -- see is_blocked_pair() in
| 20260815001200_marketplace_messaging_gaps.sql.
|--------------------------------------------------------------------------
*/

export async function blockUser(userId) {
  if (!userId) throw new Error("Invalid user");
  const { data: authData } = await supabase.auth.getUser();
  const me = authData?.user?.id;
  if (!me) throw new Error("Sign in required");
  const { error } = await supabase.from("blocked_users").insert({ blocker_id: me, blocked_id: userId });
  if (error && error.code !== "23505") throwIfError(error); // 23505 = already blocked, treat as success
}

export async function unblockUser(userId) {
  const { data: authData } = await supabase.auth.getUser();
  const me = authData?.user?.id;
  if (!me) throw new Error("Sign in required");
  const { error } = await supabase.from("blocked_users").delete().eq("blocker_id", me).eq("blocked_id", userId);
  throwIfError(error);
}

export async function listBlockedUsers() {
  const { data: authData } = await supabase.auth.getUser();
  const me = authData?.user?.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocked_id, created_at")
    .eq("blocker_id", me)
    .order("created_at", { ascending: false });
  throwIfError(error);
  const rows = data || [];
  if (rows.length === 0) return [];

  // profiles RLS doesn't grant arbitrary cross-user reads, so resolve names
  // the same safe way every other feature does (get_profile_snippets),
  // rather than an FK embed that could silently come back null.
  const { data: snippets } = await supabase.rpc("get_profile_snippets", { p_ids: rows.map((r) => r.blocked_id) });
  const byId = {};
  (snippets || []).forEach((s) => { byId[s.id] = s; });
  return rows.map((row) => ({
    user_id: row.blocked_id,
    blocked_at: row.created_at,
    name: byId[row.blocked_id]?.name || "Campus member",
    avatar_url: byId[row.blocked_id]?.avatar_url || null,
  }));
}

export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
  });
  throwIfError(error);
}

export async function listConversations() {
  const { data, error } = await supabase.rpc("list_conversations");
  throwIfError(error);
  return data || [];
}

export async function getUnreadMessageCount() {
  const { data, error } = await supabase.rpc("get_unread_message_count");
  throwIfError(error);
  return data || 0;
}

export async function getConversationMessages(conversationId) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, attachment_path, deleted_at, deleted_by, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  throwIfError(error);
  return data || [];
}

// Soft delete (see 20260817001000_message_delete_moderation.sql): the
// sender can delete their own message any time; a moderator can remove
// anyone's from the report-review flow (see adminDeleteMessage below, same
// RPC). Content is actually cleared server-side, not just hidden client-side.
export async function deleteMessage(messageId) {
  const { error } = await supabase.rpc("delete_message", { p_message_id: messageId });
  throwIfError(error);
}

export function subscribeToConversationMessages(conversationId, callback) {
  if (!conversationId) return () => {};

  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      callback
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Broad (RLS-protected) subscription for the conversation list -- new
// threads and new last-messages across every conversation the signed-in
// user participates in. Same "no filter, RLS narrows it" idiom as
// subscribeToMarketplace()/subscribeToLostFound() in mvpService.js.
//
// Unlike those single-subscriber feeds, this one has TWO independent
// callers at once in practice (the App-level unread-badge counter, mounted
// for the whole session, and the Messages page itself while it's open) --
// a shared fixed topic name broke real production use: supabase-js reuses
// an existing channel instance for a topic it's already seen, so the
// second caller's .on() landed on an already-`subscribe()`d channel and
// threw ("cannot add postgres_changes callbacks... after subscribe()"),
// crashing the whole page. Multiple independently-named channels listening
// to the same postgres_changes stream is normal/supported, so a per-call
// unique suffix is enough -- caught live via tests/live/23-marketplace-
// messaging.spec.js, not by any unit test (those mock the channel entirely).
let conversationListSubscriberCount = 0;
export function subscribeToConversationList(callback) {
  const channel = supabase
    .channel(`public:conversations_realtime:${++conversationListSubscriberCount}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
