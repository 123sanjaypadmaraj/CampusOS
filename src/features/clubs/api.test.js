/**
 * Unit tests for the club self-service dashboard's data layer. The real
 * authorization/business rules (leadership checks, "never leave a club
 * with zero owners") live server-side in supabase/migrations/
 * 20260814004800_club_self_service.sql and are exercised via the RPC
 * contract these tests assert against, not re-implemented here.
 */

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockStorageFrom = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: (...args) => mockFrom(...args),
    storage: { from: (...args) => mockStorageFrom(...args) },
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
  updateClubRecruitment,
  applyToClub,
  cancelClubApplication,
  reviewClubApplication,
  getMyClubApplications,
  uploadClubDocument,
  getClubDocumentUrl,
  deleteClubDocument,
  uploadClubGalleryImage,
  publishClubAnnouncement,
  upsertClubMeeting,
  markMeetingAttendance,
} from "./api";

function chain(result) {
  const builder = {
    update: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    select: jest.fn(() => builder),
    order: jest.fn(() => Promise.resolve(result)),
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

describe("updateClubRecruitment", () => {
  it("writes recruitment_mode and a trimmed/defaulted recruitment_message", async () => {
    const builder = chain({ data: { id: "club-1" }, error: null });
    mockFrom.mockReturnValue(builder);

    await updateClubRecruitment("club-1", { recruitmentMode: "application", recruitmentMessage: "  Tell us about yourself  " });

    expect(mockFrom).toHaveBeenCalledWith("clubs");
    expect(builder.update).toHaveBeenCalledWith({ recruitment_mode: "application", recruitment_message: "Tell us about yourself" });
  });

  it("nulls out an empty recruitment message", async () => {
    const builder = chain({ data: { id: "club-1" }, error: null });
    mockFrom.mockReturnValue(builder);

    await updateClubRecruitment("club-1", { recruitmentMode: "open", recruitmentMessage: "   " });

    expect(builder.update).toHaveBeenCalledWith({ recruitment_mode: "open", recruitment_message: null });
  });
});

describe("apply/cancel/review club applications", () => {
  it("applies via apply_to_club, defaulting a blank message to null", async () => {
    mockRpc.mockResolvedValue({ data: { id: "app-1" }, error: null });

    await applyToClub("club-1", "");

    expect(mockRpc).toHaveBeenCalledWith("apply_to_club", { p_club_id: "club-1", p_message: null });
  });

  it("surfaces the closed-recruitment error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("CLUB_RECRUITMENT_CLOSED: this club is not accepting new members right now") });

    await expect(applyToClub("club-1")).rejects.toThrow(/CLUB_RECRUITMENT_CLOSED/);
  });

  it("withdraws via cancel_club_application", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await cancelClubApplication("app-1");

    expect(mockRpc).toHaveBeenCalledWith("cancel_club_application", { p_application_id: "app-1" });
  });

  it("reviews via review_club_application with an optional note", async () => {
    mockRpc.mockResolvedValue({ data: { id: "app-1", status: "approved" }, error: null });

    await reviewClubApplication("app-1", "approved", "Great fit");

    expect(mockRpc).toHaveBeenCalledWith("review_club_application", { p_application_id: "app-1", p_decision: "approved", p_note: "Great fit" });
  });
});

describe("getMyClubApplications", () => {
  it("returns [] without a userId, no query made", async () => {
    const result = await getMyClubApplications(undefined);

    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("scopes the query to the given user, newest first", async () => {
    const builder = chain({ data: [{ id: "app-1", club_id: "club-1", status: "pending" }], error: null });
    mockFrom.mockReturnValue(builder);

    const result = await getMyClubApplications("user-1");

    expect(mockFrom).toHaveBeenCalledWith("club_applications");
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual([{ id: "app-1", club_id: "club-1", status: "pending" }]);
  });
});

describe("club documents", () => {
  function storageBuilder(overrides = {}) {
    return {
      upload: jest.fn(() => Promise.resolve({ error: null })),
      createSignedUrl: jest.fn(() => Promise.resolve({ data: { signedUrl: "https://signed.example/doc.pdf" }, error: null })),
      remove: jest.fn(() => Promise.resolve({ error: null })),
      ...overrides,
    };
  }

  it("uploads to club-files under a club-scoped path, then inserts the row", async () => {
    const storage = storageBuilder();
    mockStorageFrom.mockReturnValue(storage);
    const builder = chain({ data: { id: "doc-1" }, error: null });
    mockFrom.mockReturnValue(builder);
    const file = { name: "Constitution v1.pdf", type: "application/pdf" };

    await uploadClubDocument("club-1", { title: "  Constitution  " }, file, "user-1");

    expect(mockStorageFrom).toHaveBeenCalledWith("club-files");
    expect(storage.upload).toHaveBeenCalledWith(expect.stringMatching(/^club-1\/\d+-Constitution_v1\.pdf$/), file, expect.any(Object));
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ club_id: "club-1", title: "Constitution", uploaded_by: "user-1" }));
  });

  it("rejects with no file chosen", async () => {
    await expect(uploadClubDocument("club-1", {}, null, "user-1")).rejects.toThrow(/choose a file/i);
  });

  it("fetches a signed URL for viewing", async () => {
    mockStorageFrom.mockReturnValue(storageBuilder());

    const url = await getClubDocumentUrl("club-1/doc.pdf");

    expect(mockStorageFrom).toHaveBeenCalledWith("club-files");
    expect(url).toBe("https://signed.example/doc.pdf");
  });

  it("deletes the row, then best-effort removes the storage object", async () => {
    const builder = chain({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    const storage = storageBuilder();
    mockStorageFrom.mockReturnValue(storage);

    await deleteClubDocument({ id: "doc-1", file_path: "club-1/doc.pdf" });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "doc-1");
    expect(storage.remove).toHaveBeenCalledWith(["club-1/doc.pdf"]);
  });
});

describe("uploadClubGalleryImage", () => {
  it("uploads to club-gallery and stores the resulting public URL", async () => {
    const storage = {
      upload: jest.fn(() => Promise.resolve({ error: null })),
      getPublicUrl: jest.fn(() => ({ data: { publicUrl: "https://public.example/club-1/photo.jpg" } })),
    };
    mockStorageFrom.mockReturnValue(storage);
    const builder = chain({ data: { id: "photo-1" }, error: null });
    mockFrom.mockReturnValue(builder);
    const file = { name: "photo.jpg", type: "image/jpeg" };

    await uploadClubGalleryImage("club-1", "Kickoff", file, "user-1");

    expect(mockStorageFrom).toHaveBeenCalledWith("club-gallery");
    expect(builder.insert).toHaveBeenCalledWith({
      club_id: "club-1", image_url: "https://public.example/club-1/photo.jpg", caption: "Kickoff", uploaded_by: "user-1",
    });
  });

  it("rejects with no file chosen", async () => {
    await expect(uploadClubGalleryImage("club-1", "", null, "user-1")).rejects.toThrow(/choose a photo/i);
  });
});

describe("publishClubAnnouncement", () => {
  it("posts via the fan-out RPC with defaults for optional fields", async () => {
    mockRpc.mockResolvedValue({ data: { id: "ann-1" }, error: null });

    await publishClubAnnouncement("club-1", { title: "Kickoff" });

    expect(mockRpc).toHaveBeenCalledWith("publish_club_announcement", {
      p_club_id: "club-1", p_title: "Kickoff", p_body: null, p_pinned: false,
    });
  });

  it("surfaces the not-a-leader error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("Not authorized to post announcements for this club") });

    await expect(publishClubAnnouncement("club-1", { title: "x" })).rejects.toThrow(/not authorized/i);
  });
});

describe("upsertClubMeeting", () => {
  it("sets created_by only when logging a new meeting", async () => {
    const builder = chain({ data: { id: "meeting-1" }, error: null });
    mockFrom.mockReturnValue(builder);

    await upsertClubMeeting("club-1", { title: "Weekly sync", meeting_date: "2026-09-01T10:00:00Z" }, "user-1");

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ club_id: "club-1", created_by: "user-1" }));
  });

  it("does not touch created_by when editing an existing meeting", async () => {
    const builder = chain({ data: { id: "meeting-1" }, error: null });
    mockFrom.mockReturnValue(builder);

    await upsertClubMeeting("club-1", { id: "meeting-1", title: "Weekly sync v2", meeting_date: "2026-09-01T10:00:00Z" }, "user-1");

    expect(builder.update).toHaveBeenCalledWith(expect.not.objectContaining({ created_by: expect.anything() }));
    expect(builder.eq).toHaveBeenCalledWith("id", "meeting-1");
  });
});

describe("markMeetingAttendance", () => {
  it("bulk-upserts attendance entries via the RPC", async () => {
    const entries = [{ user_id: "user-1", status: "present" }, { user_id: "user-2", status: "absent" }];
    mockRpc.mockResolvedValue({ data: entries, error: null });

    const result = await markMeetingAttendance("meeting-1", entries);

    expect(mockRpc).toHaveBeenCalledWith("mark_meeting_attendance", { p_meeting_id: "meeting-1", p_entries: entries });
    expect(result).toEqual(entries);
  });
});
