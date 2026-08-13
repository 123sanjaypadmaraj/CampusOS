import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  typeof process !== "undefined" && process.env
    ? process.env.VITE_SUPABASE_URL
    : undefined;

const supabasePublishableKey =
  typeof process !== "undefined" && process.env
    ? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    : undefined;

if (!supabaseUrl) {
  throw new Error(
    "VITE_SUPABASE_URL is missing. Check your .env file."
  );
}

if (!supabasePublishableKey) {
  throw new Error(
    "VITE_SUPABASE_PUBLISHABLE_KEY is missing. Check your .env file."
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);