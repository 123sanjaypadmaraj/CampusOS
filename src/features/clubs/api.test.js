/**
 * Unit tests for the club self-service dashboard's data layer. The real
 * authorization/business rules (leadership checks, "never leave a club
 * with zero owners") live server-side in supabase/migrations/
 * 20260814004800_club_self_service.sql and are exercised via the RPC
 * contract these tests assert against, not re-implemented here.
 */

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: (...args) => mockFrom(...args),
  },
}));

import {
  getMyClubLeadership,
  getClubDashboard,
  updateClubProfile,
  upsertClubEvent,
  setClubEventPublished,
  cancelClubEvent,
  setClubMemberRole,
  removeClubMember,
} from "./api";

function chain(result) {
  const builder = {
    update: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    select: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
}

beforeEach(() => jest.clearAllMocks());

describe("getMyClubLeadership", () => {
  it("calls get_my_club_leadership with no arguments", async () => {
    mockRpc.mockResolvedValue({ data: [{ club_id: "club-1", club_name: "Robotics", role: "president" }], error: null });

    const result = await getMyClubLeadership();

    expect(mockRpc).toHaveBeenCalledWith("get_my_club_leadership");
    expect(result).toEqual([{ club_id: "club-1", club_name: "Robotics", role: "president" }]);
  });
});

describe("getClubDashboard", () => {
  it("passes the club id through to get_club_dashboard", async () => {
    mockRpc.mockResolvedValue({ data: { club: { id: "club-1" }, members: [], events: [], member_growth: [] }, error: null });

    await getClubDashboard("club-1");

    expect(mockRpc).toHaveBeenCalledWith("get_club_dashboard", { p_club_id: "club-1" });
  });

  it("surfaces a not-authorized error from the RPC", async () => {
    // A plain {message} object here would make .rejects.toThrow() silently
    // report "did not throw" -- it only recognizes real Error instances.
    mockRpc.mockResolvedValue({ data: null, error: new Error("Not authorized to manage this club") });

    await expect(getClubDashboard("club-1")).rejects.toThrow(/not authorized/i);
  });
});

describe("updateClubProfile", () => {
  it("writes a trimmed, defaulted payload to the clubs table", async () => {
    const builder = chain({ data: { id: "club-1", name: "Robotics Club" }, error: null });
    mockFrom.mockReturnValue(builder);

    await updateClubProfile("club-1", { name: "  Robotics Club  ", category: "", description: undefined, logoUrl: "  " });

    expect(mockFrom).toHaveBeenCalledWith("clubs");
    expect(builder.update).toHaveBeenCalledWith({
      name: "Robotics Club",
      category: "",
      description: "",
      logo_url: null,
    });
    expect(builder.eq).toHaveBeenCalledWith("id", "club-1");
  });
});

describe("upsertClubEvent", () => {
  it("sets organizer_id to the caller only when creating a new event", async () => {
    const builder = chain({ data: { id: "event-1" }, error: null });
    mockFrom.mockReturnValue(builder);

    await upsertClubEvent("club-1", { title: "Hack Night", event_date: "2026-09-01T10:00:00Z" }, "user-1");

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      club_id: "club-1",
      title: "Hack Night",
      organizer_id: "user-1",
    }));
  });

  it("does not touch organizer_id when editing an existing event", async () => {
    const builder = chain({ data: { id: "event-1" }, error: null });
    mockFrom.mockReturnValue(builder);

    await upsertClubEvent("club-1", { id: "event-1", title: "Hack Night v2", event_date: "2026-09-01T10:00:00Z" }, "user-1");

    expect(builder.update).toHaveBeenCalledWith(expect.not.objectContaining({ organizer_id: expect.anything() }));
    expect(builder.eq).toHaveBeenCalledWith("id", "event-1");
  });
});

describe("setClubEventPublished / cancelClubEvent", () => {
  it("publishes/unpublishes via a plain update", async () => {
    const builder = chain({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    await setClubEventPublished("event-1", false);

    expect(mockFrom).toHaveBeenCalledWith("events");
    expect(builder.update).toHaveBeenCalledWith({ published: false });
  });

  it("cancels an event by setting registration_status and unpublishing", async () => {
    const builder = chain({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    await cancelClubEvent("event-1");

    expect(builder.update).toHaveBeenCalledWith({ registration_status: "CANCELLED", published: false });
  });
});

describe("setClubMemberRole / removeClubMember", () => {
  it("routes role changes through set_club_member_role", async () => {
    mockRpc.mockResolvedValue({ data: { id: "member-1", role: "secretary" }, error: null });

    await setClubMemberRole("member-1", "secretary");

    expect(mockRpc).toHaveBeenCalledWith("set_club_member_role", { p_member_id: "member-1", p_role: "secretary" });
  });

  it("surfaces the last-owner guard error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("CLUB_LAST_OWNER: a club must always have at least one owner") });

    await expect(setClubMemberRole("member-1", "member")).rejects.toThrow(/CLUB_LAST_OWNER/);
  });

  it("routes removal through remove_club_member", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await removeClubMember("member-1");

    expect(mockRpc).toHaveBeenCalledWith("remove_club_member", { p_member_id: "member-1" });
  });
});
