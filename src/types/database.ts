/**
 * Hand-authored Supabase types covering the tables/RPCs the frontend
 * actually touches. This is NOT full codegen -- once the project is linked
 * via the Supabase CLI, replace this file with the real thing:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * Keeping a hand-written subset in the meantime still gives real
 * autocomplete/type-checking on the RPC calls that carry the new security
 * model (create_food_order, transition_order_status, etc.) instead of
 * leaving every supabase.rpc() call as `any`.
 */

export type OrderStatus =
  | "CREATED" | "PAYMENT_PENDING" | "PAID" | "RECEIVED" | "ACCEPTED" | "PREPARING"
  | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED" | "COMPLETED" | "CANCEL_REQUESTED"
  | "CANCELLED" | "REFUND_PENDING" | "REFUNDED" | "REJECTED" | "EXPIRED";

export type TicketStatus =
  | "SUBMITTED" | "TRIAGED" | "ASSIGNED" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";

export type BookingStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "COMPLETED";

export type PrintJobStatus =
  | "UPLOADED" | "PROCESSING" | "QUEUED" | "PRINTING" | "READY" | "COLLECTED" | "FAILED" | "CANCELLED";

export interface Profile {
  id: string;
  campus_id: string | null;
  name: string;
  email: string | null;
  usn: string | null;
  course: string | null;
  department: string | null;
  year: string | null;
  avatar_url: string | null;
  bio: string | null;
  skills: string[];
  role: "student" | "club_admin" | "vendor" | "facilities_staff" | "college_admin" | "super_admin";
  open_to_projects: boolean;
  privacy_level: "public" | "campus" | "limited" | "private";
  status: "active" | "suspended" | "deleted";
  created_at: string;
  updated_at: string;
}

export interface Canteen {
  id: string;
  campus_id: string;
  name: string;
  subtitle: string | null;
  status: string;
  eta_min: number;
  eta_max: number;
  queue_level: string;
  load: number;
  color: string;
  active: boolean;
}

export interface FoodItem {
  id: string;
  canteen_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_vegetarian: boolean;
  available: boolean;
  active: boolean;
  preparation_time_min: number;
  featured: boolean;
}

export interface Order {
  id: string;
  user_id: string;
  canteen_id: string;
  status: OrderStatus;
  fulfillment_type: "pickup" | "delivery";
  subtotal: number;
  tax_amount: number;
  platform_fee: number;
  delivery_fee: number;
  discount_amount: number;
  total: number;
  payment_status: "pending" | "paid" | "failed" | "refund_pending" | "refunded";
  pickup_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  food_item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  special_instructions: string | null;
}

export interface EventRow {
  id: string;
  campus_id: string | null;
  club_id: string | null;
  organizer_id: string | null;
  title: string;
  category: string | null;
  description: string | null;
  event_date: string;
  place: string | null;
  capacity: number | null;
  registration_status: "OPEN" | "FULL" | "WAITLIST" | "CLOSED" | "CANCELLED";
  published: boolean;
}

export interface ServiceRequest {
  id: string;
  user_id: string;
  service_id: string | null;
  title: string;
  category: string;
  location: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: TicketStatus;
  assigned_to: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  resource_id: string;
  user_id: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  notes: string | null;
}

export interface PrintJob {
  id: string;
  user_id: string;
  file_url: string;
  file_name: string;
  pages: number;
  copies: number;
  color_mode: "black_white" | "colour";
  price: number;
  status: PrintJobStatus;
  pickup_code: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  action_type: string | null;
  action_id: string | null;
  read: boolean;
  created_at: string;
}

export interface MarketplaceListing {
  id: string;
  campus_id: string | null;
  seller_id: string;
  title: string;
  description: string;
  category: string;
  price: number;
  condition: string;
  status: "active" | "pending" | "sold" | "removed";
  image_urls: string[];
  created_at: string;
}

export interface LostFoundItem {
  id: string;
  campus_id: string | null;
  user_id: string;
  item_type: "lost" | "found";
  title: string;
  description: string;
  category: string;
  location: string;
  status: "open" | "claim_pending" | "resolved";
  image_urls: string[];
  created_at: string;
}

/** Minimal Database shape -- enough for supabase-js's generic to type
 * `.from('table')` results on the tables we actively query. Tables not
 * listed here still work, just without column-level typing. */
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      canteens: { Row: Canteen; Insert: Partial<Canteen>; Update: Partial<Canteen> };
      food_items: { Row: FoodItem; Insert: Partial<FoodItem>; Update: Partial<FoodItem> };
      orders: { Row: Order; Insert: Partial<Order>; Update: Partial<Order> };
      order_items: { Row: OrderItem; Insert: Partial<OrderItem>; Update: Partial<OrderItem> };
      events: { Row: EventRow; Insert: Partial<EventRow>; Update: Partial<EventRow> };
      service_requests: { Row: ServiceRequest; Insert: Partial<ServiceRequest>; Update: Partial<ServiceRequest> };
      bookings: { Row: Booking; Insert: Partial<Booking>; Update: Partial<Booking> };
      print_jobs: { Row: PrintJob; Insert: Partial<PrintJob>; Update: Partial<PrintJob> };
      notifications: { Row: Notification; Insert: Partial<Notification>; Update: Partial<Notification> };
      marketplace_listings: { Row: MarketplaceListing; Insert: Partial<MarketplaceListing>; Update: Partial<MarketplaceListing> };
      lost_found_items: { Row: LostFoundItem; Insert: Partial<LostFoundItem>; Update: Partial<LostFoundItem> };
    };
    Functions: {
      create_food_order: { Args: Record<string, unknown>; Returns: Order };
      transition_order_status: { Args: Record<string, unknown>; Returns: Order };
      redeem_pickup_token: { Args: Record<string, unknown>; Returns: Order };
      create_payment_order: { Args: Record<string, unknown>; Returns: { id: string; amount: number; currency: string; gateway_order_id: string | null } };
      register_for_event: { Args: Record<string, unknown>; Returns: { status: string; registration_id?: string; ticket_token?: string; position?: number } };
      cancel_event_registration: { Args: Record<string, unknown>; Returns: void };
      create_booking: { Args: Record<string, unknown>; Returns: Booking };
      create_print_job: { Args: Record<string, unknown>; Returns: PrintJob };
      claim_lost_found_item: { Args: Record<string, unknown>; Returns: LostFoundItem };
      mark_listing_sold: { Args: Record<string, unknown>; Returns: MarketplaceListing };
      search_people: { Args: Record<string, unknown>; Returns: Pick<Profile, "id" | "name" | "course" | "department" | "year" | "skills" | "avatar_url" | "open_to_projects">[] };
    };
  };
}
