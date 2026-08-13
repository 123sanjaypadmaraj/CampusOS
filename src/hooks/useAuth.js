import {
  useEffect,
  useState
} from "react";

import { supabase } from "../lib/supabase";

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

    if (error) throw error;

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

    if (error) throw error;

    return data;
  }

  async function logout() {
    const {
      error
    } = await supabase.auth.signOut();

    if (error) throw error;

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