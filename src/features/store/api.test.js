/**
 * Unit tests for the Campus Store vendor dashboard's data layer -- covers
 * only what this session added (product variants); item/order CRUD was
 * already shipped untested, out of scope to backfill here. See
 * supabase/migrations/20260815000900_campus_store_variants_stock_analytics.sql
 * for the RLS/RPC side of this.
 */

const mockFrom = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));

jest.mock("../../services/storeService", () => ({
  transitionStoreOrderStatus: jest.fn(),
}));

import {
  listStoreItemVariants,
  upsertStoreItemVariant,
  deleteStoreItemVariant,
} from "./api";

function chain(result) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    upsert: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(result)),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

beforeEach(() => jest.clearAllMocks());

describe("listStoreItemVariants", () => {
  it("fetches variants for one item, ordered by name", async () => {
    const builder = chain({ data: [{ id: "v1", name: "Small" }], error: null });
    mockFrom.mockReturnValue(builder);

    const result = await listStoreItemVariants("item-1");

    expect(mockFrom).toHaveBeenCalledWith("store_item_variants");
    expect(builder.eq).toHaveBeenCalledWith("store_item_id", "item-1");
    expect(builder.order).toHaveBeenCalledWith("name");
    expect(result).toEqual([{ id: "v1", name: "Small" }]);
  });

  it("returns [] rather than null when there are no variants", async () => {
    mockFrom.mockReturnValue(chain({ data: null, error: null }));
    expect(await listStoreItemVariants("item-1")).toEqual([]);
  });
});

describe("upsertStoreItemVariant", () => {
  it("upserts and returns the saved row", async () => {
    const builder = chain({ data: { id: "v1", name: "Medium", price: 599 }, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await upsertStoreItemVariant({ store_item_id: "item-1", name: "Medium", price: 599 });

    expect(mockFrom).toHaveBeenCalledWith("store_item_variants");
    expect(builder.upsert).toHaveBeenCalledWith({ store_item_id: "item-1", name: "Medium", price: 599 });
    expect(result).toEqual({ id: "v1", name: "Medium", price: 599 });
  });

  it("propagates a save error instead of swallowing it", async () => {
    mockFrom.mockReturnValue(chain({ data: null, error: new Error("price must be >= 0") }));
    await expect(upsertStoreItemVariant({ price: -1 })).rejects.toThrow("price must be >= 0");
  });
});

describe("deleteStoreItemVariant", () => {
  it("always hard-deletes -- no archive fallback needed for variants", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await deleteStoreItemVariant("v1");

    expect(mockFrom).toHaveBeenCalledWith("store_item_variants");
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "v1");
  });

  it("propagates any delete error", async () => {
    mockFrom.mockReturnValue(chain({ error: { code: "42501", message: "permission denied" } }));
    await expect(deleteStoreItemVariant("v1")).rejects.toMatchObject({ code: "42501" });
  });
});
