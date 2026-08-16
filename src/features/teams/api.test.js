/**
 * Unit tests for the Project / Team Matching data layer. The real
 * authorization/business rules (capacity enforcement, owner-only
 * management, rate limits) live server-side in supabase/migrations/
 * 20260817000100_team_matching.sql and are exercised via the RPC contract
 * these tests assert against, not re-implemented here.
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
  listProjectTeams,
  getMyTeams,
  getMyTeamInvitations,
  getProjectTeam,
  getTeamCandidates,
  createProjectTeam,
  updateProjectTeam,
  deleteProjectTeam,
  applyToTeam,
  withdrawTeamApplication,
  reviewTeamApplication,
  inviteToTeam,
  cancelTeamInvitation,
  respondToTeamInvitation,
  removeTeamMember,
  leaveTeam,
} from "./api";

function chain(result) {
  const builder = {
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    select: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
}

beforeEach(() => jest.clearAllMocks());

describe("listProjectTeams", () => {
  it("passes filters through to list_project_teams", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "team-1" }], error: null });

    const result = await listProjectTeams("campus-1", { status: "recruiting", category: "Hackathon", search: "react", limit: 10, cursor: "2026-01-01" });

    expect(mockRpc).toHaveBeenCalledWith("list_project_teams", {
      p_campus_id: "campus-1", p_status: "recruiting", p_category: "Hackathon",
      p_search: "react", p_limit: 10, p_cursor: "2026-01-01",
    });
    expect(result).toEqual([{ id: "team-1" }]);
  });

  it("defaults to the recruiting status filter", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await listProjectTeams("campus-1");
    expect(mockRpc).toHaveBeenCalledWith("list_project_teams", expect.objectContaining({ p_status: "recruiting" }));
  });

  it("returns an empty array when data is null", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await listProjectTeams("campus-1")).toEqual([]);
  });

  it("throws on error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(listProjectTeams("campus-1")).rejects.toEqual({ message: "boom" });
  });
});

describe("getMyTeams / getMyTeamInvitations", () => {
  it("calls get_my_teams with no arguments", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "team-1", role: "owner" }], error: null });
    const result = await getMyTeams();
    expect(mockRpc).toHaveBeenCalledWith("get_my_teams");
    expect(result).toEqual([{ id: "team-1", role: "owner" }]);
  });

  it("calls get_my_team_invitations with no arguments", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const result = await getMyTeamInvitations();
    expect(mockRpc).toHaveBeenCalledWith("get_my_team_invitations");
    expect(result).toEqual([]);
  });
});

describe("getProjectTeam", () => {
  it("calls get_project_team with the team id", async () => {
    mockRpc.mockResolvedValue({ data: { team: { id: "team-1" }, members: [] }, error: null });
    const result = await getProjectTeam("team-1");
    expect(mockRpc).toHaveBeenCalledWith("get_project_team", { p_team_id: "team-1" });
    expect(result).toEqual({ team: { id: "team-1" }, members: [] });
  });
});

describe("getTeamCandidates", () => {
  it("defaults limit to 20", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "student-1", match_score: 2 }], error: null });
    const result = await getTeamCandidates("team-1");
    expect(mockRpc).toHaveBeenCalledWith("get_team_candidates", { p_team_id: "team-1", p_limit: 20 });
    expect(result).toEqual([{ id: "student-1", match_score: 2 }]);
  });
});

describe("createProjectTeam", () => {
  it("maps camelCase fields to the RPC's p_ arguments", async () => {
    mockRpc.mockResolvedValue({ data: { id: "team-1" }, error: null });

    await createProjectTeam({
      title: "Hack squad", description: "Building things", category: "Hackathon", context: "SIH 2026",
      skillsHave: ["ML"], skillsNeeded: ["React", "Embedded Systems"], maxMembers: 5,
      deadline: "2026-09-01", externalLink: "https://example.com",
    });

    expect(mockRpc).toHaveBeenCalledWith("create_project_team", {
      p_title: "Hack squad", p_description: "Building things", p_category: "Hackathon", p_context: "SIH 2026",
      p_skills_have: ["ML"], p_skills_needed: ["React", "Embedded Systems"], p_max_members: 5,
      p_deadline: "2026-09-01", p_external_link: "https://example.com",
    });
  });

  it("falls back to sensible defaults for optional fields", async () => {
    mockRpc.mockResolvedValue({ data: { id: "team-1" }, error: null });
    await createProjectTeam({ title: "Minimal team" });
    expect(mockRpc).toHaveBeenCalledWith("create_project_team", {
      p_title: "Minimal team", p_description: "", p_category: "Project", p_context: null,
      p_skills_have: [], p_skills_needed: [], p_max_members: 4, p_deadline: null, p_external_link: null,
    });
  });

  it("throws on error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "RATE_LIMITED" } });
    await expect(createProjectTeam({ title: "x" })).rejects.toEqual({ message: "RATE_LIMITED" });
  });
});

describe("updateProjectTeam", () => {
  it("only sends fields that were actually provided", async () => {
    const builder = chain({ data: { id: "team-1", title: "New title" }, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await updateProjectTeam("team-1", { title: "New title" });

    expect(mockFrom).toHaveBeenCalledWith("project_teams");
    expect(builder.update).toHaveBeenCalledWith({ title: "New title" });
    expect(builder.eq).toHaveBeenCalledWith("id", "team-1");
    expect(result).toEqual({ id: "team-1", title: "New title" });
  });

  it("maps camelCase updates to snake_case columns", async () => {
    const builder = chain({ data: {}, error: null });
    mockFrom.mockReturnValue(builder);

    await updateProjectTeam("team-1", { skillsNeeded: ["Go"], maxMembers: 6, externalLink: "https://x.dev", status: "closed" });

    expect(builder.update).toHaveBeenCalledWith({
      skills_needed: ["Go"], max_members: 6, external_link: "https://x.dev", status: "closed",
    });
  });
});

describe("deleteProjectTeam", () => {
  it("calls delete_project_team with the team id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await deleteProjectTeam("team-1");
    expect(mockRpc).toHaveBeenCalledWith("delete_project_team", { p_team_id: "team-1" });
  });
});

describe("applyToTeam / withdrawTeamApplication / reviewTeamApplication", () => {
  it("applyToTeam passes the message through", async () => {
    mockRpc.mockResolvedValue({ data: { id: "app-1" }, error: null });
    await applyToTeam("team-1", "I know React");
    expect(mockRpc).toHaveBeenCalledWith("apply_to_team", { p_team_id: "team-1", p_message: "I know React" });
  });

  it("applyToTeam defaults a blank message to null", async () => {
    mockRpc.mockResolvedValue({ data: { id: "app-1" }, error: null });
    await applyToTeam("team-1");
    expect(mockRpc).toHaveBeenCalledWith("apply_to_team", { p_team_id: "team-1", p_message: null });
  });

  it("withdrawTeamApplication calls withdraw_team_application", async () => {
    mockRpc.mockResolvedValue({ data: { id: "app-1", status: "withdrawn" }, error: null });
    await withdrawTeamApplication("app-1");
    expect(mockRpc).toHaveBeenCalledWith("withdraw_team_application", { p_application_id: "app-1" });
  });

  it("reviewTeamApplication passes the decision through", async () => {
    mockRpc.mockResolvedValue({ data: { id: "app-1", status: "accepted" }, error: null });
    await reviewTeamApplication("app-1", "accepted");
    expect(mockRpc).toHaveBeenCalledWith("review_team_application", { p_application_id: "app-1", p_decision: "accepted" });
  });

  it("throws TEAM_FULL from the server unchanged", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "TEAM_FULL: this team has already reached its member limit" } });
    await expect(reviewTeamApplication("app-1", "accepted")).rejects.toMatchObject({ message: expect.stringContaining("TEAM_FULL") });
  });
});

describe("invitations", () => {
  it("inviteToTeam passes team/invitee/message through", async () => {
    mockRpc.mockResolvedValue({ data: { id: "inv-1" }, error: null });
    await inviteToTeam("team-1", "student-2", "Join us!");
    expect(mockRpc).toHaveBeenCalledWith("invite_to_team", { p_team_id: "team-1", p_invitee_id: "student-2", p_message: "Join us!" });
  });

  it("cancelTeamInvitation calls cancel_team_invitation", async () => {
    mockRpc.mockResolvedValue({ data: { id: "inv-1", status: "cancelled" }, error: null });
    await cancelTeamInvitation("inv-1");
    expect(mockRpc).toHaveBeenCalledWith("cancel_team_invitation", { p_invitation_id: "inv-1" });
  });

  it("respondToTeamInvitation passes the decision through", async () => {
    mockRpc.mockResolvedValue({ data: { id: "inv-1", status: "accepted" }, error: null });
    await respondToTeamInvitation("inv-1", "accepted");
    expect(mockRpc).toHaveBeenCalledWith("respond_to_team_invitation", { p_invitation_id: "inv-1", p_decision: "accepted" });
  });
});

describe("membership management", () => {
  it("removeTeamMember calls remove_team_member with team and user ids", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await removeTeamMember("team-1", "student-2");
    expect(mockRpc).toHaveBeenCalledWith("remove_team_member", { p_team_id: "team-1", p_user_id: "student-2" });
  });

  it("leaveTeam calls leave_team with the team id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await leaveTeam("team-1");
    expect(mockRpc).toHaveBeenCalledWith("leave_team", { p_team_id: "team-1" });
  });

  it("removeTeamMember throws when the RPC rejects removing the owner", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "The owner cannot be removed -- delete the team instead" } });
    await expect(removeTeamMember("team-1", "owner-1")).rejects.toMatchObject({ message: expect.stringContaining("owner cannot be removed") });
  });
});
