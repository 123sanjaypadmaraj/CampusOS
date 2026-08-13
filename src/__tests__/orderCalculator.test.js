import { groupCartItems, calculateOrderSummary } from "../utils/orderCalculator";

describe("orderCalculator", () => {
  test("returns empty summary for empty cart", () => {
    const summary = calculateOrderSummary([]);
    expect(summary.items).toEqual([]);
    expect(summary.itemCount).toBe(0);
    expect(summary.subtotal).toBe(0);
    expect(summary.breakdown.totalTaxesAndCharges).toBe(0);
    expect(summary.finalTotal).toBe(0);
  });

  test("groups duplicate items and calculates quantities correctly", () => {
    const rawCart = [
      { id: 101, name: "Masala Dosa", price: 45, vendor: "Udupi" },
      { id: 101, name: "Masala Dosa", price: 45, vendor: "Udupi" },
      { id: 102, name: "Idli Vada", price: 35, vendor: "Udupi" },
    ];

    const grouped = groupCartItems(rawCart);
    expect(grouped).toHaveLength(2);

    const dosa = grouped.find((i) => i.id === 101);
    expect(dosa.quantity).toBe(2);
    expect(dosa.unitPrice).toBe(45);
    expect(dosa.itemSubtotal).toBe(90);

    const idli = grouped.find((i) => i.id === 102);
    expect(idli.quantity).toBe(1);
    expect(idli.unitPrice).toBe(35);
    expect(idli.itemSubtotal).toBe(35);
  });

  test("calculates subtotal, taxes (5% GST + ₹10 Packaging + ₹25 Delivery), and final total accurately under ₹200", () => {
    const rawCart = [
      { id: 101, name: "Masala Dosa", price: 45, vendor: "Udupi" }, // ₹45
      { id: 102, name: "Idli Vada", price: 35, vendor: "Udupi" },   // ₹35
    ];

    const summary = calculateOrderSummary(rawCart);
    // Subtotal = 45 + 35 = 80
    expect(summary.subtotal).toBe(80);
    expect(summary.itemCount).toBe(2);

    // GST (5%) = 80 * 0.05 = 4
    expect(summary.breakdown.gstAmount).toBe(4);

    // Packaging Fee = 10
    expect(summary.breakdown.packagingFee).toBe(10);

    // Delivery Fee = 25 (since subtotal 80 < 200)
    expect(summary.breakdown.deliveryFee).toBe(25);

    // Total Taxes & Charges = 4 + 10 + 25 = 39
    expect(summary.breakdown.totalTaxesAndCharges).toBe(39);

    // Final Total = 80 + 39 = 119
    expect(summary.finalTotal).toBe(119);
  });

  test("waives delivery fee for orders >= ₹200", () => {
    const rawCart = [
      { id: 203, name: "Chicken Biryani", price: 120, vendor: "Tango" }, // 2x120 = 240
      { id: 203, name: "Chicken Biryani", price: 120, vendor: "Tango" },
    ];

    const summary = calculateOrderSummary(rawCart);
    expect(summary.subtotal).toBe(240);
    expect(summary.breakdown.deliveryFee).toBe(0);
    expect(summary.breakdown.isDeliveryFree).toBe(true);

    // GST (5%) = 240 * 0.05 = 12
    expect(summary.breakdown.gstAmount).toBe(12);
    // Packaging Fee = 10
    expect(summary.breakdown.packagingFee).toBe(10);
    // Total Taxes = 12 + 10 + 0 = 22
    expect(summary.breakdown.totalTaxesAndCharges).toBe(22);
    // Final Total = 240 + 22 = 262
    expect(summary.finalTotal).toBe(262);
  });
});
