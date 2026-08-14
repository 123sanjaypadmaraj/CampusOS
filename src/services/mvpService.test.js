/**
 * Unit tests for the client-side parts of the data layer: cart grouping
 * sent to create_food_order(), the {code, message} error-shape parsing
 * (doc §81), and the waitlist branch of event registration. The
 * authoritative pricing/permission/state-machine logic itself lives in
 * Postgres (supabase/migrations/) and is exercised by the RPC contract
 * these tests assert against, not re-implemented here.
 */

jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

import { supabase } from "../lib/supabase";
import {
  createFoodOrder,
  registerEvent,
  isValidPhone,
  transitionOrderStatus,
  startFoodOrderPayment,
} from "./mvpService";

describe("createFoodOrder", () => {
  beforeEach(() => jest.clearAllMocks());

  it("groups duplicate cart entries into quantities before calling the RPC", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "order-1", status: "PAYMENT_PENDING" }, error: null });

    await createFoodOrder({
      userId: "user-1",
      canteenId: "canteen-1",
      cart: [
        { id: "item-1", price: 55 },
        { id: "item-1", price: 55 },
        { id: "item-2", price: 90 },
      ],
      idempotencyKey: "key-1",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_food_order", {
      p_canteen_id: "canteen-1",
      p_items: [
        { food_item_id: "item-1", quantity: 2, special_instructions: null },
        { food_item_id: "item-2", quantity: 1, special_instructions: null },
      ],
      p_notes: "",
      p_fulfillment_type: "pickup",
      p_idempotency_key: "key-1",
    });
  });

  it("strips the ORDER_* code prefix from the RPC error before surfacing it", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "ORDER_ITEM_UNAVAILABLE: Masala Dosa is currently unavailable" },
    });

    await expect(
      createFoodOrder({ userId: "user-1", canteenId: "canteen-1", cart: [{ id: "item-1", price: 55 }] })
    ).rejects.toThrow("Masala Dosa is currently unavailable");
  });

  it("rejects locally without calling the RPC when the cart is empty", async () => {
    await expect(
      createFoodOrder({ userId: "user-1", canteenId: "canteen-1", cart: [] })
    ).rejects.toThrow(/cart is empty/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("requires sign-in before ever touching the network", async () => {
    await expect(
      createFoodOrder({ userId: null, canteenId: "canteen-1", cart: [{ id: "item-1" }] })
    ).rejects.toThrow(/sign in/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("registerEvent", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends the confirmed contact phone number along with the event id", async () => {
    supabase.rpc.mockResolvedValue({ data: { status: "confirmed", registration_id: "reg-1" }, error: null });

    await registerEvent({
      eventId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      contactPhone: "9876543210",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("register_for_event", {
      p_event_id: "11111111-1111-4111-8111-111111111111",
      p_contact_phone: "9876543210",
    });
  });

  it("returns the waitlist position when the RPC reports the event is full", async () => {
    supabase.rpc.mockResolvedValue({ data: { status: "waitlisted", position: 4 }, error: null });

    const result = await registerEvent({
      eventId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      contactPhone: "9876543210",
    });

    expect(result).toEqual({ status: "waitlisted", position: 4 });
  });

  it("rejects locally without calling the RPC when the phone number is missing or invalid", async () => {
    await expect(
      registerEvent({ eventId: "11111111-1111-4111-8111-111111111111", userId: "user-1", contactPhone: "" })
    ).rejects.toThrow(/valid phone number/i);

    await expect(
      registerEvent({ eventId: "11111111-1111-4111-8111-111111111111", userId: "user-1", contactPhone: "abc123" })
    ).rejects.toThrow(/valid phone number/i);

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("requires sign-in before ever touching the network", async () => {
    await expect(
      registerEvent({ eventId: "11111111-1111-4111-8111-111111111111", userId: null, contactPhone: "9876543210" })
    ).rejects.toThrow(/sign in/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("isValidPhone", () => {
  it("accepts 7-15 digit numbers with an optional leading +", () => {
    expect(isValidPhone("9876543210")).toBe(true);
    expect(isValidPhone("+919876543210")).toBe(true);
    expect(isValidPhone(" 9876543210 ")).toBe(true);
  });

  it("rejects too-short, too-long, and non-numeric input", () => {
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("1234567890123456")).toBe(false);
    expect(isValidPhone("98765-43210")).toBe(false);
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone(null)).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
  });
});

describe("transitionOrderStatus", () => {
  it("rejects an illegal transition surfaced by the DB state machine", async () => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "ORDER_INVALID_TRANSITION: cannot move READY -> PAID" },
    });

    await expect(transitionOrderStatus("order-1", "PAID")).rejects.toThrow("cannot move READY -> PAID");
  });
});

describe("startFoodOrderPayment", () => {
  it("invokes the create-razorpay-order Edge Function with the order id", async () => {
    jest.clearAllMocks();
    supabase.functions.invoke.mockResolvedValue({
      data: { key_id: "rzp_test_x", gateway_order_id: "order_x", amount: 6775, currency: "INR" },
      error: null,
    });

    const result = await startFoodOrderPayment("order-1");

    expect(supabase.functions.invoke).toHaveBeenCalledWith("create-razorpay-order", { body: { order_id: "order-1" } });
    expect(result.gateway_order_id).toBe("order_x");
  });

  it("surfaces a friendly error when the gateway isn't configured", async () => {
    jest.clearAllMocks();
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: "GATEWAY_NOT_CONFIGURED" },
    });

    await expect(startFoodOrderPayment("order-1")).rejects.toThrow();
  });
});
