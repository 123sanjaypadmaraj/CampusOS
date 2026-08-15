jest.mock("../lib/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from "../lib/supabase";
import { getStudentActivitySummary, getStudentSpendingSeries } from "./studentAnalyticsService";

describe("studentAnalyticsService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getStudentActivitySummary unwraps the single-row RPC result", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ total_spent: 120, clubs_joined_count: 2 }], error: null });

    const result = await getStudentActivitySummary();

    expect(supabase.rpc).toHaveBeenCalledWith("student_activity_summary");
    expect(result).toEqual({ total_spent: 120, clubs_joined_count: 2 });
  });

  it("getStudentActivitySummary returns null rather than undefined when empty", async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });
    expect(await getStudentActivitySummary()).toBeNull();
  });

  it("getStudentActivitySummary propagates an RPC error", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Sign in required") });
    await expect(getStudentActivitySummary()).rejects.toThrow("Sign in required");
  });

  it("getStudentSpendingSeries passes p_days and defaults to []", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await getStudentSpendingSeries(7);

    expect(supabase.rpc).toHaveBeenCalledWith("student_spending_series", { p_days: 7 });
    expect(result).toEqual([]);
  });
});
