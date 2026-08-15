// Edge Function: campus-assistant
//
// Replaces the fully-fake CampusAI chat in src/App.jsx -- a keyword-match
// switch with five hardcoded canned replies (one literally says "in this
// demo"). This is a real LLM (Groq, Llama 3.3 70B) with tool-calling into
// the app's own real data, deliberately NOT fine-tuned: campus data
// (menus, events, opportunities, a student's own orders) changes hourly,
// so the model must call live RPCs/tables at request time rather than
// answer from anything baked into weights at training time. Read-only for
// this first version -- it can look things up, not place orders or
// register for events on a student's behalf.
//
// Required secret (set via `supabase secrets set`):
//   GROQ_API_KEY
// Auto-provided by the Supabase Edge runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_TOOL_ROUNDS = 3;
const MAX_HISTORY_MESSAGES = 12; // caller's own chat history, trimmed to keep requests small/fast

const SYSTEM_PROMPT = `You are the CampusOS assistant for a college campus app (food ordering, events, clubs, marketplace, services, opportunities, mentors).

Rules:
- Only state facts you got from a tool call this turn. Never guess a menu item, price, event date, or availability -- call the matching tool instead.
- If a tool returns nothing relevant, say so plainly and suggest what the student could try instead (e.g. a different search term). Don't invent a plausible-sounding answer.
- You cannot place orders, register for events, or send messages on the student's behalf yet -- if asked, explain that and point them to the right page in the app instead.
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
      description: "Full current canteen menu across all campus canteens -- item names, prices, canteen, availability. Use for 'what's on the menu' / 'where can I get X' style questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_events",
      description: "Upcoming published campus events with date, place, capacity and registration status.",
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
      name: "get_store_items",
      description: "Items currently for sale in the Campus Store (stationery, books, electronics, etc).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_orders",
      description: "The signed-in student's own recent food orders, with status and pickup code.",
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
];

async function runTool(userClient: ReturnType<typeof createClient>, name: string, args: Record<string, unknown>, campusId: string | null) {
  switch (name) {
    case "search_campus": {
      const query = String(args.query ?? "").slice(0, 200);
      if (query.trim().length < 2) return { results: [] };
      const { data, error } = await userClient.rpc("global_search", { p_query: query, p_limit: 8 });
      if (error) return { error: error.message };
      return { results: data };
    }
    case "get_food_menu": {
      const { data, error } = await userClient
        .from("food_items")
        .select("name, price, available, description, canteens(name)")
        .eq("active", true)
        .limit(60);
      if (error) return { error: error.message };
      return { items: (data ?? []).map((i: any) => ({ name: i.name, price: i.price, canteen: i.canteens?.name, available: i.available })) };
    }
    case "get_upcoming_events": {
      let q = userClient
        .from("events_with_counts")
        .select("title, category, event_date, place, capacity, registration_status, attendees")
        .eq("published", true)
        .gte("event_date", new Date().toISOString())
        .order("event_date", { ascending: true })
        .limit(15);
      if (campusId) q = q.eq("campus_id", campusId);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return { events: data };
    }
    case "get_opportunities": {
      let q = userClient.from("opportunities").select("company, role, type, tags, deadline, description").eq("active", true).limit(20);
      if (campusId) q = q.eq("campus_id", campusId);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return { opportunities: data };
    }
    case "get_mentors": {
      let q = userClient.from("mentors").select("name, role, skills, bio").eq("active", true).limit(20);
      if (campusId) q = q.eq("campus_id", campusId);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return { mentors: data };
    }
    case "get_store_items": {
      let q = userClient.from("store_items").select("name, price, category, description, stores(name)").eq("active", true).eq("available", true).limit(40);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return { items: (data ?? []).map((i: any) => ({ name: i.name, price: i.price, category: i.category, store: i.stores?.name })) };
    }
    case "get_my_orders": {
      const { data, error } = await userClient
        .from("orders")
        .select("status, total, pickup_code, created_at, canteens(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return { error: error.message };
      return { orders: data };
    }
    case "get_my_event_registrations": {
      const { data, error } = await userClient
        .from("event_registrations")
        .select("status, registered_at, events(title, event_date, place)")
        .eq("status", "confirmed")
        .order("registered_at", { ascending: false })
        .limit(10);
      if (error) return { error: error.message };
      return { registrations: data };
    }
    default:
      return { error: `Unknown tool: ${name}` };
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

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const groqRes = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0.4,
          max_tokens: 600,
        }),
      });

      if (!groqRes.ok) {
        const text = await groqRes.text();
        console.error("Groq API error:", groqRes.status, text);
        return jsonResponse({ code: "ASSISTANT_UPSTREAM_ERROR", message: "The assistant is temporarily unavailable." }, 502);
      }

      const groqData = await groqRes.json();
      const choice = groqData.choices?.[0]?.message;
      if (!choice) {
        return jsonResponse({ code: "ASSISTANT_UPSTREAM_ERROR", message: "The assistant returned an empty response." }, 502);
      }

      const toolCalls = choice.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return jsonResponse({ reply: choice.content || "I couldn't come up with an answer -- try rephrasing?" }, 200);
      }

      messages.push({ role: "assistant", content: choice.content ?? null, tool_calls: toolCalls });

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* malformed args -> empty */ }
        const result = await runTool(userClient, call.function.name, args, profile?.campus_id ?? null);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return jsonResponse({ reply: "I looked into that but couldn't finish in time -- could you ask a more specific question?" }, 200);
  } catch (err) {
    console.error("campus-assistant crashed:", err);
    return jsonResponse({ code: "ASSISTANT_ERROR", message: "Something went wrong answering that." }, 500);
  }
});
