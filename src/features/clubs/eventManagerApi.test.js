/**
 * Event Manager data layer (participants / import / teams / attendance).
 * Authorization and merge rules live in
 * supabase/migrations/20260919000100_event_participants_teams.sql; these assert
 * the RPC contract the UI depends on.
 */

const mockRpc = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: { rpc: (...args) => mockRpc(...args), from: jest.fn(), storage: { from: jest.fn() } },
}));

import {
  listEventParticipants, importEventParticipants, saveEventParticipant,
  setParticipantsAttendance, assignParticipantsToTeams, describeEventManagerError,
  syncEventParticipants, createEventTeams, deleteEventParticipants,
} from "./api";

beforeEach(() => jest.resetAllMocks());

describe("listEventParticipants", () => {
  it("pages through the RPC until a short page comes back", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` }));
    const range = jest.fn()
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({ data: [{ id: "z1" }, { id: "z2" }], error: null });
    mockRpc.mockReturnValue({ range });

    const out = await listEventParticipants("ev1");

    expect(out).toHaveLength(1002);
    expect(mockRpc).toHaveBeenCalledWith("get_event_participants", { p_event_id: "ev1" });
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("surfaces a server-side authorization error", async () => {
    mockRpc.mockReturnValue({ range: jest.fn().mockResolvedValue({ data: null, error: new Error("Not authorized to manage this event") }) });
    await expect(listEventParticipants("ev1")).rejects.toThrow("Not authorized to manage this event");
  });
});

describe("importEventParticipants", () => {
  it("chunks large imports and sums the results", async () => {
    mockRpc.mockResolvedValue({ data: { inserted: 500, updated: 0, skipped: 0, teams_created: 1 }, error: null });
    const rows = Array.from({ length: 1100 }, (_, i) => ({ name: `n${i}` }));

    const res = await importEventParticipants("ev1", rows);

    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRpc.mock.calls[0][1].p_rows).toHaveLength(500);
    expect(mockRpc.mock.calls[2][1].p_rows).toHaveLength(100);
    expect(res).toEqual({ inserted: 1500, updated: 0, skipped: 0, teams_created: 3 });
  });

  it("makes no call for an empty import", async () => {
    expect(await importEventParticipants("ev1", [])).toEqual({ inserted: 0, updated: 0, skipped: 0, teams_created: 0 });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("stops and throws if a chunk fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("IMPORT_TOO_LARGE: nope") });
    await expect(importEventParticipants("ev1", [{ name: "a" }])).rejects.toThrow("IMPORT_TOO_LARGE");
  });
});

describe("single-call wrappers", () => {
  it("saveEventParticipant sends a null id for an add", async () => {
    mockRpc.mockResolvedValue({ data: { id: "p1" }, error: null });
    await saveEventParticipant("ev1", undefined, { name: "Asha" });
    expect(mockRpc).toHaveBeenCalledWith("upsert_event_participant", { p_event_id: "ev1", p_participant_id: null, p_fields: { name: "Asha" } });
  });

  it("setParticipantsAttendance coerces to boolean and returns the changed count", async () => {
    mockRpc.mockResolvedValue({ data: 3, error: null });
    expect(await setParticipantsAttendance("ev1", ["a", "b", "c"], 1)).toBe(3);
    expect(mockRpc).toHaveBeenCalledWith("set_participants_attendance", { p_event_id: "ev1", p_ids: ["a", "b", "c"], p_attended: true });
  });

  it("assignParticipantsToTeams batches and totals the changed rows", async () => {
    mockRpc.mockResolvedValue({ data: 2000, error: null });
    const changed = await assignParticipantsToTeams("ev1", Array.from({ length: 2500 }, (_, i) => ({ participant_id: `p${i}`, team_id: "t" })));
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(changed).toBe(4000);
  });

  it("sync / createTeams / delete pass the expected RPC arguments", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await syncEventParticipants("ev1");
    expect(mockRpc).toHaveBeenLastCalledWith("sync_event_participants", { p_event_id: "ev1" });
    await createEventTeams("ev1", ["A", "B"]);
    expect(mockRpc).toHaveBeenLastCalledWith("create_event_teams", { p_event_id: "ev1", p_names: ["A", "B"] });
    mockRpc.mockResolvedValue({ data: 2, error: null });
    expect(await deleteEventParticipants("ev1", ["x", "y"])).toBe(2);
  });
});

describe("describeEventManagerError", () => {
  it("strips the CODE: prefix but leaves other errors alone", () => {
    expect(describeEventManagerError(new Error("DUPLICATE_PARTICIPANT: someone with that email or USN is already on this event")))
      .toBe("someone with that email or USN is already on this event");
    expect(describeEventManagerError(new Error("Not authorized to manage this event"))).toBe("Not authorized to manage this event");
    expect(describeEventManagerError(null)).toBe("Something went wrong");
  });
});
