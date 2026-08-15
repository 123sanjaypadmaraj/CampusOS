jest.mock("../lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { supabase } from "../lib/supabase";
import { askCampusAssistant } from "./aiAssistantService";

describe("askCampusAssistant", () => {
  beforeEach(() => jest.clearAllMocks());

  it("invokes the campus-assistant Edge Function with the message history", async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { reply: "Here's the menu." }, error: null });

    const messages = [{ role: "user", content: "What's on the menu?" }];
    const reply = await askCampusAssistant(messages);

    expect(supabase.functions.invoke).toHaveBeenCalledWith("campus-assistant", { body: { messages } });
    expect(reply).toBe("Here's the menu.");
  });

  it("falls back to a generic message when the function returns no reply", async () => {
    supabase.functions.invoke.mockResolvedValue({ data: {}, error: null });

    expect(await askCampusAssistant([{ role: "user", content: "hi" }])).toMatch(/rephrasing/i);
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
