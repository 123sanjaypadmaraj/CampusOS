jest.mock("../lib/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from "../lib/supabase";
import { globalSearch, SEARCH_ENTITY_DESTINATIONS, SEARCH_ENTITY_LABELS } from "./searchService";

describe("globalSearch", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not call the RPC for a query under 2 characters", async () => {
    expect(await globalSearch("a")).toEqual([]);
    expect(await globalSearch("  ")).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("trims the query and passes the limit through", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ entity_type: "post", entity_id: "1" }], error: null });

    const result = await globalSearch("  hostel  ", 5);

    expect(supabase.rpc).toHaveBeenCalledWith("global_search", { p_query: "hostel", p_limit: 5 });
    expect(result).toEqual([{ entity_type: "post", entity_id: "1" }]);
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
});
