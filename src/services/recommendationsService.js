import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Recommendation engine (doc §108 -- "Student dashboard personalization")
|--------------------------------------------------------------------------
| Recommended food/events/clubs/opportunities, scored server-side in
| recommend_food()/recommend_events()/recommend_clubs()/
| recommend_opportunities() (supabase/migrations/
| 20260815000600_profile_personalization_recommendations.sql) from signals
| the student already gave the app themselves -- skills, course/department/
| year, club memberships, past orders/registrations/applications. Recommended
| people reuses the existing get_people_you_may_know() (0024) rather than
| duplicating it.
|
| Doc says "avoid creepy behavior and provide controls" -- two controls:
| profiles.personalization_enabled (toggle, see setPersonalizationEnabled in
| mvpService.js) and dismissRecommendation() ("not interested") below. When
| personalization is off, every recommend_*() RPC still returns results --
| just campus-wide popular/recent ones with a generic reason instead of a
| personal one -- so turning it off doesn't leave an empty dashboard.
*/

function throwIfError(error) {
  if (error) throw error;
}

export async function getRecommendedFood(limit = 6) {
  const { data, error } = await supabase.rpc("recommend_food", { p_limit: limit });
  throwIfError(error);
  return data || [];
}

export async function getRecommendedEvents(limit = 6) {
  const { data, error } = await supabase.rpc("recommend_events", { p_limit: limit });
  throwIfError(error);
  return data || [];
}

export async function getRecommendedClubs(limit = 6) {
  const { data, error } = await supabase.rpc("recommend_clubs", { p_limit: limit });
  throwIfError(error);
  return data || [];
}

export async function getRecommendedOpportunities(limit = 6) {
  const { data, error } = await supabase.rpc("recommend_opportunities", { p_limit: limit });
  throwIfError(error);
  return data || [];
}

export async function dismissRecommendation(entityType, entityId) {
  const { error } = await supabase.rpc("dismiss_recommendation", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  throwIfError(error);
}

// Fetches every category in parallel; one category failing (e.g. a brand
// new campus with zero clubs yet) doesn't blank out the others.
export async function getAllRecommendations(limit = 6) {
  const [food, events, clubs, opportunities] = await Promise.allSettled([
    getRecommendedFood(limit),
    getRecommendedEvents(limit),
    getRecommendedClubs(limit),
    getRecommendedOpportunities(limit),
  ]);

  const pick = (result) => (result.status === "fulfilled" ? result.value : []);
  return {
    food: pick(food),
    events: pick(events),
    clubs: pick(clubs),
    opportunities: pick(opportunities),
  };
}
