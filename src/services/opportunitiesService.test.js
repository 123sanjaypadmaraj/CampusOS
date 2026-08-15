jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

import { supabase } from "../lib/supabase";
import {
  getOpportunities,
  getMentors,
  applyToOpportunity,
  getMyApplications,
  requestMentor,
  createOpportunity,
  createMentor,
} from "./opportunitiesService";

describe("opportunitiesService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getOpportunities fetches only active postings, soonest deadline first", async () => {
    const order = jest.fn().mockResolvedValue({ data: [{ id: "o1" }], error: null });
    const eqCampus = jest.fn(() => ({ order }));
    const eqActive = jest.fn(() => ({ eq: eqCampus }));
    const select = jest.fn(() => ({ eq: eqActive }));
    supabase.from.mockReturnValue({ select });

    const result = await getOpportunities("campus-1");

    expect(supabase.from).toHaveBeenCalledWith("opportunities");
    expect(eqActive).toHaveBeenCalledWith("active", true);
    expect(eqCampus).toHaveBeenCalledWith("campus_id", "campus-1");
    expect(order).toHaveBeenCalledWith("deadline", { ascending: true, nullsFirst: false });
    expect(result).toEqual([{ id: "o1" }]);
  });

  it("getMentors fetches only active, alphabetically", async () => {
    const order = jest.fn().mockResolvedValue({ data: [{ id: "m1" }], error: null });
    const eqCampus = jest.fn(() => ({ order }));
    const eqActive = jest.fn(() => ({ eq: eqCampus }));
    const select = jest.fn(() => ({ eq: eqActive }));
    supabase.from.mockReturnValue({ select });

    const result = await getMentors("campus-1");

    expect(supabase.from).toHaveBeenCalledWith("mentors");
    expect(order).toHaveBeenCalledWith("name");
    expect(result).toEqual([{ id: "m1" }]);
  });

  it("applyToOpportunity calls the RPC with the opportunity id and an optional message", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "app-1", status: "submitted" }, error: null });

    await applyToOpportunity("opp-1", "I'd love to help");

    expect(supabase.rpc).toHaveBeenCalledWith("apply_to_opportunity", {
      p_opportunity_id: "opp-1",
      p_message: "I'd love to help",
    });
  });

  it("applyToOpportunity propagates a closed-opportunity error", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("This opportunity is no longer accepting applications") });

    await expect(applyToOpportunity("opp-1")).rejects.toThrow("no longer accepting applications");
  });

  it("getMyApplications returns [] without a userId, without querying", async () => {
    expect(await getMyApplications(null)).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("requestMentor unwraps the single row RETURNS TABLE hands back", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ request_id: "r1", mentor_profile_id: null, mentor_name: "Prof. Nair" }], error: null });

    const result = await requestMentor("mentor-1", "Can you help with ESP32?");

    expect(supabase.rpc).toHaveBeenCalledWith("request_mentor", {
      p_mentor_id: "mentor-1",
      p_message: "Can you help with ESP32?",
    });
    expect(result).toEqual({ request_id: "r1", mentor_profile_id: null, mentor_name: "Prof. Nair" });
  });

  it("createOpportunity stamps the posted_by from the current auth user", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    const single = jest.fn().mockResolvedValue({ data: { id: "opp-1" }, error: null });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    supabase.from.mockReturnValue({ insert });

    await createOpportunity({ campusId: "c1", company: "Acme", role: "Intern", type: "Internship" });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ campus_id: "c1", posted_by: "admin-1", company: "Acme", role: "Intern" }));
  });

  it("createMentor defaults optional fields to empty/null rather than undefined", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    const single = jest.fn().mockResolvedValue({ data: { id: "m1" }, error: null });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    supabase.from.mockReturnValue({ insert });

    await createMentor({ campusId: "c1", name: "Dr. Thomas", role: "AI" });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ skills: [], bio: null, contact_email: null, profile_id: null }));
  });
});
