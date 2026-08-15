jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import { supabase } from "../lib/supabase";
import {
  getRecommendedFood,
  getRecommendedEvents,
  getRecommendedClubs,
  getRecommendedOpportunities,
  dismissRecommendation,
  getAllRecommendations,
} from "./recommendationsService";

describe("recommendationsService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getRecommendedFood calls recommend_food with the limit and returns the rows", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: "f1", reason: "Because you often order Chinese" }], error: null });

    const result = await getRecommendedFood(4);

    expect(supabase.rpc).toHaveBeenCalledWith("recommend_food", { p_limit: 4 });
    expect(result).toEqual([{ id: "f1", reason: "Because you often order Chinese" }]);
  });

  it("getRecommendedFood defaults limit to 6 and [] on null data", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await getRecommendedFood();

    expect(supabase.rpc).toHaveBeenCalledWith("recommend_food", { p_limit: 6 });
    expect(result).toEqual([]);
  });

  it("getRecommendedEvents propagates a real RPC error instead of swallowing it", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Sign in required") });

    await expect(getRecommendedEvents()).rejects.toThrow("Sign in required");
  });

  it("getRecommendedClubs calls recommend_clubs with the limit", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: "c1" }], error: null });

    await getRecommendedClubs(3);

    expect(supabase.rpc).toHaveBeenCalledWith("recommend_clubs", { p_limit: 3 });
  });

  it("getRecommendedOpportunities calls recommend_opportunities with the limit", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: "o1" }], error: null });

    await getRecommendedOpportunities(5);

    expect(supabase.rpc).toHaveBeenCalledWith("recommend_opportunities", { p_limit: 5 });
  });

  it("dismissRecommendation calls dismiss_recommendation with entity type and id", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    await dismissRecommendation("food_item", "item-1");

    expect(supabase.rpc).toHaveBeenCalledWith("dismiss_recommendation", {
      p_entity_type: "food_item",
      p_entity_id: "item-1",
    });
  });

  it("dismissRecommendation propagates errors", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Unknown recommendation type") });

    await expect(dismissRecommendation("bogus", "x")).rejects.toThrow("Unknown recommendation type");
  });

  it("getAllRecommendations fetches all four categories in parallel and groups them", async () => {
    supabase.rpc.mockImplementation((fn) => {
      const byFn = {
        recommend_food: [{ id: "f1" }],
        recommend_events: [{ id: "e1" }],
        recommend_clubs: [{ id: "c1" }],
        recommend_opportunities: [{ id: "o1" }],
      };
      return Promise.resolve({ data: byFn[fn], error: null });
    });

    const result = await getAllRecommendations(6);

    expect(result).toEqual({
      food: [{ id: "f1" }],
      events: [{ id: "e1" }],
      clubs: [{ id: "c1" }],
      opportunities: [{ id: "o1" }],
    });
  });

  it("getAllRecommendations doesn't let one failing category blank out the rest", async () => {
    supabase.rpc.mockImplementation((fn) => {
      if (fn === "recommend_clubs") return Promise.reject(new Error("boom"));
      return Promise.resolve({ data: [{ id: `${fn}-1` }], error: null });
    });

    const result = await getAllRecommendations();

    expect(result.clubs).toEqual([]);
    expect(result.food).toEqual([{ id: "recommend_food-1" }]);
    expect(result.events).toEqual([{ id: "recommend_events-1" }]);
    expect(result.opportunities).toEqual([{ id: "recommend_opportunities-1" }]);
  });
});
