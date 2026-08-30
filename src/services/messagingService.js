import { supabase } from "../lib/supabase";
import { realtimeStatusLogger } from "./mvpService";

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

export async function sendMessage(conversationId, body, attachmentPath = null, replyToMessageId = null) {
  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: conversationId,
    p_body: body,
    p_attachment_path: attachmentPath,
    p_reply_to_message_id: replyToMessageId,
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
    .select("id, conversation_id, sender_id, body, attachment_path, deleted_at, deleted_by, created_at, reply_to_message_id, message_type")
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
    // Reactions are denormalized with conversation_id (see the 20260830
    // migration) purely so they can ride the same per-thread channel/filter
    // as messages, rather than a separate broad-then-RLS-narrows subscription.
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "message_reactions",
        filter: `conversation_id=eq.${conversationId}`,
      },
      callback
    )
    .subscribe(realtimeStatusLogger("messages"));

  return () => {
    supabase.removeChannel(channel);
  };
}

/*
|--------------------------------------------------------------------------
| Group chat -- create/manage N-participant conversations. DM/listing
| conversations (start_conversation, above) stay exactly 2 participants;
| these are the only entry points that produce/mutate a kind='group' row.
| See 20260830000200_messaging_whatsapp_features.sql.
|--------------------------------------------------------------------------
*/

export async function createGroupConversation(title, memberIds) {
  const { data, error } = await supabase.rpc("create_group_conversation", {
    p_title: title,
    p_member_ids: memberIds,
  });
  throwIfError(error);
  return data;
}

export async function addGroupMember(conversationId, userId) {
  const { error } = await supabase.rpc("add_group_member", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  throwIfError(error);
}

export async function removeGroupMember(conversationId, userId) {
  const { error } = await supabase.rpc("remove_group_member", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  throwIfError(error);
}

export async function leaveGroupConversation(conversationId) {
  const { error } = await supabase.rpc("leave_group_conversation", {
    p_conversation_id: conversationId,
  });
  throwIfError(error);
}

export async function renameGroupConversation(conversationId, title) {
  const { error } = await supabase.rpc("rename_group_conversation", {
    p_conversation_id: conversationId,
    p_title: title,
  });
  throwIfError(error);
}

// Member list + roles (group info panel), sender-name lookup for group
// bubbles, and read-receipt data (last_read_at per participant) -- one RPC
// serves all three, see get_conversation_participants() in the migration.
export async function getConversationParticipants(conversationId) {
  const { data, error } = await supabase.rpc("get_conversation_participants", {
    p_conversation_id: conversationId,
  });
  throwIfError(error);
  return data || [];
}

/*
|--------------------------------------------------------------------------
| Reactions
|--------------------------------------------------------------------------
*/

export async function toggleMessageReaction(messageId, emoji) {
  const { error } = await supabase.rpc("toggle_message_reaction", {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  throwIfError(error);
}

// message_reactions' own RLS (is_conversation_participant, see the
// migration) already scopes this to conversations the caller is in -- no
// RPC needed, same "plain table call behind the table's own RLS" pattern
// as getConversationMessages() above.
export async function listConversationReactions(conversationId) {
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .eq("conversation_id", conversationId);
  throwIfError(error);
  return data || [];
}

/*
|--------------------------------------------------------------------------
| Starred messages -- plain table calls, same pattern as blocked_users
| above: starred_messages' own RLS (own rows, and only for a conversation
| you're actually in -- see the migration) is enough, no RPC needed.
|--------------------------------------------------------------------------
*/

export async function starMessage(messageId) {
  const { data: authData } = await supabase.auth.getUser();
  const me = authData?.user?.id;
  if (!me) throw new Error("Sign in required");
  const { error } = await supabase.from("starred_messages").insert({ user_id: me, message_id: messageId });
  if (error && error.code !== "23505") throwIfError(error); // already starred
}

export async function unstarMessage(messageId) {
  const { data: authData } = await supabase.auth.getUser();
  const me = authData?.user?.id;
  if (!me) throw new Error("Sign in required");
  const { error } = await supabase.from("starred_messages").delete().eq("user_id", me).eq("message_id", messageId);
  throwIfError(error);
}

// Returns just the starred message rows (id, body, attachment_path,
// conversation_id, created_at, starred_at) -- the caller already has the
// conversation list loaded (for title/other-party display) and doesn't
// need a second round trip through profiles for that.
export async function listStarredMessages() {
  const { data: authData } = await supabase.auth.getUser();
  const me = authData?.user?.id;
  if (!me) return [];
  const { data: stars, error } = await supabase
    .from("starred_messages")
    .select("message_id, created_at")
    .eq("user_id", me)
    .order("created_at", { ascending: false });
  throwIfError(error);
  if (!stars || stars.length === 0) return [];

  const { data: msgs, error: msgError } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, attachment_path, deleted_at, created_at")
    .in("id", stars.map((s) => s.message_id));
  throwIfError(msgError);

  const starredAtById = {};
  stars.forEach((s) => { starredAtById[s.message_id] = s.created_at; });
  return (msgs || [])
    .map((m) => ({ ...m, starred_at: starredAtById[m.id] }))
    .sort((a, b) => new Date(b.starred_at) - new Date(a.starred_at));
}

/*
|--------------------------------------------------------------------------
| Typing indicators -- ephemeral Realtime broadcast, no table. Nothing is
| persisted; a listener just clears its own "is typing" state a few
| seconds after the last signal (see the Messages component).
|--------------------------------------------------------------------------
*/

export function sendTypingSignal(conversationId, name) {
  if (!conversationId) return;
  supabase.channel(`typing:${conversationId}`).send({
    type: "broadcast",
    event: "typing",
    payload: { name },
  });
}

export function subscribeToTyping(conversationId, callback) {
  if (!conversationId) return () => {};

  const channel = supabase
    .channel(`typing:${conversationId}`)
    .on("broadcast", { event: "typing" }, ({ payload }) => callback(payload))
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
    .subscribe(realtimeStatusLogger("conversations"));

  return () => {
    supabase.removeChannel(channel);
  };
}
