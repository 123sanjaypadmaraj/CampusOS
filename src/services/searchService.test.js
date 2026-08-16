jest.mock("../lib/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from "../lib/supabase";
import {
  globalSearch,
  logSearch,
  getRecentSearches,
  clearRecentSearches,
  getSearchSuggestions,
  SEARCH_ENTITY_DESTINATIONS,
  SEARCH_ENTITY_LABELS,
  SEARCH_FILTER_GROUPS,
} from "./searchService";

beforeEach(() => jest.clearAllMocks());

describe("globalSearch", () => {
  it("does not call the RPC for a query under 2 characters", async () => {
    expect(await globalSearch("a")).toEqual([]);
    expect(await globalSearch("  ")).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("trims the query, passes the limit through, and defaults types to null", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ entity_type: "post", entity_id: "1" }], error: null });

    const result = await globalSearch("  hostel  ", 5);

    expect(supabase.rpc).toHaveBeenCalledWith("global_search", { p_query: "hostel", p_limit: 5, p_types: null });
    expect(result).toEqual([{ entity_type: "post", entity_id: "1" }]);
  });

  it("passes a non-empty types filter through", async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    await globalSearch("hostel", 8, ["event", "club"]);

    expect(supabase.rpc).toHaveBeenCalledWith("global_search", { p_query: "hostel", p_limit: 8, p_types: ["event", "club"] });
  });

  it("treats an empty types array the same as no filter", async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    await globalSearch("hostel", 8, []);

    expect(supabase.rpc).toHaveBeenCalledWith("global_search", { p_query: "hostel", p_limit: 8, p_types: null });
  });

  it("throws the RPC error rather than swallowing it", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("permission denied") });

    await expect(globalSearch("marketplace")).rejects.toThrow("permission denied");
  });

  it("returns [] instead of null when the RPC hands back nothing", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    expect(await globalSearch("canteen")).toEqual([]);
  });

  it("every entity type destination/label pair stays in sync", () => {
    expect(Object.keys(SEARCH_ENTITY_DESTINATIONS).sort()).toEqual(Object.keys(SEARCH_ENTITY_LABELS).sort());
  });

  it("every filter group's types resolve to a known entity type", () => {
    const knownTypes = new Set(Object.keys(SEARCH_ENTITY_LABELS));
    for (const group of SEARCH_FILTER_GROUPS) {
      for (const type of group.types) {
        expect(knownTypes.has(type)).toBe(true);
      }
    }
  });

  it("every entity type is reachable through exactly one filter group", () => {
    const covered = SEARCH_FILTER_GROUPS.flatMap((g) => g.types).sort();
    expect(covered).toEqual(Object.keys(SEARCH_ENTITY_LABELS).sort());
  });
});

describe("logSearch", () => {
  it("skips the RPC for a query under 2 characters", async () => {
    await logSearch("a");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("trims and logs a real query", async () => {
    supabase.rpc.mockResolvedValue({ error: null });

    await logSearch("  hostel  ");

    expect(supabase.rpc).toHaveBeenCalledWith("log_search", { p_query: "hostel" });
  });

  it("throws the RPC error rather than swallowing it", async () => {
    supabase.rpc.mockResolvedValue({ error: new Error("rate limited") });

    await expect(logSearch("hostel")).rejects.toThrow("rate limited");
  });
});

describe("getRecentSearches / clearRecentSearches / getSearchSuggestions", () => {
  it("getRecentSearches passes the limit and returns [] on null data", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await getRecentSearches(3);

    expect(supabase.rpc).toHaveBeenCalledWith("get_recent_searches", { p_limit: 3 });
    expect(result).toEqual([]);
  });

  it("clearRecentSearches calls the RPC with no arguments", async () => {
    supabase.rpc.mockResolvedValue({ error: null });

    await clearRecentSearches();

    expect(supabase.rpc).toHaveBeenCalledWith("clear_recent_searches");
  });

  it("getSearchSuggestions passes the limit and returns [] on null data", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await getSearchSuggestions(4);

    expect(supabase.rpc).toHaveBeenCalledWith("get_search_suggestions", { p_limit: 4 });
    expect(result).toEqual([]);
  });
});
