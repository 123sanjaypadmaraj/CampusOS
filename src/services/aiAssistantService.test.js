jest.mock("../lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() },
}));

import { supabase } from "../lib/supabase";
import { askCampusAssistant, submitAiFeedback, logAiAction } from "./aiAssistantService";

describe("askCampusAssistant", () => {
  beforeEach(() => jest.clearAllMocks());

  it("invokes the campus-assistant Edge Function with the message history", async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { reply: "Here's the menu." }, error: null });

    const messages = [{ role: "user", content: "What's on the menu?" }];
    const result = await askCampusAssistant(messages);

    expect(supabase.functions.invoke).toHaveBeenCalledWith("campus-assistant", { body: { messages } });
    expect(result).toEqual({ reply: "Here's the menu.", pendingAction: null, navigateTo: null, sources: [] });
  });

  it("passes through the sources array from the function", async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { reply: "Here's the menu.", sources: ["Live menu data"] }, error: null });

    const result = await askCampusAssistant([{ role: "user", content: "What's on the menu?" }]);

    expect(result.sources).toEqual(["Live menu data"]);
  });

  it("falls back to a generic message when the function returns no reply", async () => {
    supabase.functions.invoke.mockResolvedValue({ data: {}, error: null });

    expect((await askCampusAssistant([{ role: "user", content: "hi" }])).reply).toMatch(/rephrasing/i);
  });

  it("passes through a pendingAction proposal from the function", async () => {
    const pendingAction = { type: "reminder", label: "Remind you: \"Pay fees\" at 6pm" };
    supabase.functions.invoke.mockResolvedValue({ data: { reply: "Here you go.", pendingAction }, error: null });

    const result = await askCampusAssistant([{ role: "user", content: "remind me to pay fees at 6pm" }]);

    expect(result.pendingAction).toEqual(pendingAction);
    expect(result.navigateTo).toBeNull();
  });

  it("passes through a navigateTo target from the function", async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { reply: "Taking you there.", navigateTo: "market" }, error: null });

    const result = await askCampusAssistant([{ role: "user", content: "take me to the marketplace" }]);

    expect(result.navigateTo).toBe("market");
    expect(result.pendingAction).toBeNull();
  });

  it("surfaces the Edge Function's own error message (e.g. rate limited) instead of a generic one", async () => {
    const error = new Error("Edge Function returned a non-2xx status code");
    error.context = { json: async () => ({ code: "RATE_LIMITED", message: "You've sent a lot of messages -- try again in a bit." }) };
    supabase.functions.invoke.mockResolvedValue({ data: null, error });

    await expect(askCampusAssistant([{ role: "user", content: "hi" }])).rejects.toThrow("try again in a bit");
  });

  it("falls back to the raw error message when the error body isn't parseable JSON", async () => {
    const error = new Error("Failed to fetch");
    supabase.functions.invoke.mockResolvedValue({ data: null, error });

    await expect(askCampusAssistant([{ role: "user", content: "hi" }])).rejects.toThrow("Failed to fetch");
  });
});

describe("submitAiFeedback", () => {
  beforeEach(() => jest.clearAllMocks());

  it("submits a rating with a trimmed excerpt and optional report reason", async () => {
    supabase.rpc.mockResolvedValue({ error: null });

    await submitAiFeedback("Here's the menu.", "down", "wrong price");

    expect(supabase.rpc).toHaveBeenCalledWith("submit_ai_feedback", {
      p_message_excerpt: "Here's the menu.",
      p_rating: "down",
      p_report_reason: "wrong price",
    });
  });

  it("throws when the RPC errors", async () => {
    supabase.rpc.mockResolvedValue({ error: new Error("Invalid rating") });

    await expect(submitAiFeedback("text", "down")).rejects.toThrow("Invalid rating");
  });
});

describe("logAiAction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("logs the action's disposition without throwing on RPC failure", async () => {
    supabase.rpc.mockRejectedValue(new Error("network error"));

    await expect(logAiAction("reminder", { title: "Pay fees" }, "confirmed", "Reminder set")).resolves.toBeUndefined();
    expect(supabase.rpc).toHaveBeenCalledWith("log_ai_action", {
      p_action_type: "reminder",
      p_action_payload: { title: "Pay fees" },
      p_status: "confirmed",
      p_result_text: "Reminder set",
    });
  });
});
