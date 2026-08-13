/**
 * ============================================================================
 * Order Calculation Module (Campus OS)
 * ============================================================================
 * 
 * Purpose:
 * Provides isolated calculation logic for cart items, item subtotals,
 * taxes/charges, and the final order total for the digital invoice.
 * 
 * Future Backend & Razorpay Integration Architecture:
 * --------------------------------------------------
 * Currently, frontend data is used to compute and preview the invoice.
 * Once the backend is implemented, this calculation module will be replaced
 * by a backend API call (e.g. POST /api/orders/calculate-total).
 * 
 * Order Flow:
 * Cart (Frontend) -> Backend (Validate Prices in DB) -> Authoritative Total -> Razorpay Order Creation -> Client Verification
 * 
 * Keep this module isolated so that replacing local calculation with a backend
 * fetch requires zero changes to the UI components.
 * ============================================================================
 */

/**
 * Group raw cart items array by item ID and compute quantity and item subtotals.
 * Handles both flat arrays (e.g. [item1, item1]) and items with existing quantity fields.
 * 
 * @param {Array} cart - Raw cart array from state
 * @returns {Array} Grouped items with quantity, unitPrice, and itemSubtotal
 */
export function groupCartItems(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    return [];
  }

  const itemMap = new Map();

  for (const item of cart) {
    if (!item) continue;
    const id = item.id;
    if (id === undefined || id === null) continue;

    const unitPrice = Number(item.price || item.unitPrice || 0);
    const itemQty = Number(item.quantity || 1);

    if (itemMap.has(id)) {
      const existing = itemMap.get(id);
      existing.quantity += itemQty;
      existing.itemSubtotal = existing.unitPrice * existing.quantity;
    } else {
      itemMap.set(id, {
        id,
        name: item.name || "Unnamed Item",
        vendor: item.vendor || item.category || "Campus Store",
        category: item.category || "",
        unitPrice: unitPrice,
        quantity: itemQty,
        itemSubtotal: unitPrice * itemQty,
        image: item.image || null,
      });
    }
  }

  return Array.from(itemMap.values());
}

/**
 * Calculate full order summary including subtotal, taxes, charges, and final total.
 * 
 * @param {Array} cartInput - Raw cart items or pre-grouped items
 * @param {Object} options - Configuration for tax rates and packaging/delivery fees
 * @returns {Object} Order summary object suitable for rendering the Digital Invoice
 */
export function calculateOrderSummary(cartInput, options = {}) {
  const items = groupCartItems(cartInput);

  // Calculate raw subtotal from item subtotals
  const subtotal = items.reduce((acc, item) => acc + item.itemSubtotal, 0);

  // Project Tax & Charges Assumptions:
  // 1. GST: 5% standard food & campus service tax
  // 2. Packaging / Platform Fee: ₹10 fixed fee when items are present
  // 3. Delivery Fee: ₹25 for orders under ₹200 (Waived / FREE for orders >= ₹200)
  const gstRate = options.gstRate !== undefined ? options.gstRate : 0.05;
  const defaultPackagingFee = subtotal > 0 ? 10 : 0;
  const packagingFee = options.packagingFee !== undefined ? options.packagingFee : defaultPackagingFee;
  
  const defaultDeliveryFee = subtotal > 0 ? (subtotal >= 200 ? 0 : 25) : 0;
  const deliveryFee = options.deliveryFee !== undefined ? options.deliveryFee : defaultDeliveryFee;

  const gstAmount = Math.round(subtotal * gstRate * 100) / 100;
  const totalTaxesAndCharges = Math.round((gstAmount + packagingFee + deliveryFee) * 100) / 100;
  const finalTotal = Math.round((subtotal + totalTaxesAndCharges) * 100) / 100;

  return {
    items,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: Math.round(subtotal * 100) / 100,
    breakdown: {
      gstRatePercent: Math.round(gstRate * 100),
      gstAmount,
      packagingFee,
      deliveryFee,
      isDeliveryFree: subtotal >= 200,
      totalTaxesAndCharges,
    },
    finalTotal,
    // Metadata for digital invoice rendering
    currency: "₹",
    invoiceDate: new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}
