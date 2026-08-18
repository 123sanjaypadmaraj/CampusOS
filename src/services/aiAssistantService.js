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
    // Trust & quality: which tool(s)/data actually backed this reply, so
    // CampusAI can show a "Sourced from: live menu data" chip instead of an
    // unattributed claim -- empty when the model answered from its own
    // reasoning/no tool call this turn (e.g. "hi", clarifying questions).
    sources: Array.isArray(data?.sources) ? data.sources : [],
  };
}

// Feedback loop (doc "AI" checklist): thumbs up/down plus an optional
// report reason on any AI reply. message_excerpt is trimmed server-side too
// (submit_ai_feedback) -- this just keeps the request itself small.
export async function submitAiFeedback(messageExcerpt, rating, reportReason) {
  const { error } = await supabase.rpc("submit_ai_feedback", {
    p_message_excerpt: String(messageExcerpt || "").slice(0, 500),
    p_rating: rating,
    p_report_reason: reportReason || null,
  });
  if (error) throw error;
}

// Action audit log (doc "AI" checklist): records what a propose_* action
// resolved to (confirmed/cancelled/error) -- the actual mutation itself
// still goes through the app's normal, already-audited RPCs (see
// AI_ACTION_EXECUTORS in App.jsx); this is specifically "did the student go
// through with what the AI drafted," a distinct question from "did the
// underlying write succeed." Fire-and-forget from the caller's point of
// view -- a logging failure should never block the UI from showing the
// action's real result.
export async function logAiAction(actionType, actionPayload, status, resultText) {
  try {
    await supabase.rpc("log_ai_action", {
      p_action_type: actionType,
      p_action_payload: actionPayload || {},
      p_status: status,
      p_result_text: resultText || null,
    });
  } catch (err) {
    console.warn("logAiAction failed (non-fatal):", err);
  }
}
