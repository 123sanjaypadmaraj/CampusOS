import { supabase } from "../lib/supabase";
import { realtimeStatusLogger } from "./mvpService";

/*
|--------------------------------------------------------------------------
| Reminders -- doc §16 "AI Action System" ("Create reminders"). Brand new
| feature: a student can create one manually, or the Campus AI assistant can
| propose one from a chat message (see aiAssistantService.js/CampusAI in
| App.jsx) -- either way it lands through the same create_reminder() RPC, so
| the validation (title/remind_at rules) is identical regardless of source.
|--------------------------------------------------------------------------
*/

function throwIfError(error) {
  if (error) throw error;
}

export async function createReminder({ title, remindAt, notes = "", source = "manual" }) {
  const { data, error } = await supabase.rpc("create_reminder", {
    p_title: title,
    p_remind_at: remindAt,
    p_notes: notes || null,
    p_source: source,
  });
  throwIfError(error);
  return data;
}

export async function listMyReminders({ includeDone = false } = {}) {
  let query = supabase.from("reminders").select("*").order("remind_at", { ascending: true });
  if (!includeDone) query = query.eq("done", false);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function setReminderDone(id, done = true) {
  const { data, error } = await supabase.from("reminders").update({ done }).eq("id", id).select().single();
  throwIfError(error);
  return data;
}

export async function deleteReminder(id) {
  const { error } = await supabase.from("reminders").delete().eq("id", id);
  throwIfError(error);
}

export function subscribeToReminders(callback) {
  const channel = supabase
    .channel(`reminders:${Date.now()}:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "reminders" }, callback)
    .subscribe(realtimeStatusLogger("reminders"));

  return () => {
    supabase.removeChannel(channel);
  };
}
