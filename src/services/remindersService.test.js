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
  createReminder,
  listMyReminders,
  setReminderDone,
  deleteReminder,
  subscribeToReminders,
} from "./remindersService";

describe("remindersService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("createReminder calls create_reminder with title/remind_at/notes/source", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "r1", title: "Pay hostel fees" }, error: null });

    const result = await createReminder({ title: "Pay hostel fees", remindAt: "2026-08-20T12:00:00Z", notes: "before 5pm", source: "ai" });

    expect(supabase.rpc).toHaveBeenCalledWith("create_reminder", {
      p_title: "Pay hostel fees",
      p_remind_at: "2026-08-20T12:00:00Z",
      p_notes: "before 5pm",
      p_source: "ai",
    });
    expect(result).toEqual({ id: "r1", title: "Pay hostel fees" });
  });

  it("createReminder defaults source to manual", async () => {
    supabase.rpc.mockResolvedValue({ data: {}, error: null });
    await createReminder({ title: "x", remindAt: "2026-08-20T12:00:00Z" });
    expect(supabase.rpc).toHaveBeenCalledWith("create_reminder", expect.objectContaining({ p_source: "manual" }));
  });

  it("createReminder throws the RPC's validation error", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Give the reminder a title") });
    await expect(createReminder({ title: "", remindAt: "2026-08-20T12:00:00Z" })).rejects.toThrow("Give the reminder a title");
  });

  it("listMyReminders excludes done reminders by default", async () => {
    const eq = jest.fn().mockResolvedValue({ data: [{ id: "r1" }], error: null });
    const order = jest.fn(() => ({ eq }));
    const select = jest.fn(() => ({ order }));
    supabase.from.mockReturnValue({ select });

    const result = await listMyReminders();

    expect(supabase.from).toHaveBeenCalledWith("reminders");
    expect(eq).toHaveBeenCalledWith("done", false);
    expect(result).toEqual([{ id: "r1" }]);
  });

  it("listMyReminders includes done reminders when asked", async () => {
    const order = jest.fn().mockResolvedValue({ data: [], error: null });
    const select = jest.fn(() => ({ order }));
    supabase.from.mockReturnValue({ select });

    await listMyReminders({ includeDone: true });

    expect(select).toHaveBeenCalledWith("*");
    expect(order).toHaveBeenCalledWith("remind_at", { ascending: true });
  });

  it("setReminderDone updates the done flag for one reminder", async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: "r1", done: true }, error: null });
    const select = jest.fn(() => ({ single }));
    const eq = jest.fn(() => ({ select }));
    const update = jest.fn(() => ({ eq }));
    supabase.from.mockReturnValue({ update });

    const result = await setReminderDone("r1", true);

    expect(update).toHaveBeenCalledWith({ done: true });
    expect(eq).toHaveBeenCalledWith("id", "r1");
    expect(result).toEqual({ id: "r1", done: true });
  });

  it("deleteReminder deletes by id", async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn(() => ({ eq }));
    supabase.from.mockReturnValue({ delete: del });

    await deleteReminder("r1");

    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", "r1");
  });

  it("subscribeToReminders subscribes to postgres_changes on the reminders table", () => {
    const on = jest.fn().mockReturnThis();
    const subscribe = jest.fn().mockReturnThis();
    supabase.channel.mockReturnValue({ on, subscribe });

    subscribeToReminders(jest.fn());

    expect(on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "public", table: "reminders" }, expect.any(Function));
  });
});
