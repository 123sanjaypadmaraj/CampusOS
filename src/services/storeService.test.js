jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import { supabase } from "../lib/supabase";
import {
  getStores,
  getStoreItems,
  createStoreOrder,
  transitionStoreOrderStatus,
  getMyStoreOrders,
  subscribeToStores,
  subscribeToStoreOrders,
} from "./storeService";

describe("storeService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getStores only fetches active stores, optionally scoped to a campus", async () => {
    const order = jest.fn().mockResolvedValue({ data: [{ id: "s1" }], error: null });
    const eqCampus = jest.fn(() => ({ order }));
    const eqActive = jest.fn(() => ({ eq: eqCampus, order }));
    const select = jest.fn(() => ({ eq: eqActive }));
    supabase.from.mockReturnValue({ select });

    const result = await getStores("campus-1");

    expect(supabase.from).toHaveBeenCalledWith("stores");
    expect(eqActive).toHaveBeenCalledWith("active", true);
    expect(eqCampus).toHaveBeenCalledWith("campus_id", "campus-1");
    expect(order).toHaveBeenCalledWith("name");
    expect(result).toEqual([{ id: "s1" }]);
  });

  it("getStoreItems only fetches active, available items (with their variants), optionally scoped to a store", async () => {
    const order = jest.fn().mockResolvedValue({ data: [{ id: "i1" }], error: null });
    const eqStore = jest.fn(() => ({ order }));
    const eqAvailable = jest.fn(() => ({ eq: eqStore, order }));
    const eqActive = jest.fn(() => ({ eq: eqAvailable }));
    const select = jest.fn(() => ({ eq: eqActive }));
    supabase.from.mockReturnValue({ select });

    const result = await getStoreItems("store-1");

    expect(supabase.from).toHaveBeenCalledWith("store_items");
    expect(select).toHaveBeenCalledWith("*, store_item_variants(*)");
    expect(eqActive).toHaveBeenCalledWith("active", true);
    expect(eqAvailable).toHaveBeenCalledWith("available", true);
    expect(eqStore).toHaveBeenCalledWith("store_id", "store-1");
    expect(order).toHaveBeenCalledWith("name");
    expect(result).toEqual([{ id: "i1" }]);
  });

  it("createStoreOrder maps a cart into the RPC's {store_item_id, variant_id, quantity} shape", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "order-1", status: "PLACED" }, error: null });

    await createStoreOrder({
      storeId: "store-1",
      cart: [
        { id: "item-1", quantity: 2 },
        { id: "item-2" },
        { id: "item-3", variantId: "variant-1", quantity: 1 },
      ],
      idempotencyKey: "key-1",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_store_order", {
      p_store_id: "store-1",
      p_items: [
        { store_item_id: "item-1", variant_id: null, quantity: 2 },
        { store_item_id: "item-2", variant_id: null, quantity: 1 },
        { store_item_id: "item-3", variant_id: "variant-1", quantity: 1 },
      ],
      p_notes: "",
      p_idempotency_key: "key-1",
    });
  });

  it("createStoreOrder propagates ORDER_ITEM_UNAVAILABLE rather than swallowing it", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("ORDER_ITEM_UNAVAILABLE: Lab Coat is currently out of stock") });

    await expect(createStoreOrder({ storeId: "s1", cart: [{ id: "i1" }] })).rejects.toThrow("ORDER_ITEM_UNAVAILABLE");
  });

  it("transitionStoreOrderStatus passes the reason through when given", async () => {
    supabase.rpc.mockResolvedValue({ data: { status: "CANCELLED" }, error: null });

    await transitionStoreOrderStatus("order-1", "CANCEL_REQUESTED", "changed my mind");

    expect(supabase.rpc).toHaveBeenCalledWith("transition_store_order_status", {
      p_order_id: "order-1",
      p_to_status: "CANCEL_REQUESTED",
      p_reason: "changed my mind",
    });
  });

  it("getMyStoreOrders returns [] without a userId, without querying", async () => {
    expect(await getMyStoreOrders(null)).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("subscribeToStoreOrders filters realtime updates to the signed-in user", () => {
    const on = jest.fn().mockReturnThis();
    const subscribe = jest.fn().mockReturnThis();
    supabase.channel.mockReturnValue({ on, subscribe });

    subscribeToStoreOrders("user-1", jest.fn());

    expect(supabase.channel).toHaveBeenCalledWith("store_orders:user-1");
    expect(on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "store_orders", filter: "user_id=eq.user-1" },
      expect.any(Function)
    );
  });

  it("subscribeToStores watches both stores and store_items without a filter", () => {
    const on = jest.fn().mockReturnThis();
    const subscribe = jest.fn().mockReturnThis();
    supabase.channel.mockReturnValue({ on, subscribe });

    subscribeToStores(jest.fn());

    expect(on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "public", table: "stores" }, expect.any(Function));
    expect(on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "public", table: "store_items" }, expect.any(Function));
  });
});
