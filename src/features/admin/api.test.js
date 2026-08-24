/**
 * Unit tests for the admin CMS's own data-layer additions from the
 * readiness-audit phase 10 (college onboarding) pass -- the roster import
 * wrapper and the onboarding lookup/staff-linking wrappers. Authorization
 * itself lives server-side (RLS + import_roster_rows()'s own permission
 * check, add_*_staff_account's existing is_*_owner()/current_user_is_admin()
 * checks) and isn't re-tested here -- this covers the client-side contract:
 * what gets sent to Supabase for each call.
 */

const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

import {
  lookupProfileByEmail,
  addCanteenStaffByEmail,
  addStoreStaffByEmail,
  addPrintStaffByEmail,
  importRosterRows,
  listRosterBatches,
} from "./api";

function makeSelectChain(result) {
  const chain = {
    select: jest.fn(() => chain),
    ilike: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => Promise.resolve(result)),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
  };
  return chain;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe("lookupProfileByEmail", () => {
  it("returns null without querying for a blank email", async () => {
    const result = await lookupProfileByEmail("   ");
    expect(result).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("looks up by lowercased, trimmed email and returns the profile", async () => {
    const chain = makeSelectChain({ data: { id: "u1", email: "a@nhce.edu.in", role: "student" }, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await lookupProfileByEmail("  A@NHCE.edu.in  ");

    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(chain.ilike).toHaveBeenCalledWith("email", "a@nhce.edu.in");
    expect(result).toEqual({ id: "u1", email: "a@nhce.edu.in", role: "student" });
  });

  it("returns null when no profile matches", async () => {
    const chain = makeSelectChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await lookupProfileByEmail("nobody@nhce.edu.in");
    expect(result).toBeNull();
  });

  it("throws on a Supabase error", async () => {
    const chain = makeSelectChain({ data: null, error: new Error("boom") });
    mockFrom.mockReturnValue(chain);

    await expect(lookupProfileByEmail("a@nhce.edu.in")).rejects.toThrow("boom");
  });
});

describe("staff-linking wrappers", () => {
  it("addCanteenStaffByEmail calls add_canteen_staff_account with the right shape", async () => {
    mockRpc.mockResolvedValue({ data: { id: "s1" }, error: null });
    const result = await addCanteenStaffByEmail("canteen-1", "manager@nhce.edu.in");
    expect(mockRpc).toHaveBeenCalledWith("add_canteen_staff_account", { p_canteen_id: "canteen-1", p_email: "manager@nhce.edu.in" });
    expect(result).toEqual({ id: "s1" });
  });

  it("addStoreStaffByEmail calls add_store_staff_account with the right shape", async () => {
    mockRpc.mockResolvedValue({ data: { id: "s2" }, error: null });
    await addStoreStaffByEmail("store-1", "manager@nhce.edu.in");
    expect(mockRpc).toHaveBeenCalledWith("add_store_staff_account", { p_store_id: "store-1", p_email: "manager@nhce.edu.in" });
  });

  it("addPrintStaffByEmail calls add_print_staff_account with the right shape", async () => {
    mockRpc.mockResolvedValue({ data: { id: "s3" }, error: null });
    await addPrintStaffByEmail("campus-1", "manager@nhce.edu.in");
    expect(mockRpc).toHaveBeenCalledWith("add_print_staff_account", { p_campus_id: "campus-1", p_email: "manager@nhce.edu.in" });
  });

  it("propagates an RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("That account already has a different role") });
    await expect(addCanteenStaffByEmail("canteen-1", "x@nhce.edu.in")).rejects.toThrow("That account already has a different role");
  });
});

describe("roster import", () => {
  it("importRosterRows calls import_roster_rows with rows and an optional label", async () => {
    const summary = { batch_id: "b1", created: 2, updated: 1, invalid: 0, errors: [] };
    mockRpc.mockResolvedValue({ data: summary, error: null });

    const rows = [{ usn: "1NH22CS201", name: "Jane Doe" }];
    const result = await importRosterRows(rows, "manual paste (1 rows)");

    expect(mockRpc).toHaveBeenCalledWith("import_roster_rows", { p_rows: rows, p_source_label: "manual paste (1 rows)" });
    expect(result).toEqual(summary);
  });

  it("defaults the source label to null when omitted", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    await importRosterRows([{ usn: "1NH22CS201", name: "Jane Doe" }]);
    expect(mockRpc).toHaveBeenCalledWith("import_roster_rows", expect.objectContaining({ p_source_label: null }));
  });

  it("listRosterBatches reads roster_import_batches ordered newest-first", async () => {
    const chain = makeSelectChain({ data: [{ id: "b1" }], error: null });
    mockFrom.mockReturnValue(chain);

    const result = await listRosterBatches();

    expect(mockFrom).toHaveBeenCalledWith("roster_import_batches");
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual([{ id: "b1" }]);
  });

  it("listRosterBatches returns an empty array when there's no data", async () => {
    const chain = makeSelectChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);
    expect(await listRosterBatches()).toEqual([]);
  });
});
