/**
 * Unit tests for the vendor dashboard's data layer. Ownership enforcement
 * itself lives in RLS (supabase/migrations/20260814002200_vendor_dashboard.sql)
 * and isn't re-tested here -- this covers the client-side contract: what
 * gets sent to Supabase, and the hard-delete/archive-fallback behaviour for
 * menu items with order history.
 */

const mockFrom = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));

jest.mock("../admin/api", () => ({
  listFoodCategories: jest.fn(),
  upsertCanteen: jest.fn(),
  upsertFoodItem: jest.fn(),
}));

import {
  getMyCanteen,
  listMyFoodItems,
  deleteFoodItem,
  getMyPrintRateCard,
  updatePrintRate,
  bulkSetAvailability,
  bulkSetCategory,
  bulkArchiveFoodItems,
  bulkAdjustPrice,
} from "./api";

function chain(result) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    order: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    update: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(result)),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

beforeEach(() => jest.clearAllMocks());

describe("getMyCanteen", () => {
  it("looks up the canteen owned by this vendor", async () => {
    const builder = chain({ data: { id: "canteen-1", name: "Udupi" }, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await getMyCanteen("vendor-1");

    expect(mockFrom).toHaveBeenCalledWith("canteens");
    expect(builder.eq).toHaveBeenCalledWith("owner_id", "vendor-1");
    expect(result).toEqual({ id: "canteen-1", name: "Udupi" });
  });
});

describe("listMyFoodItems", () => {
  it("scopes the query to the given canteen", async () => {
    const builder = chain({ data: [{ id: "item-1" }], error: null });
    mockFrom.mockReturnValue(builder);

    const result = await listMyFoodItems("canteen-1");

    expect(builder.eq).toHaveBeenCalledWith("canteen_id", "canteen-1");
    expect(result).toEqual([{ id: "item-1" }]);
  });
});

describe("deleteFoodItem", () => {
  it("hard-deletes an item with no order history", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    const result = await deleteFoodItem("item-1");

    expect(builder.delete).toHaveBeenCalled();
    expect(result).toEqual({ hardDeleted: true });
  });

  it("falls back to archiving when a foreign-key violation blocks the delete", async () => {
    const deleteBuilder = chain({ error: { code: "23503", message: "violates foreign key constraint" } });
    const updateBuilder = chain({ error: null });
    mockFrom.mockReturnValueOnce(deleteBuilder).mockReturnValueOnce(updateBuilder);

    const result = await deleteFoodItem("item-1");

    expect(updateBuilder.update).toHaveBeenCalledWith({ active: false, available: false });
    expect(result).toEqual({ hardDeleted: false });
  });

  it("surfaces any other error instead of silently archiving", async () => {
    const deleteBuilder = chain({ error: { code: "42501", message: "permission denied" } });
    mockFrom.mockReturnValue(deleteBuilder);

    await expect(deleteFoodItem("item-1")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("bulk menu actions", () => {
  it("bulkSetAvailability updates every selected id in one call", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await bulkSetAvailability(["item-1", "item-2"], false);

    expect(mockFrom).toHaveBeenCalledWith("food_items");
    expect(builder.update).toHaveBeenCalledWith({ available: false });
    expect(builder.in).toHaveBeenCalledWith("id", ["item-1", "item-2"]);
  });

  it("bulkSetAvailability is a no-op for an empty selection", async () => {
    await bulkSetAvailability([], true);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("bulkSetCategory moves every selected item, normalising falsy ids to null", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await bulkSetCategory(["item-1"], null);

    expect(builder.update).toHaveBeenCalledWith({ category_id: null });
    expect(builder.in).toHaveBeenCalledWith("id", ["item-1"]);
  });

  it("bulkArchiveFoodItems hides items without hard-deleting them", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await bulkArchiveFoodItems(["item-1", "item-2"]);

    expect(builder.update).toHaveBeenCalledWith({ active: false, available: false });
    expect(builder.in).toHaveBeenCalledWith("id", ["item-1", "item-2"]);
  });

  it("bulkAdjustPrice increases price by a flat amount per item", async () => {
    const b1 = chain({ error: null });
    const b2 = chain({ error: null });
    mockFrom.mockReturnValueOnce(b1).mockReturnValueOnce(b2);

    await bulkAdjustPrice(
      [{ id: "item-1", price: 50 }, { id: "item-2", price: 100 }],
      { mode: "amount", value: 10, direction: 1 }
    );

    expect(b1.update).toHaveBeenCalledWith({ price: 60 });
    expect(b1.eq).toHaveBeenCalledWith("id", "item-1");
    expect(b2.update).toHaveBeenCalledWith({ price: 110 });
    expect(b2.eq).toHaveBeenCalledWith("id", "item-2");
  });

  it("bulkAdjustPrice decreases price by a percentage, never going below 0", async () => {
    const b1 = chain({ error: null });
    mockFrom.mockReturnValueOnce(b1);

    await bulkAdjustPrice([{ id: "item-1", price: 20 }], { mode: "percent", value: 200, direction: -1 });

    expect(b1.update).toHaveBeenCalledWith({ price: 0 });
  });

  it("bulkAdjustPrice surfaces an error from any one of the per-item updates", async () => {
    const b1 = chain({ error: null });
    const b2 = chain({ error: { code: "42501", message: "permission denied" } });
    mockFrom.mockReturnValueOnce(b1).mockReturnValueOnce(b2);

    await expect(
      bulkAdjustPrice(
        [{ id: "item-1", price: 50 }, { id: "item-2", price: 100 }],
        { mode: "amount", value: 10, direction: 1 }
      )
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("getMyPrintRateCard / updatePrintRate", () => {
  it("looks up rate rows owned by this vendor", async () => {
    const builder = chain({ data: [{ id: "rate-1", color_mode: "black_white" }], error: null });
    mockFrom.mockReturnValue(builder);

    const result = await getMyPrintRateCard("vendor-print");

    expect(mockFrom).toHaveBeenCalledWith("print_rate_card");
    expect(builder.eq).toHaveBeenCalledWith("owner_id", "vendor-print");
    expect(result).toEqual([{ id: "rate-1", color_mode: "black_white" }]);
  });

  it("updates price_per_page for a single rate row", async () => {
    const builder = chain({ data: { id: "rate-1", price_per_page: 3 }, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await updatePrintRate("rate-1", 3);

    expect(builder.update).toHaveBeenCalledWith({ price_per_page: 3 });
    expect(builder.eq).toHaveBeenCalledWith("id", "rate-1");
    expect(result).toEqual({ id: "rate-1", price_per_page: 3 });
  });
});
