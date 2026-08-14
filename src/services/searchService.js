import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Global unified search
|--------------------------------------------------------------------------
| Backed by global_search() in
| supabase/migrations/20260814004300_global_search.sql -- a single ranked,
| cross-module query (posts/events/clubs/marketplace/food/services/
| lost&found/announcements/people). Every per-module page keeps its own
| local `search` filter state; this is an additive cross-module entry point.
*/

export async function globalSearch(query, limit = 8) {
  const q = (query || "").trim();
  if (q.length < 2) return [];

  const { data, error } = await supabase.rpc("global_search", {
    p_query: q,
    p_limit: limit,
  });

  if (error) throw error;
  return data || [];
}

// Which app tab a result type opens, and (where the tab has one) the local
// `search` state key to pre-fill so the item is immediately visible.
export const SEARCH_ENTITY_DESTINATIONS = {
  post: { tab: "campus", prefill: true },
  event: { tab: "events", prefill: false },
  club: { tab: "clubs", prefill: false },
  listing: { tab: "market", prefill: false },
  food_item: { tab: "food", prefill: true },
  service: { tab: "services", prefill: false },
  lost_found: { tab: "lost", prefill: false },
  announcement: { tab: "home", prefill: false },
  person: { tab: "socialize", prefill: true },
};

export const SEARCH_ENTITY_LABELS = {
  post: "Campus feed",
  event: "Events",
  club: "Clubs",
  listing: "Marketplace",
  food_item: "Food",
  service: "Services",
  lost_found: "Lost & Found",
  announcement: "Announcements",
  person: "People",
};
