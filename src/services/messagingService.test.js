jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
    storage: { from: jest.fn() },
    auth: { getUser: jest.fn() },
  },
}));

import { supabase } from "../lib/supabase";
import {
  startConversation,
  sendMessage,
  markConversationRead,
  listConversations,
  getUnreadMessageCount,
  getConversationMessages,
  subscribeToConversationMessages,
  subscribeToConversationList,
  uploadMessageAttachment,
  getMessageAttachmentUrl,
  blockUser,
  unblockUser,
  listBlockedUsers,
  deleteMessage,
} from "./messagingService";

describe("messagingService", () => {
  beforeAll(() => {
    // jsdom's built-in crypto doesn't implement randomUUID() in this test
    // environment's jsdom version -- stub it the same way the real browser
    // would provide it, so uploadMessageAttachment()'s path generation works
    // under test.
    if (!global.crypto.randomUUID) {
      global.crypto.randomUUID = () => "test-uuid";
    }
  });

  beforeEach(() => jest.clearAllMocks());

  it("startConversation calls start_conversation with the seller/listing pair", async () => {
    supabase.rpc.mockResolvedValue({ data: "conv-1", error: null });

    const result = await startConversation("user-2", "listing-1");

    expect(supabase.rpc).toHaveBeenCalledWith("start_conversation", {
      p_other_user: "user-2",
      p_listing_id: "listing-1",
    });
    expect(result).toBe("conv-1");
  });

  it("startConversation defaults listingId to null for a plain classmate DM", async () => {
    supabase.rpc.mockResolvedValue({ data: "conv-2", error: null });

    await startConversation("user-3");

    expect(supabase.rpc).toHaveBeenCalledWith("start_conversation", {
      p_other_user: "user-3",
      p_listing_id: null,
    });
  });

  it("sendMessage throws the RPC error rather than swallowing it", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Not a participant in this conversation") });

    await expect(sendMessage("conv-1", "hi")).rejects.toThrow("Not a participant in this conversation");
  });

  it("sendMessage defaults the attachment path to null for a text-only message", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "m1" }, error: null });

    await sendMessage("conv-1", "hi");

    expect(supabase.rpc).toHaveBeenCalledWith("send_message", {
      p_conversation_id: "conv-1",
      p_body: "hi",
      p_attachment_path: null,
    });
  });

  it("sendMessage passes the attachment path through when sending a photo", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "m1" }, error: null });

    await sendMessage("conv-1", "", "conv-1/photo.png");

    expect(supabase.rpc).toHaveBeenCalledWith("send_message", {
      p_conversation_id: "conv-1",
      p_body: "",
      p_attachment_path: "conv-1/photo.png",
    });
  });

  it("uploadMessageAttachment uploads under the conversation id and returns the storage path", async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    supabase.storage.from.mockReturnValue({ upload });
    const file = new File(["x"], "photo.png", { type: "image/png" });

    const path = await uploadMessageAttachment("conv-1", file);

    expect(supabase.storage.from).toHaveBeenCalledWith("message-attachments");
    expect(upload).toHaveBeenCalled();
    expect(upload.mock.calls[0][0]).toMatch(/^conv-1\/.+-photo\.png$/);
    expect(path).toBe(upload.mock.calls[0][0]);
  });

  it("uploadMessageAttachment rejects with no file chosen", async () => {
    await expect(uploadMessageAttachment("conv-1", null)).rejects.toThrow("Choose an image to attach.");
  });

  it("getMessageAttachmentUrl resolves a signed URL for the private bucket", async () => {
    const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
    supabase.storage.from.mockReturnValue({ createSignedUrl });

    const url = await getMessageAttachmentUrl("conv-1/photo.png");

    expect(supabase.storage.from).toHaveBeenCalledWith("message-attachments");
    expect(createSignedUrl).toHaveBeenCalledWith("conv-1/photo.png", 300);
    expect(url).toBe("https://signed.example/x");
  });

  it("getMessageAttachmentUrl returns null without a path", async () => {
    expect(await getMessageAttachmentUrl(null)).toBeNull();
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it("blockUser inserts into blocked_users for the signed-in user", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "me" } } });
    const insert = jest.fn().mockResolvedValue({ error: null });
    supabase.from.mockReturnValue({ insert });

    await blockUser("them");

    expect(supabase.from).toHaveBeenCalledWith("blocked_users");
    expect(insert).toHaveBeenCalledWith({ blocker_id: "me", blocked_id: "them" });
  });

  it("blockUser treats an already-blocked conflict (23505) as success", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "me" } } });
    const insert = jest.fn().mockResolvedValue({ error: { code: "23505" } });
    supabase.from.mockReturnValue({ insert });

    await expect(blockUser("them")).resolves.toBeUndefined();
  });

  it("unblockUser deletes the block row scoped to the signed-in blocker", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "me" } } });
    const eq2 = jest.fn().mockResolvedValue({ error: null });
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const del = jest.fn(() => ({ eq: eq1 }));
    supabase.from.mockReturnValue({ delete: del });

    await unblockUser("them");

    expect(eq1).toHaveBeenCalledWith("blocker_id", "me");
    expect(eq2).toHaveBeenCalledWith("blocked_id", "them");
  });

  it("listBlockedUsers resolves names via get_profile_snippets, not a direct profile embed", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "me" } } });
    const order = jest.fn().mockResolvedValue({ data: [{ blocked_id: "them", created_at: "t1" }], error: null });
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    supabase.from.mockReturnValue({ select });
    supabase.rpc.mockResolvedValue({ data: [{ id: "them", name: "Them", avatar_url: null }], error: null });

    const result = await listBlockedUsers();

    expect(supabase.rpc).toHaveBeenCalledWith("get_profile_snippets", { p_ids: ["them"] });
    expect(result).toEqual([{ user_id: "them", blocked_at: "t1", name: "Them", avatar_url: null }]);
  });

  it("listBlockedUsers returns [] when signed out", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    expect(await listBlockedUsers()).toEqual([]);
  });

  it("markConversationRead calls mark_conversation_read with the conversation id", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    await markConversationRead("conv-1");

    expect(supabase.rpc).toHaveBeenCalledWith("mark_conversation_read", { p_conversation_id: "conv-1" });
  });

  it("listConversations returns [] instead of null", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    expect(await listConversations()).toEqual([]);
  });

  it("getUnreadMessageCount returns 0 when the RPC hands back null", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    expect(await getUnreadMessageCount()).toBe(0);
  });

  it("getConversationMessages queries messages ordered oldest-first for one conversation", async () => {
    const order = jest.fn().mockResolvedValue({ data: [{ id: "m1" }], error: null });
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    supabase.from.mockReturnValue({ select });

    const result = await getConversationMessages("conv-1");

    expect(supabase.from).toHaveBeenCalledWith("messages");
    expect(eq).toHaveBeenCalledWith("conversation_id", "conv-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual([{ id: "m1" }]);
  });

  it("deleteMessage calls delete_message with the message id", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    await deleteMessage("m1");

    expect(supabase.rpc).toHaveBeenCalledWith("delete_message", { p_message_id: "m1" });
  });

  it("deleteMessage throws the RPC error rather than swallowing it", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Not authorized to delete this message") });

    await expect(deleteMessage("m1")).rejects.toThrow("Not authorized to delete this message");
  });

  it("subscribeToConversationMessages returns a no-op unsubscribe without a conversation id", () => {
    const unsub = subscribeToConversationMessages(null, jest.fn());
    expect(supabase.channel).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
  });

  it("subscribeToConversationList subscribes to conversations and messages without a filter", () => {
    const on = jest.fn().mockReturnThis();
    const subscribe = jest.fn().mockReturnThis();
    supabase.channel.mockReturnValue({ on, subscribe });

    subscribeToConversationList(jest.fn());

    expect(supabase.channel).toHaveBeenCalledWith(expect.stringMatching(/^public:conversations_realtime:\d+$/));
    expect(on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      expect.any(Function)
    );
    expect(on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      expect.any(Function)
    );
  });

  it("subscribeToConversationList gives each call a distinct channel name -- two real callers (the App-level unread badge and the Messages page) subscribe at once in production, and a shared fixed topic made supabase-js reuse an already-subscribed channel and throw", () => {
    const on = jest.fn().mockReturnThis();
    const subscribe = jest.fn().mockReturnThis();
    supabase.channel.mockReturnValue({ on, subscribe });

    subscribeToConversationList(jest.fn());
    subscribeToConversationList(jest.fn());

    const [firstName] = supabase.channel.mock.calls[0];
    const [secondName] = supabase.channel.mock.calls[1];
    expect(firstName).not.toBe(secondName);
  });
});
