/**
 * Unit tests for the vendor dashboard's data layer. Ownership enforcement
 * itself lives in RLS (supabase/migrations/20260814002200_vendor_dashboard.sql)
 * and isn't re-tested here -- this covers the client-side contract: what
 * gets sent to Supabase, and the hard-delete/archive-fallback behaviour for
 * menu items with order history.
 */

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockFunctionsInvoke = jest.fn();

const mockStorageFrom = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
    functions: { invoke: (...args) => mockFunctionsInvoke(...args) },
    storage: { from: (...args) => mockStorageFrom(...args) },
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

jest.mock("../admin/api", () => ({
  listFoodCategories: jest.fn(),
  upsertCanteen: jest.fn(),
  upsertFoodItem: jest.fn(),
}));

import { upsertFoodItem } from "../admin/api";
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
  bulkSetStock,
  bulkStopTrackingStock,
  foodItemsToCsv,
  parseCsv,
  parseFoodItemsCsv,
  bulkImportFoodItems,
  setOrderOpsFields,
  listCanteenStaff,
  addCanteenStaff,
  setCanteenStaffActive,
  removeCanteenStaff,
  initiateRefund,
  getCanteenDashboardStats,
  getPrintShopDashboardStats,
  getMyPrintBindingRates,
  updatePrintBindingRates,
  getMyPrintShopStatus,
  setPrintShopStatus,
  listActivePrintJobs,
  listPrintJobHistory,
  transitionPrintJob,
  getPrintFileSignedUrl,
} from "./api";

function chain(result) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    order: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    update: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    not: jest.fn(() => builder),
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

describe("bulk stock actions (doc §17-19)", () => {
  it("bulkSetStock opts selected items into tracking and sets an absolute quantity", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await bulkSetStock(["item-1", "item-2"], "12.9");

    expect(builder.update).toHaveBeenCalledWith({ track_stock: true, stock_quantity: 12 });
    expect(builder.in).toHaveBeenCalledWith("id", ["item-1", "item-2"]);
  });

  it("bulkSetStock never sets a negative quantity", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await bulkSetStock(["item-1"], -5);

    expect(builder.update).toHaveBeenCalledWith({ track_stock: true, stock_quantity: 0 });
  });

  it("bulkSetStock is a no-op for an empty selection", async () => {
    await bulkSetStock([], 10);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("bulkStopTrackingStock clears tracking and quantity", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await bulkStopTrackingStock(["item-1"]);

    expect(builder.update).toHaveBeenCalledWith({ track_stock: false, stock_quantity: null });
  });
});

describe("foodItemsToCsv", () => {
  it("exports every column import understands, resolving category id to name", () => {
    const items = [
      {
        id: "item-1", sku: "SKU1", name: "Masala Dosa", category_id: "cat-1", price: 60,
        description: "Crispy, with chutney", is_vegetarian: true, available: true, active: true,
        featured: false, preparation_time_min: 12, track_stock: true, stock_quantity: 4, low_stock_threshold: 5,
      },
    ];
    const categories = [{ id: "cat-1", name: "South Indian" }];

    const csv = foodItemsToCsv(items, categories);
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe("id,sku,name,category,price,description,is_vegetarian,available,active,featured,preparation_time_min,track_stock,stock_quantity,low_stock_threshold");
    expect(lines[1]).toBe('item-1,SKU1,Masala Dosa,South Indian,60,"Crispy, with chutney",true,true,true,false,12,true,4,5');
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const items = [{ id: "1", name: "Combo, Meal", price: 10, description: 'Has a "special" sauce\nand rice' }];
    const csv = foodItemsToCsv(items, []);
    const dataLine = csv.split("\r\n")[1];

    expect(dataLine).toContain('"Combo, Meal"');
    expect(dataLine).toContain('"Has a ""special"" sauce\nand rice"');
  });
});

describe("parseCsv", () => {
  it("splits a simple CSV into rows and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quoted fields with embedded commas and escaped quotes", () => {
    const text = 'name,note\n"Idli, Vada","Say ""hi"""';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Idli, Vada", 'Say "hi"'],
    ]);
  });

  it("handles a quoted field spanning multiple lines", () => {
    const text = 'name,note\nItem,"line one\nline two"';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Item", "line one\nline two"],
    ]);
  });
});

describe("parseFoodItemsCsv", () => {
  const categories = [{ id: "cat-1", name: "Beverages" }];

  it("parses a well-formed CSV into item rows", () => {
    const csv = "name,price,category,track_stock,stock_quantity\nMasala Chai,15,Beverages,true,20";
    const { rows, errors } = parseFoodItemsCsv(csv, categories);

    expect(errors).toEqual([]);
    expect(rows).toEqual([expect.objectContaining({
      name: "Masala Chai", price: 15, category_id: "cat-1", track_stock: true, stock_quantity: 20,
    })]);
  });

  it("requires at least name and price columns", () => {
    const { rows, errors } = parseFoodItemsCsv("sku,category\nX,Y", categories);
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/name.*price/i);
  });

  it("flags an invalid price but keeps parsing other rows", () => {
    const csv = "name,price\nGood Item,50\nBad Item,notanumber";
    const { rows, errors } = parseFoodItemsCsv(csv, categories);

    expect(rows).toEqual([expect.objectContaining({ name: "Good Item", price: 50 })]);
    expect(errors[0]).toMatch(/Row 3.*Bad Item.*invalid price/);
  });

  it("flags an unknown category but still imports the item as uncategorised", () => {
    const csv = "name,price,category\nMystery Snack,20,Nonexistent";
    const { rows, errors } = parseFoodItemsCsv(csv, categories);

    expect(rows).toEqual([expect.objectContaining({ name: "Mystery Snack", category_id: null })]);
    expect(errors[0]).toMatch(/unknown category/);
  });

  it("skips fully blank rows", () => {
    const csv = "name,price\nItem A,10\n,\nItem B,20";
    const { rows } = parseFoodItemsCsv(csv, categories);
    expect(rows.map((r) => r.name)).toEqual(["Item A", "Item B"]);
  });
});

describe("bulkImportFoodItems", () => {
  beforeEach(() => upsertFoodItem.mockReset());

  it("updates an existing item matched by name and creates a new one", async () => {
    upsertFoodItem.mockResolvedValue({});
    const existingItems = [{ id: "item-1", name: "Masala Dosa", sku: "" }];
    const rows = [
      { id: null, sku: "", name: "Masala Dosa", price: 65 },
      { id: null, sku: "", name: "Filter Coffee", price: 20 },
    ];

    const result = await bulkImportFoodItems("canteen-1", rows, existingItems);

    expect(result).toEqual({ created: 1, updated: 1, errors: [] });
    expect(upsertFoodItem).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "item-1", canteen_id: "canteen-1" }));
    expect(upsertFoodItem).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: undefined, name: "Filter Coffee", canteen_id: "canteen-1" }));
  });

  it("matches by SKU when name differs", async () => {
    upsertFoodItem.mockResolvedValue({});
    const existingItems = [{ id: "item-1", name: "Old Name", sku: "TEA01" }];
    const rows = [{ id: null, sku: "tea01", name: "New Name", price: 15 }];

    await bulkImportFoodItems("canteen-1", rows, existingItems);

    expect(upsertFoodItem).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
  });

  it("collects a per-row error without aborting the rest of the import", async () => {
    upsertFoodItem
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("duplicate name"));
    const rows = [
      { id: null, sku: "", name: "Item A", price: 10 },
      { id: null, sku: "", name: "Item B", price: 20 },
    ];

    const result = await bulkImportFoodItems("canteen-1", rows, []);

    expect(result.created).toBe(1);
    expect(result.errors).toEqual(["Item B: duplicate name"]);
  });
});

describe("setOrderOpsFields (priority / internal note / staff assignment)", () => {
  it("calls the RPC with the order id and all three fields", async () => {
    mockRpc.mockResolvedValue({ data: { id: "order-1", priority: "high" }, error: null });

    const result = await setOrderOpsFields("order-1", { priority: "high", internalNote: "extra spicy", assignedStaffName: "Ravi" });

    expect(mockRpc).toHaveBeenCalledWith("set_order_ops_fields", {
      p_order_id: "order-1",
      p_priority: "high",
      p_internal_note: "extra spicy",
      p_assigned_staff_name: "Ravi",
    });
    expect(result).toEqual({ id: "order-1", priority: "high" });
  });

  it("normalises missing note/staff to empty strings rather than undefined", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });

    await setOrderOpsFields("order-1", { priority: "normal" });

    expect(mockRpc).toHaveBeenCalledWith("set_order_ops_fields", expect.objectContaining({
      p_internal_note: "", p_assigned_staff_name: "",
    }));
  });

  it("throws the RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Not authorized to update this order" } });
    await expect(setOrderOpsFields("order-1", { priority: "normal" })).rejects.toMatchObject({ message: "Not authorized to update this order" });
  });
});

describe("canteen staff roster", () => {
  it("listCanteenStaff scopes to the canteen", async () => {
    const builder = chain({ data: [{ id: "staff-1", name: "Ravi" }], error: null });
    mockFrom.mockReturnValue(builder);

    const result = await listCanteenStaff("canteen-1");

    expect(mockFrom).toHaveBeenCalledWith("canteen_staff");
    expect(builder.eq).toHaveBeenCalledWith("canteen_id", "canteen-1");
    expect(result).toEqual([{ id: "staff-1", name: "Ravi" }]);
  });

  it("addCanteenStaff inserts a trimmed name", async () => {
    const builder = chain({ data: { id: "staff-1", name: "Ravi" }, error: null });
    builder.insert = jest.fn(() => builder);
    mockFrom.mockReturnValue(builder);

    await addCanteenStaff("canteen-1", "  Ravi  ");

    expect(builder.insert).toHaveBeenCalledWith({ canteen_id: "canteen-1", name: "Ravi" });
  });

  it("setCanteenStaffActive updates the active flag", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await setCanteenStaffActive("staff-1", false);

    expect(builder.update).toHaveBeenCalledWith({ active: false });
    expect(builder.eq).toHaveBeenCalledWith("id", "staff-1");
  });

  it("removeCanteenStaff deletes the row", async () => {
    const builder = chain({ error: null });
    mockFrom.mockReturnValue(builder);

    await removeCanteenStaff("staff-1");

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "staff-1");
  });
});

describe("getCanteenDashboardStats", () => {
  it("summarizes today's orders/revenue/pending/stock into one object", async () => {
    const ordersBuilder = chain({
      data: [
        { id: "o1", total: 100, status: "RECEIVED" },   // pending, counts toward revenue
        { id: "o2", total: 50, status: "COMPLETED" },    // not pending, counts toward revenue
        { id: "o3", total: 30, status: "CANCELLED" },    // excluded from revenue
      ],
      error: null,
    });
    const itemsBuilder = chain({
      data: [
        { id: "i1", stock_quantity: 2, low_stock_threshold: 5 },  // low stock
        { id: "i2", stock_quantity: 0, low_stock_threshold: 5 },  // out of stock
        { id: "i3", stock_quantity: 20, low_stock_threshold: 5 }, // fine
      ],
      error: null,
    });
    mockFrom.mockImplementation((table) => (table === "orders" ? ordersBuilder : itemsBuilder));

    const stats = await getCanteenDashboardStats("canteen-1");

    expect(ordersBuilder.eq).toHaveBeenCalledWith("canteen_id", "canteen-1");
    expect(itemsBuilder.eq).toHaveBeenCalledWith("canteen_id", "canteen-1");
    expect(stats).toEqual({
      ordersToday: 3,
      revenueToday: 150,
      pendingCount: 1,
      lowStockCount: 1,
      outOfStockCount: 1,
    });
  });

  it("throws if either query errors", async () => {
    const ordersBuilder = chain({ data: null, error: { message: "boom" } });
    const itemsBuilder = chain({ data: [], error: null });
    mockFrom.mockImplementation((table) => (table === "orders" ? ordersBuilder : itemsBuilder));

    await expect(getCanteenDashboardStats("canteen-1")).rejects.toMatchObject({ message: "boom" });
  });
});

describe("getPrintShopDashboardStats", () => {
  it("summarizes today's print jobs by status and sums revenue, excluding unpaid/cancelled jobs", async () => {
    const builder = chain({
      data: [
        { id: "j1", status: "PROCESSING", price: 40 },
        { id: "j2", status: "READY", price: 60 },
        { id: "j3", status: "COLLECTED", price: 20 },
        { id: "j4", status: "AWAITING_PAYMENT", price: 100 },
        { id: "j5", status: "CANCELLED", price: 30 },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    const stats = await getPrintShopDashboardStats();

    expect(mockFrom).toHaveBeenCalledWith("print_jobs");
    expect(stats).toEqual({ jobsToday: 5, activeCount: 1, readyCount: 1, revenueToday: 120 });
  });
});

describe("print binding rates / shop status (doc §29-30)", () => {
  beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });

  it("getMyPrintBindingRates looks up the row for this campus", async () => {
    const builder = chain({ data: { campus_id: "campus-1", staple_fee: 20, spiral_fee: 40 }, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await getMyPrintBindingRates("campus-1");

    expect(mockFrom).toHaveBeenCalledWith("print_binding_rates");
    expect(builder.eq).toHaveBeenCalledWith("campus_id", "campus-1");
    expect(result.spiral_fee).toBe(40);
  });

  it("updatePrintBindingRates writes both fees for the campus", async () => {
    const builder = chain({ data: { staple_fee: 25, spiral_fee: 45 }, error: null });
    mockFrom.mockReturnValue(builder);

    await updatePrintBindingRates("campus-1", { stapleFee: 25, spiralFee: 45 });

    expect(builder.update).toHaveBeenCalledWith({ staple_fee: 25, spiral_fee: 45 });
    expect(builder.eq).toHaveBeenCalledWith("campus_id", "campus-1");
  });

  it("getMyPrintShopStatus filters by campus", async () => {
    const builder = chain({ data: { status: "online" }, error: null });
    mockFrom.mockReturnValue(builder);

    const status = await getMyPrintShopStatus("campus-1");

    expect(mockFrom).toHaveBeenCalledWith("print_shop_status");
    expect(builder.eq).toHaveBeenCalledWith("campus_id", "campus-1");
    expect(status.status).toBe("online");
  });

  it("setPrintShopStatus calls the RPC with status and message", async () => {
    mockRpc.mockResolvedValue({ data: { status: "offline", message: "Out of toner" }, error: null });

    const result = await setPrintShopStatus("offline", "Out of toner");

    expect(mockRpc).toHaveBeenCalledWith("set_print_shop_status", { p_status: "offline", p_message: "Out of toner" });
    expect(result.status).toBe("offline");
  });
});

describe("print job queue (doc §29-30)", () => {
  beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); mockStorageFrom.mockReset(); });

  it("listActivePrintJobs filters to active statuses and attaches uploader profiles", async () => {
    const builder = chain({ data: [{ id: "job-1", user_id: "u1", status: "QUEUED" }], error: null });
    mockFrom.mockReturnValue(builder);
    mockRpc.mockResolvedValue({ data: [{ id: "u1", name: "Alice" }], error: null });

    const jobs = await listActivePrintJobs();

    expect(builder.in).toHaveBeenCalledWith("status", ["UPLOADED", "PROCESSING", "QUEUED", "PRINTING", "READY"]);
    expect(mockRpc).toHaveBeenCalledWith("get_profile_snippets", { p_ids: ["u1"] });
    expect(jobs[0].profiles).toEqual({ id: "u1", name: "Alice" });
  });

  it("listPrintJobHistory filters to terminal statuses, newest first, capped", async () => {
    const builder = chain({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    await listPrintJobHistory({ limit: 10 });

    expect(builder.in).toHaveBeenCalledWith("status", ["COLLECTED", "CANCELLED", "FAILED"]);
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("transitionPrintJob calls the RPC with job id, new status and pickup code", async () => {
    mockRpc.mockResolvedValue({ data: { id: "job-1", status: "COLLECTED" }, error: null });

    await transitionPrintJob("job-1", "COLLECTED", "482913");

    expect(mockRpc).toHaveBeenCalledWith("transition_print_job", {
      p_job_id: "job-1",
      p_new_status: "COLLECTED",
      p_pickup_code: "482913",
    });
  });

  it("transitionPrintJob sends null when no pickup code is given (non-COLLECTED transitions)", async () => {
    mockRpc.mockResolvedValue({ data: { id: "job-1", status: "PROCESSING" }, error: null });

    await transitionPrintJob("job-1", "PROCESSING");

    expect(mockRpc).toHaveBeenCalledWith("transition_print_job", {
      p_job_id: "job-1",
      p_new_status: "PROCESSING",
      p_pickup_code: null,
    });
  });

  it("surfaces a mismatched pickup code as a rejected promise", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Pickup code does not match" } });
    await expect(transitionPrintJob("job-1", "COLLECTED", "000000")).rejects.toMatchObject({ message: "Pickup code does not match" });
  });

  it("getPrintFileSignedUrl resolves a signed URL for preview/download", async () => {
    const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/report.pdf" }, error: null });
    mockStorageFrom.mockReturnValue({ createSignedUrl });

    const url = await getPrintFileSignedUrl("user-1/report.pdf");

    expect(mockStorageFrom).toHaveBeenCalledWith("print-files");
    expect(createSignedUrl).toHaveBeenCalledWith("user-1/report.pdf", 300);
    expect(url).toBe("https://signed.example/report.pdf");
  });

  it("getPrintFileSignedUrl returns null without a storage call when the file was already cleaned up", async () => {
    const createSignedUrl = jest.fn();
    mockStorageFrom.mockReturnValue({ createSignedUrl });
    expect(await getPrintFileSignedUrl(null)).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("initiateRefund", () => {
  beforeEach(() => { mockRpc.mockReset(); mockFunctionsInvoke.mockReset(); });

  it("calls request_refund then the razorpay-refund Edge Function with the resulting refund id", async () => {
    mockRpc.mockResolvedValue({ data: { id: "refund-1", amount: 120 }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: { ok: true, refund: { status: "completed" } }, error: null });

    const result = await initiateRefund("order-1", 120, "Kitchen ran out of stock");

    expect(mockRpc).toHaveBeenCalledWith("request_refund", { p_order_id: "order-1", p_amount: 120, p_reason: "Kitchen ran out of stock" });
    expect(mockFunctionsInvoke).toHaveBeenCalledWith("razorpay-refund", { body: { refund_id: "refund-1" } });
    expect(result).toEqual({ ok: true, refund: { status: "completed" } });
  });

  it("throws if request_refund itself fails, without ever calling the Edge Function", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Not authorized to issue refunds for this order" } });

    await expect(initiateRefund("order-1", 120, "reason")).rejects.toMatchObject({ message: "Not authorized to issue refunds for this order" });
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it("throws if the Edge Function call fails", async () => {
    mockRpc.mockResolvedValue({ data: { id: "refund-1" }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: null, error: { message: "GATEWAY_NOT_CONFIGURED" } });

    await expect(initiateRefund("order-1", 120, "reason")).rejects.toMatchObject({ message: "GATEWAY_NOT_CONFIGURED" });
  });
});
