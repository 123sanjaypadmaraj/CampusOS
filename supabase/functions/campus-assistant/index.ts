// Edge Function: campus-assistant
//
// Real LLM (Groq, Llama 3.3 70B) with tool-calling into the app's own real
// data, deliberately NOT fine-tuned: campus data (menus, events,
// opportunities, a student's own orders) changes hourly, so the model must
// call live RPCs/tables at request time rather than answer from anything
// baked into weights at training time.
//
// doc §16 "AI Action System": this used to be strictly read-only. It can
// now propose real actions (add to food cart, register for an event, submit
// a service request, book a resource, create a reminder) and navigate the
// student around the app -- but it NEVER executes a mutation itself. Every
// action tool below only *validates and prepares* a proposal (still 100%
// read-only against the DB, still scoped through the caller's own RLS via
// userClient); the actual write happens client-side, only after the
// student clicks Confirm on the rendered proposal card, by calling the
// *exact same* functions/RPCs the manual UI already uses for that action
// (registerEvent/createCampusServiceRequest/createResourceBooking/
// createReminder/addFood -- see CampusAI in src/App.jsx). That's the
// "strict permission boundary" doc §16 asks for: the model can only draft
// an intent against data it can already see under RLS; a human click is
// what actually authorizes the write, through the app's pre-existing,
// already-audited code paths -- the AI layer never gains, and never needs,
// any elevated privilege of its own. Navigation is the one exception that
// executes immediately (no confirm) since it never touches data, and even
// then `go()` on the frontend independently re-validates the target is
// reachable for that account before rendering it.
//
// Required secret (set via `supabase secrets set`):
//   GROQ_API_KEY
// Auto-provided by the Supabase Edge runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY_MESSAGES = 12; // caller's own chat history, trimmed to keep requests small/fast
const GROQ_MAX_RETRIES = 1;

// Groq's free/shared tier rate-limits per-minute, and a single chat turn can
// already fire several requests in a row (one per tool-calling round) --
// live testing against production found roughly half of otherwise-identical
// requests failing with zero retry, surfacing to the student as a blanket
// "temporarily unavailable" for no real reason. Two distinct upstream
// failure modes, both retried here: 429/5xx (capacity), and Groq's own
// `tool_use_failed` 400 -- Llama 3.3 70B occasionally emits a malformed
// pseudo-XML tool call (`<function=name{...}</function>`) instead of a
// proper structured one when the prompt carries this many tool schemas,
// which Groq's strict parser then rejects outright. That's a sampling
// fluke, not a deterministic client error, so it's genuinely worth
// re-rolling rather than giving up on sight the way every other 4xx should.
type GroqResult = { ok: boolean; status: number; text: string };

function isRetryableGroqFailure(status: number, text: string): boolean {
  if (status === 429 || status >= 500) return true;
  if (status === 400) {
    try {
      return JSON.parse(text)?.error?.code === "tool_use_failed";
    } catch { /* not JSON -- not the case we know how to retry */ }
  }
  return false;
}

async function fetchGroqWithRetry(body: unknown, groqKey: string): Promise<GroqResult> {
  let last: GroqResult | null = null;
  for (let attempt = 0; attempt <= GROQ_MAX_RETRIES; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const result: GroqResult = { ok: res.ok, status: res.status, text };
    if (res.ok || !isRetryableGroqFailure(res.status, text)) return result;
    last = result;
    if (attempt === GROQ_MAX_RETRIES) break;

    // Capped hard at 1.5s regardless of what Retry-After says (it can ask
    // for far longer than this function has any business blocking a chat
    // reply for) -- a burst-load test that pushed several concurrent
    // requests through this function at once surfaced a real "not enough
    // compute resources" failure from the Edge Runtime itself when retries
    // ran longer/more numerous than this, so this stays deliberately cheap:
    // one retry, short delay, bail to the friendly rate-limited message
    // otherwise rather than trying to ride out real upstream capacity
    // pressure inside a single invocation.
    const retryAfterHeader = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? Math.min(retryAfterHeader * 1000, 1500)
      : 200;
    console.warn(`Groq API ${res.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${GROQ_MAX_RETRIES})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return last!;
}

// Student-relevant navigation targets only -- mirrors a safe subset of
// ROUTABLE_KEYS in src/App.jsx (no admin/vendor/facilities/autonomous).
// go() on the frontend independently re-validates/bounces regardless, this
// enum just keeps the model from proposing something obviously irrelevant.
const NAVIGABLE_PAGES = [
  "home", "campus", "events", "services", "socialize", "messages", "profile",
  "map", "people", "clubs", "food", "store", "ai", "calendar", "notifications",
  "print", "issues", "booking", "lost", "market", "pass",
];

const SYSTEM_PROMPT = `You are the CampusOS assistant for a college campus app (food ordering, events, clubs, marketplace, services, opportunities, mentors, project/hackathon teams, resource bookings, reminders).

Rules:
- Only state facts you got from a tool call this turn. Never guess a menu item, price, event date, or availability -- call the matching tool instead.
- If a tool returns nothing relevant, say so plainly and suggest what the student could try instead (e.g. a different search term). Don't invent a plausible-sounding answer.
- When a student describes a skill or role they want teammates for (e.g. "I need a React dev" or "find me a hackathon team"), use get_teams_looking_for_teammates -- it's already ranked by overlap with the student's own profile skills, so lead with the closest matches and explain briefly why each fits (shared/needed skills), don't just dump the raw list.
- You can propose real actions (add food to cart, register for an event, submit a service request, book a resource, create a reminder, apply to join a team) using the propose_* tools -- but you NEVER complete them yourself. Each propose_* tool just prepares a confirmation card the student has to explicitly approve in the app. After calling one, tell the student what you've drawn up and that they need to confirm it -- never say "done"/"booked"/"registered"/"applied" for a propose_* call, since nothing has actually happened yet.
- A propose_* tool needs its required fields BEFORE you call it (e.g. an exact resource and start/end time for a booking, an exact event for a registration). If the student hasn't given you enough to fill them in, ask a short clarifying question instead of guessing or calling the tool with made-up values.
- Use navigate_to when the student clearly wants to go somewhere in the app (e.g. "take me to the marketplace") rather than asking a question about it.
- Keep answers short and concrete (a few sentences, or a short list). This is a chat bubble, not an essay.
- Prices are in Indian Rupees (₹).`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_campus",
      description: "Fuzzy search across posts, events, clubs, marketplace listings, food items, services, lost & found, announcements, and people by name/skill. Use this for open-ended or ambiguous questions.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search text, e.g. 'flutter developer' or 'robotics'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_food_menu",
      description: "Full current canteen menu across all campus canteens -- item id, name, price, canteen, availability. Use for 'what's on the menu' / 'where can I get X' style questions, and to find the item id needed before proposing an add-to-cart.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_events",
      description: "Upcoming published campus events with id, date, place, capacity and registration status. Use this to find the event id needed before proposing a registration.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_opportunities",
      description: "Currently open internships/research/job/volunteer/competition postings, with deadlines.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_mentors",
      description: "The curated mentor directory -- name, role/specialty, skills.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_teams_looking_for_teammates",
      description: "Project/hackathon teams currently recruiting, ranked by overlap between each team's needed skills and the signed-in student's own profile skills -- id, title, category, skills needed/have, member count, deadline, match_score (higher = closer fit). Use this for 'find me a team' / 'who needs a <skill> person' / 'is anyone building a hackathon team' questions, and to find the team id needed before proposing to apply.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_store_items",
      description: "Items currently for sale in the Campus Store (stationery, books, electronics, etc).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_orders",
      description: "The signed-in student's own recent food orders, with status and pickup code. Use this for 'where's my order' / 'check my order' questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_event_registrations",
      description: "The signed-in student's own event registrations.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_campus_services",
      description: "Campus service types that can be requested (maintenance, IT support, housekeeping, etc) -- id, name, description. Use this to find the exact service name needed before proposing a service request.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bookable_resources",
      description: "Bookable campus resources (study rooms, halls, equipment) -- id, name, type, location. Use this to find the exact resource name needed before proposing a booking.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recommended_food",
      description: "Food personalized for the signed-in student (their past orders, skills, activity), each with a reason. Prefer this over get_food_menu when the student asks for a recommendation/suggestion rather than the full menu.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recommended_events",
      description: "Events personalized for the signed-in student, each with a reason. Prefer this over get_upcoming_events when the student asks what they should go to / what's recommended.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recommended_clubs",
      description: "Clubs personalized for the signed-in student, each with a reason.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recommended_opportunities",
      description: "Internships/research/job postings personalized for the signed-in student, each with a reason.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "Send the student to a specific page in the app right now. Only use when they clearly want to go somewhere, not just learn about it.",
      parameters: {
        type: "object",
        properties: { page: { type: "string", enum: NAVIGABLE_PAGES, description: "Which page to open" } },
        required: ["page"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_add_to_food_cart",
      description: "Draft adding a food item to the student's cart. Requires the exact food item id from get_food_menu/get_recommended_food -- does not actually add it, only prepares a confirmation card.",
      parameters: {
        type: "object",
        properties: {
          food_item_id: { type: "string", description: "The exact id of the food item" },
          quantity: { type: "integer", description: "How many, default 1" },
        },
        required: ["food_item_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_register_event",
      description: "Draft registering the student for an event. Requires the exact event id from get_upcoming_events/get_recommended_events -- does not actually register them, only prepares a confirmation card.",
      parameters: {
        type: "object",
        properties: { event_id: { type: "string", description: "The exact id of the event" } },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_apply_to_team",
      description: "Draft applying to join a project/hackathon team. Requires the exact team id from get_teams_looking_for_teammates -- does not actually apply, only prepares a confirmation card.",
      parameters: {
        type: "object",
        properties: {
          team_id: { type: "string", description: "The exact id of the team" },
          message: { type: "string", description: "A short note on why the student would be a good fit -- ask what skills/experience they'd want to mention if they haven't said, but don't block on it" },
        },
        required: ["team_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_service_request",
      description: "Draft a campus service request (maintenance, IT, housekeeping, etc). Requires the exact service name from get_campus_services -- does not actually submit it, only prepares a confirmation card.",
      parameters: {
        type: "object",
        properties: {
          service_name: { type: "string", description: "The exact service name from get_campus_services" },
          title: { type: "string", description: "A short title for the issue, e.g. 'Broken AC in Room 204'" },
          description: { type: "string", description: "More detail about the issue" },
        },
        required: ["service_name", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_booking",
      description: "Draft booking a campus resource (study room, hall, equipment) for a specific time range. Requires the exact resource name from get_bookable_resources and explicit ISO 8601 start/end times -- ask the student for a date and time if they haven't given one, never guess it. Does not actually book it, only prepares a confirmation card.",
      parameters: {
        type: "object",
        properties: {
          resource_name: { type: "string", description: "The exact resource name from get_bookable_resources" },
          start_time: { type: "string", description: "ISO 8601 start time, e.g. 2026-08-20T14:00:00" },
          end_time: { type: "string", description: "ISO 8601 end time, e.g. 2026-08-20T15:00:00" },
          notes: { type: "string", description: "Optional notes for the booking" },
        },
        required: ["resource_name", "start_time", "end_time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_reminder",
      description: "Draft a personal reminder for the student. Requires an explicit ISO 8601 date/time -- ask the student when, if they haven't said (e.g. 'this Friday' needs to become a real date). Does not actually create it, only prepares a confirmation card.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What to remind them about" },
          remind_at: { type: "string", description: "ISO 8601 date/time, e.g. 2026-08-21T18:00:00" },
          notes: { type: "string", description: "Optional extra detail" },
        },
        required: ["title", "remind_at"],
      },
    },
  },
];

type ProposedAction = { type: string; label: string; [key: string]: unknown };

async function runTool(
  userClient: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
  campusId: string | null
): Promise<{ result: unknown; pendingAction?: ProposedAction; navigateTo?: string }> {
  switch (name) {
    case "search_campus": {
      const query = String(args.query ?? "").slice(0, 200);
      if (query.trim().length < 2) return { result: { results: [] } };
      const { data, error } = await userClient.rpc("global_search", { p_query: query, p_limit: 8 });
      if (error) return { result: { error: error.message } };
      return { result: { results: data } };
    }
    case "get_food_menu": {
      const { data, error } = await userClient
        .from("food_items")
        .select("id, canteen_id, name, price, available, description, canteens(name)")
        .eq("active", true)
        .limit(60);
      if (error) return { result: { error: error.message } };
      return { result: { items: (data ?? []).map((i: any) => ({ id: i.id, canteen_id: i.canteen_id, name: i.name, price: i.price, canteen: i.canteens?.name, available: i.available })) } };
    }
    case "get_upcoming_events": {
      let q = userClient
        .from("events_with_counts")
        .select("id, title, category, event_date, place, capacity, registration_status, attendees")
        .eq("published", true)
        .gte("event_date", new Date().toISOString())
        .order("event_date", { ascending: true })
        .limit(15);
      if (campusId) q = q.eq("campus_id", campusId);
      const { data, error } = await q;
      if (error) return { result: { error: error.message } };
      return { result: { events: data } };
    }
    case "get_opportunities": {
      let q = userClient.from("opportunities").select("company, role, type, tags, deadline, description").eq("active", true).limit(20);
      if (campusId) q = q.eq("campus_id", campusId);
      const { data, error } = await q;
      if (error) return { result: { error: error.message } };
      return { result: { opportunities: data } };
    }
    case "get_mentors": {
      let q = userClient.from("mentors").select("name, role, skills, bio").eq("active", true).limit(20);
      if (campusId) q = q.eq("campus_id", campusId);
      const { data, error } = await q;
      if (error) return { result: { error: error.message } };
      return { result: { mentors: data } };
    }
    case "get_teams_looking_for_teammates": {
      if (!campusId) return { result: { error: "No campus is set on this account, so team results aren't available." } };
      const { data, error } = await userClient.rpc("list_project_teams", {
        p_campus_id: campusId, p_status: "recruiting", p_category: null, p_search: null, p_limit: 15, p_cursor: null,
      });
      if (error) return { result: { error: error.message } };
      return {
        result: {
          teams: (data ?? []).map((t: any) => ({
            id: t.id, title: t.title, category: t.category, skills_needed: t.skills_needed, skills_have: t.skills_have,
            member_count: t.member_count, max_members: t.max_members, deadline: t.deadline, match_score: t.match_score,
          })),
        },
      };
    }
    case "get_store_items": {
      let q = userClient.from("store_items").select("name, price, category, description, stores(name)").eq("active", true).eq("available", true).limit(40);
      const { data, error } = await q;
      if (error) return { result: { error: error.message } };
      return { result: { items: (data ?? []).map((i: any) => ({ name: i.name, price: i.price, category: i.category, store: i.stores?.name })) } };
    }
    case "get_my_orders": {
      const { data, error } = await userClient
        .from("orders")
        .select("status, total, pickup_code, created_at, canteens(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return { result: { error: error.message } };
      return { result: { orders: data } };
    }
    case "get_my_event_registrations": {
      const { data, error } = await userClient
        .from("event_registrations")
        .select("status, registered_at, events(title, event_date, place)")
        .eq("status", "confirmed")
        .order("registered_at", { ascending: false })
        .limit(10);
      if (error) return { result: { error: error.message } };
      return { result: { registrations: data } };
    }
    case "get_campus_services": {
      let q = userClient.from("services").select("id, name, description").eq("active", true).limit(30);
      if (campusId) q = q.eq("campus_id", campusId);
      const { data, error } = await q;
      if (error) return { result: { error: error.message } };
      return { result: { services: data } };
    }
    case "get_bookable_resources": {
      let q = userClient.from("resources").select("id, name, resource_type, locations(name)").eq("available", true).limit(30);
      if (campusId) q = q.eq("campus_id", campusId);
      const { data, error } = await q;
      if (error) return { result: { error: error.message } };
      return { result: { resources: (data ?? []).map((r: any) => ({ id: r.id, name: r.name, type: r.resource_type, location: r.locations?.name })) } };
    }
    case "get_recommended_food": {
      const { data, error } = await userClient.rpc("recommend_food", { p_limit: 6 });
      if (error) return { result: { error: error.message } };
      return { result: { recommendations: data } };
    }
    case "get_recommended_events": {
      const { data, error } = await userClient.rpc("recommend_events", { p_limit: 6 });
      if (error) return { result: { error: error.message } };
      return { result: { recommendations: data } };
    }
    case "get_recommended_clubs": {
      const { data, error } = await userClient.rpc("recommend_clubs", { p_limit: 6 });
      if (error) return { result: { error: error.message } };
      return { result: { recommendations: data } };
    }
    case "get_recommended_opportunities": {
      const { data, error } = await userClient.rpc("recommend_opportunities", { p_limit: 6 });
      if (error) return { result: { error: error.message } };
      return { result: { recommendations: data } };
    }
    case "navigate_to": {
      const page = String(args.page ?? "");
      if (!NAVIGABLE_PAGES.includes(page)) return { result: { error: `Unknown page: ${page}` } };
      return { result: { navigated: true, page }, navigateTo: page };
    }
    case "propose_add_to_food_cart": {
      const id = String(args.food_item_id ?? "");
      const quantity = Math.max(1, Math.min(20, Number(args.quantity) || 1));
      const { data: item, error } = await userClient
        .from("food_items")
        .select("id, canteen_id, name, price, available, canteens(name)")
        .eq("id", id)
        .eq("active", true)
        .maybeSingle();
      if (error) return { result: { error: error.message } };
      if (!item) return { result: { error: "That food item doesn't exist -- call get_food_menu again to find the right id." } };
      if (!item.available) return { result: { error: `${item.name} is currently unavailable.` } };
      return {
        result: { proposed: true, summary: `${quantity}x ${item.name} (₹${item.price} each) from ${(item as any).canteens?.name ?? "the canteen"}` },
        pendingAction: {
          type: "add_to_food_cart", label: `Add ${quantity}x ${item.name} to your food cart`,
          foodItemId: item.id, canteenId: item.canteen_id, canteenName: (item as any).canteens?.name ?? "", name: item.name, price: item.price, quantity,
        },
      };
    }
    case "propose_register_event": {
      const id = String(args.event_id ?? "");
      const { data: event, error } = await userClient
        .from("events_with_counts")
        .select("id, title, event_date, place, published")
        .eq("id", id)
        .maybeSingle();
      if (error) return { result: { error: error.message } };
      if (!event || !event.published) return { result: { error: "That event doesn't exist -- call get_upcoming_events again to find the right id." } };
      return {
        result: { proposed: true, summary: `Registration for "${event.title}" on ${new Date(event.event_date as string).toLocaleString()}` },
        pendingAction: { type: "register_event", label: `Register for "${event.title}"`, eventId: event.id, eventTitle: event.title, eventDate: event.event_date, eventPlace: event.place },
      };
    }
    case "propose_apply_to_team": {
      const id = String(args.team_id ?? "");
      const message = String(args.message ?? "").slice(0, 500);
      const { data: team, error } = await userClient
        .from("project_teams")
        .select("id, title, status")
        .eq("id", id)
        .maybeSingle();
      if (error) return { result: { error: error.message } };
      if (!team) return { result: { error: "That team doesn't exist -- call get_teams_looking_for_teammates again to find the right id." } };
      if (team.status !== "recruiting") return { result: { error: `"${team.title}" isn't recruiting right now.` } };
      return {
        result: { proposed: true, summary: `Application to join "${team.title}"${message ? `: ${message}` : ""}` },
        pendingAction: { type: "apply_to_team", label: `Apply to join "${team.title}"`, teamId: team.id, teamTitle: team.title, message },
      };
    }
    case "propose_service_request": {
      const serviceName = String(args.service_name ?? "");
      const title = String(args.title ?? "").slice(0, 200);
      const description = String(args.description ?? "").slice(0, 1000);
      if (!title.trim()) return { result: { error: "A title is required for the service request." } };
      let sq = userClient.from("services").select("id, name").eq("name", serviceName).eq("active", true);
      if (campusId) sq = sq.eq("campus_id", campusId);
      const { data: service, error } = await sq.maybeSingle();
      if (error) return { result: { error: error.message } };
      if (!service) return { result: { error: `"${serviceName}" isn't a valid service -- call get_campus_services again to find the exact name.` } };
      return {
        result: { proposed: true, summary: `Service request for "${service.name}": ${title}` },
        pendingAction: { type: "service_request", label: `Submit a "${service.name}" request: ${title}`, serviceName: service.name, title, description },
      };
    }
    case "propose_booking": {
      const resourceName = String(args.resource_name ?? "");
      const startTime = String(args.start_time ?? "");
      const endTime = String(args.end_time ?? "");
      const notes = String(args.notes ?? "").slice(0, 500);
      const start = new Date(startTime);
      const end = new Date(endTime);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return { result: { error: "start_time/end_time must be valid ISO 8601 date/times." } };
      if (end <= start) return { result: { error: "end_time must be after start_time." } };
      let rq = userClient.from("resources").select("id, name").eq("name", resourceName).eq("available", true);
      if (campusId) rq = rq.eq("campus_id", campusId);
      const { data: resource, error } = await rq.maybeSingle();
      if (error) return { result: { error: error.message } };
      if (!resource) return { result: { error: `"${resourceName}" isn't a valid bookable resource -- call get_bookable_resources again to find the exact name.` } };
      return {
        result: { proposed: true, summary: `Booking "${resource.name}" from ${start.toLocaleString()} to ${end.toLocaleString()}` },
        pendingAction: { type: "booking", label: `Book "${resource.name}" (${start.toLocaleString()} - ${end.toLocaleString()})`, resourceId: resource.id, resourceName: resource.name, startTime, endTime, notes },
      };
    }
    case "propose_reminder": {
      const title = String(args.title ?? "").slice(0, 200);
      const remindAt = String(args.remind_at ?? "");
      const notes = String(args.notes ?? "").slice(0, 500);
      if (!title.trim()) return { result: { error: "A title is required for the reminder." } };
      const when = new Date(remindAt);
      if (isNaN(when.getTime())) return { result: { error: "remind_at must be a valid ISO 8601 date/time." } };
      if (when.getTime() < Date.now() - 5 * 60 * 1000) return { result: { error: "That time has already passed -- ask the student for a future date/time." } };
      return {
        result: { proposed: true, summary: `Reminder: "${title}" at ${when.toLocaleString()}` },
        pendingAction: { type: "reminder", label: `Remind you: "${title}" at ${when.toLocaleString()}`, title, remindAt, notes },
      };
    }
    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in required" }, 401);
  }

  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) {
    return jsonResponse({ code: "GATEWAY_NOT_CONFIGURED", message: "The assistant isn't configured on this deployment yet." }, 503);
  }

  let history: { role: string; content: string }[];
  try {
    const body = await req.json();
    history = Array.isArray(body?.messages) ? body.messages : [];
  } catch {
    return jsonResponse({ code: "BAD_REQUEST", message: "Invalid JSON body" }, 400);
  }
  if (!history.length) {
    return jsonResponse({ code: "BAD_REQUEST", message: "messages is required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in required" }, 401);
  }

  // Groq's API key/quota is shared across every student -- without this,
  // one person spamming the chat could burn the whole app's daily budget.
  const { data: allowed } = await userClient.rpc("check_rate_limit", {
    p_user: userData.user.id,
    p_bucket: "ai_assistant",
    p_max_hits: 20,
    p_window_seconds: 3600,
  });
  if (!allowed) {
    return jsonResponse({ code: "RATE_LIMITED", message: "You've sent a lot of messages -- try again in a bit." }, 429);
  }

  const { data: profile } = await userClient.from("profiles").select("campus_id, name").eq("id", userData.user.id).maybeSingle();

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT + (profile?.name ? `\nThe student you're talking to is named ${profile.name}.` : "") },
    ...history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 2000) })),
  ];

  let pendingAction: ProposedAction | null = null;
  let navigateTo: string | null = null;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const groqRes = await fetchGroqWithRetry({
        model: GROQ_MODEL,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        // Low, not 0.4 -- tool-selection rounds are the ones that hit the
        // tool_use_failed malformed-generation issue documented above; a
        // near-deterministic temperature makes the model far more likely to
        // stay inside the structured tool-call format it was trained on
        // instead of drifting into free-text pseudo-XML. The final
        // natural-language follow-up below (no tools attached) keeps 0.4 --
        // that one benefits from a little more variation in phrasing.
        temperature: 0.15,
        max_tokens: 600,
      }, groqKey);

      if (!groqRes.ok) {
        console.error("Groq API error (after retries):", groqRes.status, groqRes.text);
        const message = groqRes.status === 429
          ? "The assistant is getting a lot of requests right now -- try again in a few seconds."
          : "The assistant is temporarily unavailable.";
        return jsonResponse({ code: "ASSISTANT_UPSTREAM_ERROR", message }, 502);
      }

      const groqData = JSON.parse(groqRes.text);
      const choice = groqData.choices?.[0]?.message;
      if (!choice) {
        return jsonResponse({ code: "ASSISTANT_UPSTREAM_ERROR", message: "The assistant returned an empty response." }, 502);
      }

      const toolCalls = choice.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return jsonResponse({ reply: choice.content || "I couldn't come up with an answer -- try rephrasing?", pendingAction, navigateTo }, 200);
      }

      messages.push({ role: "assistant", content: choice.content ?? null, tool_calls: toolCalls });

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* malformed args -> empty */ }
        const { result, pendingAction: pa, navigateTo: nav } = await runTool(userClient, call.function.name, args, profile?.campus_id ?? null);
        if (pa) pendingAction = pa;
        if (nav) navigateTo = nav;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }

      // A proposal or a navigation is a complete turn on its own -- stop
      // right after the model's next natural-language reply about it
      // instead of burning further tool rounds on the same turn.
      if (pendingAction || navigateTo) {
        const followUp = await fetchGroqWithRetry({ model: GROQ_MODEL, messages, temperature: 0.4, max_tokens: 300 }, groqKey);
        if (followUp.ok) {
          const followUpData = JSON.parse(followUp.text);
          const followUpChoice = followUpData.choices?.[0]?.message;
          return jsonResponse({ reply: followUpChoice?.content || "Here's what I've drawn up -- take a look below.", pendingAction, navigateTo }, 200);
        }
        return jsonResponse({ reply: "Here's what I've drawn up -- take a look below.", pendingAction, navigateTo }, 200);
      }
    }

    return jsonResponse({ reply: "I looked into that but couldn't finish in time -- could you ask a more specific question?", pendingAction, navigateTo }, 200);
  } catch (err) {
    console.error("campus-assistant crashed:", err);
    return jsonResponse({ code: "ASSISTANT_ERROR", message: "Something went wrong answering that." }, 500);
  }
});
