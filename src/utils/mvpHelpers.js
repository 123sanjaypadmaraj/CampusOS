export function mergeCartItem(cart, item) {
  const existing = cart.find((entry) => entry.id === item.id);
  return existing
    ? cart.map((entry) => entry.id === item.id
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

