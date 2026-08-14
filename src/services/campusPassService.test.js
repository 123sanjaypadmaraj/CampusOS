jest.mock("../lib/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from "../lib/supabase";
import { mintCampusPass, verifyCampusPass } from "./campusPassService";

describe("campusPassService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("mintCampusPass unwraps the single row RETURNS TABLE hands back", async () => {
    const row = { token: "abc.def", expires_at: "2026-01-01T00:00:01Z", holder_name: "Alice" };
    supabase.rpc.mockResolvedValue({ data: [row], error: null });

    const result = await mintCampusPass();

    expect(supabase.rpc).toHaveBeenCalledWith("mint_campus_pass");
    expect(result).toBe(row);
  });

  it("mintCampusPass throws when the RPC returns no row at all", async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });

    await expect(mintCampusPass()).rejects.toThrow("Could not generate a pass");
  });

  it("mintCampusPass propagates the RPC error (e.g. ACCOUNT_SUSPENDED)", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("ACCOUNT_SUSPENDED: your account has been suspended") });

    await expect(mintCampusPass()).rejects.toThrow("ACCOUNT_SUSPENDED");
  });

  it("verifyCampusPass passes the token through and unwraps the result row", async () => {
    const row = { valid: true, holder_name: "Bob" };
    supabase.rpc.mockResolvedValue({ data: [row], error: null });

    const result = await verifyCampusPass("token.sig");

    expect(supabase.rpc).toHaveBeenCalledWith("verify_campus_pass", { p_token: "token.sig" });
    expect(result).toBe(row);
  });

  it("verifyCampusPass propagates a not-authorized error for a non-staff caller", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Not authorized to verify campus passes") });

    await expect(verifyCampusPass("token.sig")).rejects.toThrow("Not authorized");
  });
});
