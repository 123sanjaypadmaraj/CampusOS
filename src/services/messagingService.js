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

export async function sendMessage(conversationId, body) {
  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: conversationId,
    p_body: body,
  });
  throwIfError(error);
  return data;
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
    .select("id, conversation_id, sender_id, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  throwIfError(error);
  return data || [];
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
export function subscribeToConversationList(callback) {
  const channel = supabase
    .channel("public:conversations_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
