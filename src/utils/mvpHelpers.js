export function mergeCartItem(cart, item) {
  // variantId is undefined for every non-variant caller (plain store items),
  // so `undefined === undefined` keeps those merging exactly as before --
  // this only changes behavior for items that carry a variantId, keeping
  // different variants of the same product as separate cart lines instead
  // of merging their quantities together. addonKey does the same for food
  // items with a modifier/add-on selection (a stable string built by the
  // caller from the chosen option ids) -- two identical items with
  // different add-ons stay as separate lines too.
  const sameLine = (entry) => entry.id === item.id && entry.variantId === item.variantId && entry.addonKey === item.addonKey;
  const existing = cart.find(sameLine);
  return existing
    ? cart.map((entry) => sameLine(entry)
      ? { ...entry, quantity: Number(entry.quantity || 1) + 1 }
      : entry)
    : [...cart, { ...item, quantity: 1 }];
}

// Stable, order-independent key for a set of chosen add-on option ids, used
// as mergeCartItem's addonKey so "same item, same add-ons" merges into one
// cart line while any different selection starts a new one.
export function addonSelectionKey(addonOptionIds) {
  if (!addonOptionIds || !addonOptionIds.length) return undefined;
  return [...addonOptionIds].sort().join(",");
}

// Client-side mirror of public.is_food_item_available_now() (SQL), used
// only for display (a greyed-out "not served right now" badge) -- the RPC
// is still the sole source of truth and re-checks this itself at order time.
export function isFoodItemAvailableNow(item, now = new Date()) {
  const days = item?.availableDays;
  if (Array.isArray(days) && days.length && !days.includes(now.getDay())) return false;
  const from = item?.availableFrom;
  const to = item?.availableTo;
  if (!from || !to) return true;
  const mins = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const fromMins = fh * 60 + fm;
  const toMins = th * 60 + tm;
  return toMins > fromMins ? mins >= fromMins && mins <= toMins : mins >= fromMins || mins <= toMins;
}

// Client-side mirror of public.is_canteen_open() (SQL) -- status/closures/
// weekly hours, same fallback rule (no canteen_hours rows configured at all
// means "trust the status field alone"). Display only, same caveat as above.
export function isCanteenOpenNow(canteen, now = new Date()) {
  if (!canteen || canteen.status === "Closed") return false;
  const closures = canteen.closures || [];
  if (closures.some((c) => new Date(c.starts_at) <= now && now <= new Date(c.ends_at))) return false;
  const hours = canteen.hours || [];
  if (!hours.length) return true;
  const today = hours.find((h) => h.day_of_week === now.getDay());
  if (!today || today.closed) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = today.opens_at.split(":").map(Number);
  const [ch, cm] = today.closes_at.split(":").map(Number);
  const opensMins = oh * 60 + om;
  const closesMins = ch * 60 + cm;
  return closesMins > opensMins ? mins >= opensMins && mins <= closesMins : mins >= opensMins || mins <= closesMins;
}

// `pricePerPage`/`bindingFee` are optional live overrides (fetched from
// print_rate_card / print_binding_rates so the pre-upload estimate matches
// what create_print_job() will actually charge); without them this falls
// back to the same flat placeholder values it always used. Real pricing is
// still always computed server-side -- this is only ever a UI estimate.
export function calculatePrintJobPrice({ pages, copies, colorMode, binding, pricePerPage, bindingFee }) {
  const pageCount = Number(pages);
  const copyCount = Number(copies);
  if (!Number.isInteger(pageCount) || pageCount < 1 || !Number.isInteger(copyCount) || copyCount < 1) {
    throw new Error("Pages and copies must be positive whole numbers.");
  }
  if (pricePerPage != null || bindingFee != null) {
    const rate = pricePerPage != null ? Number(pricePerPage) : (colorMode === "color" || colorMode === "colour" ? 5 : 2);
    const fee = binding ? (bindingFee != null ? Number(bindingFee) : 20) : 0;
    return pageCount * copyCount * rate + fee * copyCount;
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

