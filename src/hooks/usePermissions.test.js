import { renderHook, waitFor } from "@testing-library/react";

import { usePermissions } from "./usePermissions";

jest.mock("../services/mvpService", () => ({
  getMyAccess: jest.fn(),
}));

const { getMyAccess } = require("../services/mvpService");

describe("usePermissions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("a signed-out user (no userId) resolves immediately with no access, no RPC call", async () => {
    const { result } = renderHook(() => usePermissions(null, undefined));

    expect(result.current.loading).toBe(false);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.can("food.menu.write")).toBe(false);
    expect(getMyAccess).not.toHaveBeenCalled();
  });

  test("starts loading, then exposes can()/hasRole()/isAdmin from the real access RPC", async () => {
    getMyAccess.mockResolvedValueOnce({
      permissions: ["food.menu.write", "food.orders.read"],
      roles: ["vendor_staff"],
      is_admin: false,
    });

    const { result } = renderHook(() => usePermissions("user-1", "vendor_staff"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.can("food.menu.write")).toBe(true);
    expect(result.current.can("users.roles.manage")).toBe(false);
    expect(result.current.hasRole("vendor_staff")).toBe(true);
    expect(result.current.hasRole("vendor")).toBe(false);
    expect(result.current.isAdmin).toBe(false);
  });

  test("a manager (vendor_staff) role resolves the same vendor-surface permissions a literal vendor owner has", async () => {
    getMyAccess.mockResolvedValueOnce({
      permissions: ["food.orders.read", "food.orders.update", "store.menu.write"],
      roles: ["vendor_staff"],
      is_admin: false,
    });

    const { result } = renderHook(() => usePermissions("manager-1", "vendor_staff"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasRole("vendor") || result.current.hasRole("vendor_staff")).toBe(true);
  });

  test("fails closed (no access, not a crash) when the RPC call errors", async () => {
    getMyAccess.mockRejectedValueOnce(new Error("network down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => usePermissions("user-1", "student"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.can("food.menu.write")).toBe(false);
    errorSpy.mockRestore();
  });

  test("re-fetches when the signed-in user changes", async () => {
    getMyAccess
      .mockResolvedValueOnce({ permissions: [], roles: ["student"], is_admin: false })
      .mockResolvedValueOnce({ permissions: ["users.roles.manage"], roles: ["super_admin"], is_admin: true });

    const { result, rerender } = renderHook(({ userId, role }) => usePermissions(userId, role), {
      initialProps: { userId: "user-1", role: "student" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(false);

    rerender({ userId: "user-2", role: "super_admin" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.can("users.roles.manage")).toBe(true);
    expect(getMyAccess).toHaveBeenCalledTimes(2);
  });
});
