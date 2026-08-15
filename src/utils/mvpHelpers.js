export function mergeCartItem(cart, item) {
  // variantId is undefined for every non-variant caller (food, plain store
  // items), so `undefined === undefined` keeps those merging exactly as
  // before -- this only changes behavior for store items that carry a
  // variantId, keeping different variants of the same product as separate
  // cart lines instead of merging their quantities together.
  const sameLine = (entry) => entry.id === item.id && entry.variantId === item.variantId;
  const existing = cart.find(sameLine);
  return existing
    ? cart.map((entry) => sameLine(entry)
      ? { ...entry, quantity: Number(entry.quantity || 1) + 1 }
      : entry)
    : [...cart, { ...item, quantity: 1 }];
}

export function calculatePrintJobPrice({ pages, copies, colorMode, binding }) {
  const pageCount = Number(pages);
  const copyCount = Number(copies);
  if (!Number.isInteger(pageCount) || pageCount < 1 || !Number.isInteger(copyCount) || copyCount < 1) {
    throw new Error("Pages and copies must be positive whole numbers.");
  }
  return pageCount * copyCount * (colorMode === "color" || colorMode === "colour" ? 5 : 2)
    + (binding ? 20 : 0);
}

export function hasValidBookingRange(startTime, endTime) {
  return Boolean(startTime && endTime && new Date(endTime) > new Date(startTime));
}

export function isUuid(val) {
  if (typeof val !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
}

