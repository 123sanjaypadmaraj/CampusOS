import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Campus AI assistant -- real LLM, not the keyword-match chatbot it replaces
|--------------------------------------------------------------------------
| Backed by supabase/functions/campus-assistant (Groq, Llama 3.3 70B,
| tool-calling into real app data -- no fine-tuning, since campus data
| changes hourly and needs to be looked up live, not baked into weights).
*/

// Returns { reply, pendingAction, navigateTo } -- doc §16 "AI Action
// System": pendingAction (when present) is a drafted-not-executed action
// card for CampusAI to render with a Confirm/Cancel button (see
// ACTION_EXECUTORS in App.jsx, which is what actually performs the write,
// through the same functions/RPCs the manual UI uses); navigateTo (when
// present) is a page key CampusAI should go() to immediately -- navigation
// never mutates anything, so it doesn't need a confirm step.
export async function askCampusAssistant(messages) {
  const { data, error } = await supabase.functions.invoke("campus-assistant", {
    body: { messages },
  });

  if (error) {
    // supabase-js buries the function's own JSON error body inside
    // error.context on a non-2xx response -- surface its `message` if
    // present so a 429/503 reads as "you're sending too many messages"
    // instead of a generic "Edge Function returned a non-2xx status code".
    let detail;
    try {
      detail = await error.context?.json?.();
    } catch {
      detail = null;
    }
    throw new Error(detail?.message || error.message || "The assistant is unavailable right now");
  }

  return {
    reply: data?.reply || "I couldn't come up with an answer -- try rephrasing?",
    pendingAction: data?.pendingAction || null,
    navigateTo: data?.navigateTo || null,
  };
}
