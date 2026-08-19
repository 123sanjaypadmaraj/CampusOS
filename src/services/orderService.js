import { supabase } from "../lib/supabase";
import { logClientError } from "./mvpService";


export async function createOrder({
  userId,
  canteenId,
  items,
  platformFee = 0,
  notes = ""
}) {
  if (!userId) {
    throw new Error(
      "Please sign in before placing an order."
    );
  }

  if (!canteenId) {
    throw new Error(
      "Please select a canteen."
    );
  }

  if (!items?.length) {
    throw new Error(
      "Your cart is empty."
    );
  }

  const subtotal = items.reduce(
    (sum, item) =>
      sum +
      Number(item.price) *
      Number(item.quantity || 1),
    0
  );

  const total =
    subtotal + Number(platformFee);

  const pickupCode =
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

  const {
    data: order,
    error: orderError
  } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      canteen_id: canteenId,
      status: "pending",
      subtotal,
      platform_fee: platformFee,
      total,
      payment_status: "pending",
      pickup_code: pickupCode,
      notes
    })
    .select()
    .single();

  if (orderError) {
    logClientError(`Order creation failed: ${orderError.message}`, { severity: "error", category: "order_creation", context: { canteenId } });
    throw orderError;
  }

  const orderItems =
    items.map((item) => ({
      order_id: order.id,
      food_item_id: item.id,
      quantity:
        Number(item.quantity || 1),
      unit_price:
        Number(item.price),
      total_price:
        Number(item.price) *
        Number(item.quantity || 1)
    }));

  const {
    error: itemError
  } = await supabase
    .from("order_items")
    .insert(orderItems);

  if (itemError) {
    logClientError(`Order item creation failed: ${itemError.message}`, { severity: "error", category: "order_creation", context: { orderId: order.id } });
    await supabase
      .from("orders")
      .delete()
      .eq("id", order.id);

    throw itemError;
  }

  return order;
}


export async function getUserOrders(userId) {
  const {
    data,
    error
  } = await supabase
    .from("orders")
    .select(`
      id,
      status,
      subtotal,
      platform_fee,
      total,
      payment_status,
      pickup_code,
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
        food_items (
          id,
          name,
          image_url
        )
      )
    `)
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false
    });

  if (error) throw error;

  return data || [];
}


export async function getOrder(orderId) {
  const {
    data,
    error
  } = await supabase
    .from("orders")
    .select(`
      *,
      canteens (
        name
      ),
      order_items (
        *,
        food_items (
          name,
          image_url
        )
      )
    `)
    .eq("id", orderId)
    .single();

  if (error) throw error;

  return data;
}