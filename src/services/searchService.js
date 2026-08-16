import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Smart Search
|--------------------------------------------------------------------------
| Backed by global_search() in supabase/migrations/20260816000200_smart_search.sql
| (+ fixes in 20260816000300/20260816000400) -- a single ranked, cross-module
| query across posts/events/clubs/marketplace/food/services/lost&found/
| announcements/people/vendors (canteens+stores)/store items/opportunities/
| locations, with typo tolerance (pg_trgm similarity as a match fallback,
| not just a ranking signal), entity-type filters, and personalized ranking
| (small boosts from the caller's skills/course/department/year/club
| categories/past canteen orders). log_search()/get_recent_searches()/
| clear_recent_searches()/get_search_suggestions() back the recent-searches
| and trending-suggestions UI. Every per-module page keeps its own local
| `search` filter state; this is an additive cross-module entry point.
*/

export async function globalSearch(query, limit = 8, types = null) {
  const q = (query || "").trim();
  if (q.length < 2) return [];

  const { data, error } = await supabase.rpc("global_search", {
    p_query: q,
    p_limit: limit,
    p_types: types && types.length ? types : null,
  });

  if (error) throw error;
  return data || [];
}

// Fire-and-forget from the caller's side (a failed log shouldn't block the
// search experience) -- callers still get the promise back in case they
// want to await/handle it themselves.
export async function logSearch(query) {
  const q = (query || "").trim();
  if (q.length < 2) return;
  const { error } = await supabase.rpc("log_search", { p_query: q });
  if (error) throw error;
}

export async function getRecentSearches(limit = 8) {
  const { data, error } = await supabase.rpc("get_recent_searches", { p_limit: limit });
  if (error) throw error;
  return data || [];
}

export async function clearRecentSearches() {
  const { error } = await supabase.rpc("clear_recent_searches");
  if (error) throw error;
}

export async function getSearchSuggestions(limit = 6) {
  const { data, error } = await supabase.rpc("get_search_suggestions", { p_limit: limit });
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
  canteen: { tab: "food", prefill: false },
  store_vendor: { tab: "store", prefill: false },
  store_item: { tab: "store", prefill: false },
  opportunity: { tab: "events", prefill: false },
  location: { tab: "map", prefill: false },
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
  canteen: "Vendors",
  store_vendor: "Vendors",
  store_item: "Store",
  opportunity: "Opportunities",
  location: "Locations",
};

// Filter chips shown in the search UI -- grouped by label so "Vendors"
// (canteens + stores, two different entity_type values under the hood)
// shows as one toggle, not two.
export const SEARCH_FILTER_GROUPS = [
  { key: "post", label: "Campus feed", types: ["post"] },
  { key: "event", label: "Events", types: ["event"] },
  { key: "club", label: "Clubs", types: ["club"] },
  { key: "market", label: "Marketplace", types: ["listing"] },
  { key: "food", label: "Food", types: ["food_item"] },
  { key: "vendor", label: "Vendors", types: ["canteen", "store_vendor"] },
  { key: "store", label: "Store", types: ["store_item"] },
  { key: "service", label: "Services", types: ["service"] },
  { key: "opportunity", label: "Opportunities", types: ["opportunity"] },
  { key: "location", label: "Locations", types: ["location"] },
  { key: "lost", label: "Lost & Found", types: ["lost_found"] },
  { key: "announcement", label: "Announcements", types: ["announcement"] },
  { key: "person", label: "People", types: ["person"] },
];
