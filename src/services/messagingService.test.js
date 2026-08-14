jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
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
} from "./messagingService";

describe("messagingService", () => {
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

    expect(supabase.channel).toHaveBeenCalledWith("public:conversations_realtime");
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
});
