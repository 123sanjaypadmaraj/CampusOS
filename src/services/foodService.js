import { supabase } from "../lib/supabase";

export async function getCanteens() {
  const {
    data,
    error
  } = await supabase
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

  if (error) throw error;

  return (data || []).map((canteen) => ({
    ...canteen,

    eta: `${canteen.eta_min || 5}-${canteen.eta_max || 15} min`
  }));
}


export async function getFoodItems(canteenId = null) {
  let query = supabase
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
      food_categories (
        id,
        name
      ),
      canteens (
        id,
        name
      )
    `)
    .eq("available", true);

  if (canteenId) {
    query = query.eq("canteen_id", canteenId);
  }

  const {
    data,
    error
  } = await query.order("name");

  if (error) throw error;

  return (data || []).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description || "",
    price: Number(item.price),
    image: item.image_url || "",
    category:
      item.food_categories?.name || "Food",
    vendor:
      item.canteens?.name || "",
    canteenId: item.canteen_id,
    vegetarian:
      Boolean(item.is_vegetarian),
    available:
      item.available
  }));
}


export async function getFoodItem(id) {
  const {
    data,
    error
  } = await supabase
    .from("food_items")
    .select(`
      *,
      food_categories (
        id,
        name
      ),
      canteens (
        id,
        name
      )
    `)
    .eq("id", id)
    .single();

  if (error) throw error;

  return data;
}