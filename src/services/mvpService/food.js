/**
 * FOOD
 *
 * Canteen/menu listing and the food order lifecycle (create, pay, track).
 */

import { supabase } from "../../lib/supabase";
import { withOfflineCache } from "../../utils/offlineCache";
import { throwIfError } from "./_shared.js";
import { logClientError } from "./errorLogging.js";

export async function getCampusFood(campusId) {
  // Doc §9 "Offline Mode": "previously loaded menus".
  return withOfflineCache(`food:${campusId || "default"}`, async () => {
    const [
      canteenResult,
      foodResult,
      hoursResult,
      closuresResult,
    ] = await Promise.all([
      (() => {
        let q = supabase
          .from("canteens")
          .select(`
            id,
            name,
            subtitle,
            status,
            eta_min,
            eta_max,
            queue_level,
            load,
            color,
            active
          `)
          .eq("active", true)
          .order("name");
        if (campusId) q = q.eq("campus_id", campusId);
        return q;
      })(),

      supabase
        .from("food_items")
        .select(`
          id,
          canteen_id,
          name,
          description,
          price,
          image_url,
          is_vegetarian,
          available,
          dietary_tags,
          allergens,
          spice_level,
          calories,
          available_days,
          available_from,
          available_to,
          food_categories (
            id,
            name
          ),
          food_item_variants (
            id, name, price, available, active
          ),
          food_item_addon_groups (
            id, name, min_select, max_select, active,
            food_item_addon_options ( id, name, price_delta, available, active )
          )
        `)
        .eq("available", true)
        .order("name"),

      supabase.from("canteen_hours").select("canteen_id, day_of_week, opens_at, closes_at, closed"),
      supabase.from("canteen_closures").select("canteen_id, starts_at, ends_at, reason").gte("ends_at", new Date().toISOString()),
    ]);

    throwIfError(
      canteenResult.error
    );

    throwIfError(
      foodResult.error
    );
    throwIfError(hoursResult.error);
    throwIfError(closuresResult.error);

    const canteens =
      canteenResult.data || [];
    const hoursByCanteen = {};
    for (const h of hoursResult.data || []) {
      (hoursByCanteen[h.canteen_id] ||= []).push(h);
    }
    const closuresByCanteen = {};
    for (const c of closuresResult.data || []) {
      (closuresByCanteen[c.canteen_id] ||= []).push(c);
    }

    const canteenMap =
      Object.fromEntries(
        canteens.map((c) => [
          c.id,
          c,
        ])
      );

    return {
      canteens: canteens.map(
        (canteen) => ({
          id: canteen.id,
          name: canteen.name,
          subtitle:
            canteen.subtitle || "",
          status:
            canteen.status || "Open",
          eta:
            `${canteen.eta_min}-${canteen.eta_max} min`,
          load:
            canteen.load || 0,
          color:
            canteen.color || "green",
          hours: hoursByCanteen[canteen.id] || [],
          closures: closuresByCanteen[canteen.id] || [],
        })
      ),

      items: (
        foodResult.data || []
      ).map((item) => ({
        id: item.id,
        name: item.name,
        description:
          item.description || "",
        price: Number(item.price),
        image:
          item.image_url || "",
        category:
          item.food_categories?.name ||
          "Food",
        vendor:
          canteenMap[item.canteen_id]
            ?.name || "",
        canteenId:
          item.canteen_id,
        veg:
          Boolean(item.is_vegetarian),
        vegetarian:
          Boolean(item.is_vegetarian),
        available:
          item.available,
        dietaryTags: item.dietary_tags || [],
        allergens: item.allergens || [],
        spiceLevel: item.spice_level || null,
        calories: item.calories ?? null,
        availableDays: item.available_days || null,
        availableFrom: item.available_from || null,
        availableTo: item.available_to || null,
        variants: (item.food_item_variants || [])
          .filter((v) => v.active)
          .map((v) => ({ id: v.id, name: v.name, price: Number(v.price), available: v.available })),
        addonGroups: (item.food_item_addon_groups || [])
          .filter((g) => g.active)
          .map((g) => ({
            id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select,
            options: (g.food_item_addon_options || [])
              .filter((o) => o.active)
              .map((o) => ({ id: o.id, name: o.name, priceDelta: Number(o.price_delta), available: o.available })),
          })),
      })),
    };
  });
}


/* =========================================================================
   FOOD ORDERS
========================================================================= */

// Order creation is fully server-side now (doc §5, §12, §62, §63): pricing,
// stock/availability checks, and the order+items write all happen
// atomically inside the create_food_order() Postgres function, which also
// re-reads prices itself -- nothing here is trusted from the browser.
// `idempotencyKey` should be a stable value for this checkout attempt (e.g.
// generated once when the cart modal opens) so a flaky "Pay" double-click
// can't create two orders.
export async function createFoodOrder({
  userId,
  canteenId,
  cart,
  notes = "",
  fulfillmentType = "pickup",
  idempotencyKey = null,
}) {
  if (!userId) {
    throw new Error("Please sign in before ordering.");
  }
  if (!canteenId) {
    throw new Error("Select a canteen first.");
  }
  if (!cart?.length) {
    throw new Error("Your food cart is empty.");
  }

  // mergeCartItem() already keeps `cart` as at most one entry per distinct
  // (item, variant, add-on selection) with a real running `.quantity` on
  // that entry -- it never creates duplicate rows for the same line. This
  // used to re-derive quantity by counting array entries per food_item_id
  // instead of reading item.quantity, which silently placed every order at
  // quantity 1 no matter how many of an item were actually in the cart
  // (found while wiring in variant/add-on support -- fixed here).
  const items = cart.map((item) => ({
    food_item_id: item.id,
    quantity: Number(item.quantity) || 1,
    special_instructions: item.specialInstructions || null,
    variant_id: item.variantId || null,
    addon_option_ids: item.addonOptionIds && item.addonOptionIds.length ? item.addonOptionIds : null,
  }));

  const { data, error } = await supabase.rpc("create_food_order", {
    p_canteen_id: canteenId,
    p_items: items,
    p_notes: notes,
    p_fulfillment_type: fulfillmentType,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    // Surface the {code, message}-style errors raised by the RPC
    // (ORDER_ITEM_UNAVAILABLE, ORDER_SINGLE_CANTEEN, ...) as friendly text.
    const message = (error.message || "").replace(/^[A-Z_]+:\s*/, "");
    logClientError(`create_food_order failed: ${error.message}`, { severity: "error", category: "order_creation", context: { canteenId } });
    throw new Error(message || "Unable to place order");
  }

  return data;
}

// Kicks off payment for an order that's already in PAYMENT_PENDING: asks the
// create-razorpay-order Edge Function for a gateway order to open Checkout
// against. The order only becomes PAID once Razorpay's webhook verifies the
// payment server-side (see supabase/functions/razorpay-webhook).
export async function startFoodOrderPayment(orderId) {
  const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
    body: { order_id: orderId },
  });
  if (error) throw new Error(error.message || "Unable to start payment");
  return data; // { key_id, gateway_order_id, amount, currency, payment_id }
}

// The order-status state machine itself (which transitions are legal from
// which state) is enforced inside transition_order_status(), not here --
// this is a thin RPC wrapper so the frontend can't bypass that by writing
// the `status` column directly.
export async function transitionOrderStatus(orderId, toStatus, reason) {
  const { data, error } = await supabase.rpc("transition_order_status", {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

// Vendor-side pickup scan (doc §15) -- validates server-side that the token
// is unused, unexpired, and belongs to a READY order, then completes it.
export async function redeemPickupToken(token) {
  const { data, error } = await supabase.rpc("redeem_pickup_token", { p_token: token });
  throwIfError(error);
  return data;
}

// Generates (or, on a repeat call, just returns) the GST invoice for a paid
// food order -- see generate_order_invoice() (doc Phase 3 "Invoice
// generation"). Idempotent server-side; safe to call every time a receipt
// is opened rather than caching the result client-side.
export async function getOrCreateOrderInvoice(orderId) {
  const { data, error } = await supabase.rpc("generate_order_invoice", { p_order_id: orderId });
  throwIfError(error);
  return data;
}

export async function getOrderPickupToken(orderId) {
  const { data, error } = await supabase
    .from("order_pickup_tokens")
    .select("token, short_code, expires_at, used_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  return data;
}

// `cursor` is the created_at of the last order already loaded (doc §90).
export async function getMyOrders(
  userId,
  { limit = 20, cursor = null } = {}
) {
  if (!userId) return [];

  let query = supabase
    .from("orders")
    .select(`
      id,
      status,
      subtotal,
      tax_amount,
      platform_fee,
      delivery_fee,
      total,
      payment_status,
      pickup_code,
      notes,
      created_at,
      canteens (
        id,
        name
      ),
      order_items (
        id,
        quantity,
        unit_price,
        total_price,
        item_name
      )
    `)
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    })
    .limit(limit);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;

  throwIfError(error);

  return data || [];
}


