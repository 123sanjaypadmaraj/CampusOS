import {
  calculatePrintJobPrice,
  hasValidBookingRange,
  isUuid,
  mergeCartItem,
} from "./mvpHelpers";

describe("CampusOS MVP helpers", () => {
  test("increments quantity for a duplicate food item", () => {
    const cart = mergeCartItem([], { id: "dosa", name: "Dosa", price: 40 });
    expect(mergeCartItem(cart, { id: "dosa", name: "Dosa", price: 40 }))
      .toEqual([{ id: "dosa", name: "Dosa", price: 40, quantity: 2 }]);
  });

  test("adds a different item without changing existing quantities", () => {
    const cart = [{ id: "dosa", price: 40, quantity: 2 }];
    expect(mergeCartItem(cart, { id: "coffee", price: 25 }))
      .toEqual([{ id: "dosa", price: 40, quantity: 2 }, { id: "coffee", price: 25, quantity: 1 }]);
  });

  test("calculates print pricing consistently", () => {
    expect(calculatePrintJobPrice({ pages: 10, copies: 2, colorMode: "colour", binding: true }))
      .toBe(120);
  });

  test("rejects invalid print quantities", () => {
    expect(() => calculatePrintJobPrice({ pages: 0, copies: 1, colorMode: "black_white" }))
      .toThrow("Pages and copies must be positive whole numbers.");
  });

  test("requires a strictly increasing booking range", () => {
    expect(hasValidBookingRange("2026-08-12T10:00", "2026-08-12T11:00")).toBe(true);
    expect(hasValidBookingRange("2026-08-12T11:00", "2026-08-12T10:00")).toBe(false);
  });

  test("validates UUID strings correctly", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("00000000-0000-4000-a000-000000000001")).toBe(true);
    expect(isUuid(1)).toBe(false);
    expect(isUuid("1")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
