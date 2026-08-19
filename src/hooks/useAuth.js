import {
  useEffect,
  useState
} from "react";

import { supabase } from "../lib/supabase";
import { logClientError } from "../services/mvpService";

// Auth error codes a normal user hits routinely (wrong password, unverified
// email, signing up with an email already in use, ...) -- not a system
// health signal, so these are excluded from error_logs to avoid flooding it
// with expected user mistakes. Everything else (network errors, 5xx from
// GoTrue, rate limiting) gets logged with category 'auth'.
const EXPECTED_AUTH_ERROR_CODES = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "user_already_exists",
  "weak_password",
  "same_password",
]);

function logAuthErrorIfUnexpected(action, error) {
  if (error && !EXPECTED_AUTH_ERROR_CODES.has(error.code)) {
    logClientError(`Auth ${action} failed: ${error.message}`, {
      severity: "warning",
      category: "auth",
      context: { action, code: error.code || null },
    });
  }
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser();

        if (!mounted) return;

        setUser(user);

        if (user) {
          const {
            data,
            error
          } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();

          if (!error && mounted) {
            setProfile(data);
          }
        }
      } catch (error) {
        console.error("Auth error:", error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;

        const nextUser = session?.user || null;

        setUser(nextUser);

        if (!nextUser) {
          setProfile(null);
          return;
        }

        const {
          data
        } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", nextUser.id)
          .single();

        if (mounted) {
          setProfile(data || null);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email, password) {
    const {
      data,
      error
    } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      logAuthErrorIfUnexpected("signIn", error);
      throw error;
    }

    return data;
  }

  async function signUp({
    email,
    password,
    name
  }) {
    const {
      data,
      error
    } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name
        }
      }
    });

    if (error) {
      logAuthErrorIfUnexpected("signUp", error);
      throw error;
    }

    return data;
  }

  async function logout() {
    const {
      error
    } = await supabase.auth.signOut();

    if (error) {
      logAuthErrorIfUnexpected("signOut", error);
      throw error;
    }

    setUser(null);
    setProfile(null);
  }

  async function updateProfile(updates) {
    if (!user) {
      throw new Error("You must be logged in.");
    }

    const {
      data,
      error
    } = await supabase
      .from("profiles")
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id)
      .select()
      .single();

    if (error) throw error;

    setProfile(data);

    return data;
  }

  return {
    user,
    profile,
    loading,
    signIn,
    signUp,
    logout,
    updateProfile
  };
}