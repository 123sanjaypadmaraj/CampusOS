import { supabase } from "../lib/supabase";
import { calculatePrintJobPrice, hasValidBookingRange, isUuid } from "../utils/mvpHelpers";

/*
|--------------------------------------------------------------------------
| CampusOS data layer
|--------------------------------------------------------------------------
| Browser-safe Supabase client only.
| Never put the service_role key in the frontend.
|--------------------------------------------------------------------------
*/

/* =========================================================================
   HELPERS
========================================================================= */

function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

function formatRelativeTime(date) {
  if (!date) return "";

  const diff = Math.max(
    0,
    Date.now() - new Date(date).getTime()
  );

  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(date).toLocaleDateString();
}

function throwIfError(error) {
  if (error) {
    throw error;
  }
}

/* =========================================================================
   AUTH
========================================================================= */

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;

  return user || null;
}

export async function getSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;

  return session || null;
}

export async function sendMagicLink(email) {
  const clean = email?.trim().toLowerCase();

  if (!clean) {
    throw new Error("Enter your college email.");
  }

  if (
    !clean.endsWith("@nhce.edu.in") &&
    !clean.endsWith("@newhorizonindia.edu") &&
    !clean.endsWith("@gmail.com")
  ) {
    throw new Error(
      "Please use an allowed email domain (@nhce.edu.in, @gmail.com)"
    );
  }

  const redirectUrl =
    `${window.location.origin}/`;

  const { error } =
    await supabase.auth.signInWithOtp({
      email: clean,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

  throwIfError(error);

  return true;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  throwIfError(error);
}

/*
 * signInWithPassword — used by the kingpin account for instant, no-OTP login.
 * Creates a REAL Supabase session so auth.uid() works and RLS passes.
 */
export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return data;
}

export function subscribeToAuthChanges(callback) {
  const {
    data: { subscription },
  } =
    supabase.auth.onAuthStateChange(
      (event, session) => {
        callback({
          event,
          session,
          user: session?.user || null,
        });
      }
    );

  return () => {
    subscription?.unsubscribe();
  };
}




/* =========================================================================
   CAMPUS
========================================================================= */

export async function getDefaultCampus() {
  try {
    const { data, error } = await supabase
      .from("campuses")
      .select("id,name,slug")
      .eq("slug", "nhce")
      .maybeSingle();

    if (!error && data) return data;

    // Try any campus if nhce slug not found
    const { data: anyCampus } = await supabase
      .from("campuses")
      .select("id,name,slug")
      .limit(1)
      .maybeSingle();

    if (anyCampus) return anyCampus;
  } catch (err) {
    console.warn(
      "[CampusOS] Campus table not ready — run CAMPUSOS_RESET_AND_SEED.sql in Supabase.",
      err.message
    );
  }

  // Graceful fallback: app loads but campus-specific DB queries will be skipped
  // (campusId = null causes useEffect guards to skip data loading)
  return {
    id: null,
    name: "New Horizon College of Engineering",
    slug: "nhce",
  };
}


/* =========================================================================
   PROFILE
========================================================================= */

export async function getProfile(userId) {
  if (!userId) return null;

  try {
    const {
      data,
      error,
    } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) console.warn("Profile fetch warning:", error);

    return data || null;
  } catch (err) {
    console.warn("getProfile catch:", err);
    return null;
  }
}


export async function getOrCreateProfile(
  authUser,
  campusId
) {
  if (!authUser?.id) {
    return null;
  }

  try {
    const existing =
      await getProfile(authUser.id);

    if (existing) {
      return existing;
    }

    const metadata =
      authUser.user_metadata || {};

    const profile = {
      id: authUser.id,
      campus_id: campusId || null,
      name:
        metadata.name ||
        authUser.email?.split("@")[0] ||
        "Campus Student",
      email: authUser.email || "",
      usn: metadata.usn || "",
      course:
        metadata.course ||
        "Computer Science & Engineering",
      year:
        metadata.year ||
        "2nd Year",
      skills:
        metadata.skills || [],
    };

    const {
      data,
      error,
    } = await supabase
      .from("profiles")
      .upsert(profile, {
        onConflict: "id",
      })
      .select()
      .maybeSingle();

    if (data) return data;
  } catch (err) {
    console.warn("getOrCreateProfile catch, using fallback:", err);
  }

  return {
    id: authUser.id,
    campus_id: campusId || null,
    name: authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Campus Student",
    email: authUser.email || "",
    usn: authUser.user_metadata?.usn || "",
    course: authUser.user_metadata?.course || "Computer Science & Engineering",
    year: authUser.user_metadata?.year || "2nd Year",
    skills: authUser.user_metadata?.skills || [],
  };
}


export async function updateProfile(
  userId,
  updates
) {
  if (!userId) {
    throw new Error("You must be signed in.");
  }

  const allowed = {
    name: updates.name,
    usn: updates.usn,
    course: updates.course,
    year: updates.year,
    avatar_url: updates.avatar_url,
    bio: updates.bio,
    ...(typeof updates.open_to_projects === "boolean"
      ? { open_to_projects: updates.open_to_projects }
      : {}),
    skills: Array.isArray(updates.skills)
      ? updates.skills
      : [],
    updated_at: new Date().toISOString(),
  };

  const {
    data,
    error,
  } = await supabase
    .from("profiles")
    .update(allowed)
    .eq("id", userId)
    .select()
    .single();

  throwIfError(error);

  return data;
}


/* =========================================================================
   PEOPLE
========================================================================= */

export async function getPeople({
  campusId,
  search = "",
  limit = 100,
} = {}) {
  try {
    let query = supabase
      .from("profiles")
      .select(`
        id,
        name,
        course,
        year,
        avatar_url,
        bio,
        skills,
        campus_id
      `)
      .limit(limit)
      .order("name");

    if (campusId) {
      query = query.eq(
        "campus_id",
        campusId
      );
    }

    if (search.trim()) {
      const q =
        search.trim().replace(/,/g, " ");

      query = query.or(
        `name.ilike.%${q}%,course.ilike.%${q}%,bio.ilike.%${q}%`
      );
    }

    const {
      data,
      error,
    } = await query;

    if (error) console.warn("getPeople query warning:", error);

    return data || [];
  } catch (err) {
    console.warn("getPeople error:", err);
    return [];
  }
}

export async function getLostFoundItems(campusId) {
  try {
    let query = supabase.from("lost_found_items").select("*").eq("status", "open").order("created_at", { ascending: false });
    if (campusId) query = query.eq("campus_id", campusId);
    const { data, error } = await query;
    if (error) console.warn("getLostFoundItems warning:", error);
    return data || [];
  } catch (err) {
    console.warn("getLostFoundItems error:", err);
    return [];
  }
}

export async function createLostFoundItem({ userId, campusId, itemType, title, description, category, location }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(userId)) throw new Error("Invalid user ID. Please sign in again.");
  if (!title?.trim() || !location?.trim()) throw new Error("Add an item title and location.");

  const { data, error } = await supabase
    .from("lost_found_items")
    .insert({
      user_id: userId,
      campus_id: campusId,
      item_type: itemType || "lost",
      title: title.trim(),
      description: description?.trim() || "",
      category: category?.trim() || "Other",
      location: location.trim(),
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

export async function claimLostFoundItem({ itemId, userId }) {
  if (!userId) throw new Error("Please sign in first.");
  const { data, error } = await supabase.from("lost_found_items").update({ status: "claimed", claimed_by: userId, updated_at: new Date().toISOString() }).eq("id", itemId).eq("status", "open").select().single();
  throwIfError(error);
  return data;
}

export async function getMarketplaceListings(campusId, search = "") {
  try {
    let query = supabase.from("marketplace_listings").select("*").eq("status", "active").order("created_at", { ascending: false });
    if (campusId) query = query.eq("campus_id", campusId);
    if (search.trim()) query = query.ilike("title", `%${search.trim()}%`);
    const { data, error } = await query;
    if (error) console.warn("getMarketplaceListings warning:", error);
    
    let listings = data || [];
    if (listings.length > 0) {
      const sellerIds = [...new Set(listings.map(l => l.seller_id))];
      const { data: profiles } = await supabase.from("profiles").select("id, name, course").in("id", sellerIds);
      const profileMap = {};
      if (profiles) profiles.forEach(p => profileMap[p.id] = p);
      listings = listings.map(l => ({ ...l, profiles: profileMap[l.seller_id] || null }));
    }
    return listings;
  } catch (err) {
    console.warn("getMarketplaceListings error:", err);
    return [];
  }
}

export async function createMarketplaceListing({ userId, campusId, title, description, category, price, condition, location }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(userId)) throw new Error("Invalid user ID. Please sign in again.");
  if (!title?.trim() || Number(price) < 0) throw new Error("Add a valid listing title and price.");

  const { data, error } = await supabase
    .from("marketplace_listings")
    .insert({
      seller_id: userId,
      campus_id: campusId,
      title: title.trim(),
      description: description?.trim() || "",
      category: category?.trim() || "Other",
      price: Number(price),
      condition: condition?.trim() || "Used",
      location: location?.trim() || "Campus",
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

export async function markMarketplaceListingSold({ listingId, userId }) {
  const { data, error } = await supabase.from("marketplace_listings").update({ status: "sold", updated_at: new Date().toISOString() }).eq("id", listingId).eq("seller_id", userId).select().single();
  throwIfError(error);
  return data;
}



/* =========================================================================
   POSTS
========================================================================= */

export async function getCampusPosts(
  campusId
) {
  let query = supabase
    .from("posts")
    .select(`
      id,
      type,
      title,
      content,
      tags,
      created_at,
      campus_id,
      author_id
    `)
    .order("created_at", {
      ascending: false,
    });

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  let posts = data || [];

  if (!posts.length) {
    return [];
  }

  const authorIds = [...new Set(posts.map(p => p.author_id))];
  if (authorIds.length > 0) {
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, name, avatar_url, course, year")
      .in("id", authorIds);
    
    const profileMap = {};
    if (profilesData) {
      profilesData.forEach(p => profileMap[p.id] = p);
    }
    
    posts = posts.map(p => ({
      ...p,
      profiles: profileMap[p.author_id] || null
    }));
  }

  const counts =
    await getPostCounts(
      posts.map((post) => post.id)
    );

  return posts.map((post) => ({
    id: post.id,
    type: post.type || "General",
    title: post.title,
    content: post.content || "",
    author:
      post.profiles?.name ||
      "Campus Student",
    authorId: post.author_id,
    avatar:
      post.profiles?.avatar_url ||
      null,
    course:
      post.profiles?.course || "",
    year:
      post.profiles?.year || "",
    time:
      formatRelativeTime(
        post.created_at
      ),
    createdAt: post.created_at,
    likes:
      counts[post.id]?.likes || 0,
    comments:
      counts[post.id]?.comments || 0,
    liked: false,
    tags: post.tags || [],
    accent: "violet",
    verified: true,
  }));
}

export async function publishPost({
  userId,
  campusId,
  type = "General",
  title,
  content = "",
  tags = [],
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!title?.trim()) {
    throw new Error(
      "Post title cannot be empty."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      campus_id: campusId,
      type,
      title: title.trim(),
      content: content.trim(),
      tags,
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}

export async function deletePost({
  postId,
  userId,
}) {
  if (!postId || !userId) {
    throw new Error(
      "Invalid post request."
    );
  }

  const {
    error,
  } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", userId);

  throwIfError(error);

  return true;
}



/* =========================================================================
   POST LIKES / COMMENTS
========================================================================= */

export async function togglePostLike({
  postId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  const {
    data: existing,
    error: readError,
  } = await supabase
    .from("post_likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfError(readError);

  if (existing) {
    const {
      error,
    } = await supabase
      .from("post_likes")
      .delete()
      .eq("id", existing.id);

    throwIfError(error);

    return false;
  }

  const {
    error,
  } = await supabase
    .from("post_likes")
    .insert({
      post_id: postId,
      user_id: userId,
    });

  throwIfError(error);

  return true;
}








export async function getPostCounts(
  postIds = []
) {
  if (!postIds.length) {
    return {};
  }

  const [
    likesResult,
    commentsResult,
  ] = await Promise.all([
    supabase
      .from("post_likes")
      .select("post_id")
      .in("post_id", postIds),

    supabase
      .from("comments")
      .select("post_id")
      .in("post_id", postIds),
  ]);

  throwIfError(
    likesResult.error
  );

  throwIfError(
    commentsResult.error
  );

  const counts = {};

  postIds.forEach((id) => {
    counts[id] = {
      likes: 0,
      comments: 0,
    };
  });

  (
    likesResult.data || []
  ).forEach((row) => {
    if (counts[row.post_id]) {
      counts[row.post_id].likes++;
    }
  });

  (
    commentsResult.data || []
  ).forEach((row) => {
    if (counts[row.post_id]) {
      counts[row.post_id].comments++;
    }
  });

  return counts;
}


export async function getPostComments(
  postId
) {
  const {
    data,
    error,
  } = await supabase
    .from("comments")
    .select(`
      id,
      post_id,
      author_id,
      content,
      created_at
    `)
    .eq("post_id", postId)
    .order("created_at");

  throwIfError(error);

  let comments = data || [];

  if (comments.length > 0) {
    const authorIds = [...new Set(comments.map(c => c.author_id))];
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", authorIds);
    
    const profileMap = {};
    if (profilesData) {
      profilesData.forEach(p => profileMap[p.id] = p);
    }
    
    comments = comments.map(c => ({
      ...c,
      profiles: profileMap[c.author_id] || null
    }));
  }

  return comments.map(
    (comment) => ({
      ...comment,
      author:
        comment.profiles?.name ||
        "Campus Student",
      avatar:
        comment.profiles?.avatar_url ||
        null,
      time:
        formatRelativeTime(
          comment.created_at
        ),
    })
  );
}


export async function addPostComment({
  postId,
  userId,
  content,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!content?.trim()) {
    throw new Error(
      "Comment cannot be empty."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_id: userId,
      content: content.trim(),
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}


/* =========================================================================
   CLUBS
========================================================================= */

export async function getClubs(
  campusId
) {
  let query = supabase
    .from("clubs")
    .select(`
      id,
      campus_id,
      name,
      category,
      members,
      events,
      description,
      logo_url
    `)
    .order("name");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return data || [];
}


export async function joinClub({
  clubId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(clubId)) {
    throw new Error("Invalid club ID.");
  }

  const {
    data,
    error,
  } = await supabase
    .from("club_members")
    .upsert(
      {
        club_id: clubId,
        user_id: userId,
        role: "member",
      },
      {
        onConflict:
          "club_id,user_id",
      }
    )
    .select()
    .single();

  throwIfError(error);

  return data;
}


export async function leaveClub({
  clubId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(clubId)) {
    throw new Error("Invalid club ID.");
  }

  const {
    error,
  } = await supabase
    .from("club_members")
    .delete()
    .eq("club_id", clubId)
    .eq("user_id", userId);

  throwIfError(error);

  return true;
}


export async function getMyClubs(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("club_members")
    .select(`
      club_id,
      role,
      joined_at,
      clubs (
        id,
        name,
        category,
        description,
        logo_url
      )
    `)
    .eq("user_id", userId);

  throwIfError(error);

  return data || [];
}


/* =========================================================================
   EVENTS
========================================================================= */

function formatEvent(event) {
  const dateObj = new Date(event.event_date);
  const isValidDate = !isNaN(dateObj.getTime());

  return {
    id: event.id,
    date: isValidDate ? dateObj.getDate().toString() : "12",
    month: isValidDate
      ? dateObj.toLocaleString("en-US", { month: "short" }).toUpperCase()
      : "AUG",
    title: event.title,
    club: event.clubs?.name || "Campus Event",
    time: isValidDate
      ? dateObj.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : "2:00 PM",
    place: event.place || "Campus",
    color:
      event.category === "Hackathon"
        ? "blue"
        : event.category === "Workshop"
        ? "purple"
        : "green",
    category: event.category || "Event",
    attendees: event.attendees || 0,
    description: event.description || "",
  };
}

export async function getCampusEvents(
  campusId
) {
  let query = supabase
    .from("events")
    .select(`
      id,
      campus_id,
      club_id,
      title,
      category,
      event_date,
      place,
      description,
      attendees,
      clubs (
        id,
        name,
        logo_url
      )
    `)
    .order("event_date");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return (data || []).map(formatEvent);
}


export async function getMyEventRegistrations(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("event_registrations")
    .select(`
      event_id,
      registered_at,
      events (
        id,
        title,
        category,
        event_date,
        place
      )
    `)
    .eq("user_id", userId);

  throwIfError(error);

  return data || [];
}


export async function isRegisteredForEvent({
  eventId,
  userId,
}) {
  if (!eventId || !userId || !isUuid(eventId)) {
    return false;
  }

  const {
    data,
    error,
  } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfError(error);

  return Boolean(data);
}


export async function registerEvent({
  eventId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(eventId)) {
    throw new Error("Invalid event ID.");
  }

  const {
    data,
    error,
  } = await supabase
    .from("event_registrations")
    .upsert(
      {
        event_id: eventId,
        user_id: userId,
      },
      {
        onConflict: "event_id,user_id",
      }
    )
    .select()
    .single();

  throwIfError(error);

  return data;
}

export async function cancelEventRegistration({ eventId, userId }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { error } = await supabase.from("event_registrations").delete().eq("event_id", eventId).eq("user_id", userId);
  throwIfError(error);
  return true;
}

export async function getMyRegisteredEventIds(userId) {
  const rows = await getMyEventRegistrations(userId);
  return rows.map((row) => row.event_id);
}

export async function getSavedEvents(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from("saved_events").select("event_id").eq("user_id", userId);
  throwIfError(error);
  return (data || []).map((row) => row.event_id);
}

export async function toggleSavedEvent({ eventId, userId }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { data: existing, error: readError } = await supabase.from("saved_events").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
  throwIfError(readError);
  if (existing) {
    const { error } = await supabase.from("saved_events").delete().eq("event_id", eventId).eq("user_id", userId);
    throwIfError(error);
    return false;
  }
  const { error } = await supabase.from("saved_events").insert({ event_id: eventId, user_id: userId });
  throwIfError(error);
  return true;
}


/* =========================================================================
   FOOD
========================================================================= */

export async function getCampusFood(campusId) {
  const [
    canteenResult,
    foodResult,
  ] = await Promise.all([
    (() => {
      let q = supabase
        .from("canteens")
        .select(`
          id,
          name,
          subtitle,
          status,
          eta_min,
          eta_max,
          queue_level,
          load,
          color,
          active
        `)
        .eq("active", true)
        .order("name");
      if (campusId) q = q.eq("campus_id", campusId);
      return q;
    })(),

    supabase
      .from("food_items")
      .select(`
        id,
        canteen_id,
        name,
        description,
        price,
        image_url,
        is_vegetarian,
        available,
        food_categories (
          id,
          name
        )
      `)
      .eq("available", true)
      .order("name"),
  ]);

  throwIfError(
    canteenResult.error
  );

  throwIfError(
    foodResult.error
  );

  const canteens =
    canteenResult.data || [];

  const canteenMap =
    Object.fromEntries(
      canteens.map((c) => [
        c.id,
        c,
      ])
    );

  return {
    canteens: canteens.map(
      (canteen) => ({
        id: canteen.id,
        name: canteen.name,
        subtitle:
          canteen.subtitle || "",
        status:
          canteen.status || "Open",
        eta:
          `${canteen.eta_min}-${canteen.eta_max} min`,
        load:
          canteen.load || 0,
        color:
          canteen.color || "green",
      })
    ),

    items: (
      foodResult.data || []
    ).map((item) => ({
      id: item.id,
      name: item.name,
      description:
        item.description || "",
      price: Number(item.price),
      image:
        item.image_url || "",
      category:
        item.food_categories?.name ||
        "Food",
      vendor:
        canteenMap[item.canteen_id]
          ?.name || "",
      canteenId:
        item.canteen_id,
      veg:
        Boolean(item.is_vegetarian),
      vegetarian:
        Boolean(item.is_vegetarian),
      available:
        item.available,
    })),
  };
}


/* =========================================================================
   FOOD ORDERS
========================================================================= */

export async function createFoodOrder({
  userId,
  canteenId,
  cart,
  notes = "",
}) {
  if (!userId) {
    throw new Error(
      "Please sign in before ordering."
    );
  }

  if (!canteenId) {
    throw new Error(
      "Select a canteen first."
    );
  }

  if (!cart?.length) {
    throw new Error(
      "Your food cart is empty."
    );
  }

  const grouped = Object.values(
    cart.reduce((acc, item) => {
      if (!acc[item.id]) {
        acc[item.id] = {
          ...item,
          quantity: 0,
        };
      }

      acc[item.id].quantity++;

      return acc;
    }, {})
  );

  /*
   * Re-read prices from the database.
   *
   * Never trust prices sent from the browser.
   */
  const itemIds =
    grouped.map((item) => item.id);

  const {
    data: dbItems,
    error: itemError,
  } = await supabase
    .from("food_items")
    .select(
      "id,name,price,canteen_id,available"
    )
    .in("id", itemIds);

  throwIfError(itemError);

  if (!dbItems?.length) {
    throw new Error(
      "Food items could not be verified."
    );
  }

  const dbMap =
    Object.fromEntries(
      dbItems.map((item) => [
        item.id,
        item,
      ])
    );

  for (const item of grouped) {
    const dbItem =
      dbMap[item.id];

    if (!dbItem) {
      throw new Error(
        `${item.name} is no longer available.`
      );
    }

    if (!dbItem.available) {
      throw new Error(
        `${dbItem.name} is currently unavailable.`
      );
    }

    if (
      dbItem.canteen_id !== canteenId
    ) {
      throw new Error(
        "All food items must come from the same canteen."
      );
    }
  }

  const subtotal =
    grouped.reduce(
      (sum, item) => {
        const dbItem =
          dbMap[item.id];

        return (
          sum +
          Number(dbItem.price) *
            item.quantity
        );
      },
      0
    );

  const pickupCode =
    randomCode();

  const {
    data: order,
    error: orderError,
  } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      canteen_id: canteenId,
      status: "pending",
      subtotal,
      platform_fee: 0,
      total: subtotal,
      payment_status: "pending",
      pickup_code: pickupCode,
      notes,
    })
    .select()
    .single();

  throwIfError(orderError);

  const orderItems =
    grouped.map((item) => {
      const dbItem =
        dbMap[item.id];

      return {
        order_id: order.id,
        food_item_id: item.id,
        quantity: item.quantity,
        unit_price:
          Number(dbItem.price),
        total_price:
          Number(dbItem.price) *
          item.quantity,
      };
    });

  const {
    error: itemsError,
  } = await supabase
    .from("order_items")
    .insert(orderItems);

  if (itemsError) {
    await supabase
      .from("orders")
      .delete()
      .eq("id", order.id);

    throw itemsError;
  }

  return order;
}


export async function getMyOrders(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("orders")
    .select(`
      id,
      status,
      subtotal,
      platform_fee,
      total,
      payment_status,
      pickup_code,
      notes,
      created_at,
      canteens (
        id,
        name
      ),
      order_items (
        id,
        quantity,
        unit_price,
        total_price,
        food_items (
          id,
          name
        )
      )
    `)
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    });

  throwIfError(error);

  return data || [];
}


/* =========================================================================
   PRINT
========================================================================= */

export async function uploadPrintJob({
  userId,
  file,
  pages = 1,
  copies = 1,
  colorMode = "black_white",
  paperSize = "A4",
  binding = null,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!file) {
    throw new Error(
      "Choose a document."
    );
  }

  const safeName =
    file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

  const path =
    `${userId}/${crypto.randomUUID()}-${safeName}`;

  const calculatedPrice = calculatePrintJobPrice({
    pages,
    copies,
    colorMode,
    binding,
  });

  const {
    error: uploadError,
  } = await supabase.storage
    .from("print-documents")
    .upload(
      path,
      file,
      {
        cacheControl: "3600",
        upsert: false,
        contentType:
          file.type ||
          "application/octet-stream",
      }
    );

  throwIfError(uploadError);

  const {
    data: job,
    error: jobError,
  } = await supabase
    .from("print_jobs")
    .insert({
      user_id: userId,
      file_path: path,
      file_name: file.name,
      total_pages: Number(pages),
      copies: Number(copies),
      color_mode: colorMode,
      paper_size: paperSize,
      binding,
      price: calculatedPrice,
      status: "pending",
      pickup_code: randomCode(),
    })
    .select()
    .single();

  if (jobError) {
    await supabase.storage
      .from("print-documents")
      .remove([path]);

    throw jobError;
  }

  return job;
}


export async function getMyPrintJobs(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    });

  throwIfError(error);

  return data || [];
}


/* =========================================================================
   CAMPUS SERVICES
========================================================================= */

export async function getCampusServices(
  campusId
) {
  let query = supabase
    .from("services")
    .select(`
      id,
      campus_id,
      name,
      description,
      active
    `)
    .eq("active", true)
    .order("name");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return data || [];
}


export async function getMyServiceRequests(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("service_requests")
    .select(`
      id,
      title,
      details,
      status,
      created_at,
      updated_at,
      services (
        id,
        name
      ),
      locations (
        id,
        name,
        building,
        floor,
        room
      )
    `)
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    });

  throwIfError(error);

  return data || [];
}


export async function createCampusServiceRequest({
  userId,
  campusId,
  serviceName,
  title,
  details = {},
  locationId = null,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!serviceName) {
    throw new Error(
      "Select a service."
    );
  }

  const {
    data: service,
    error: serviceError,
  } = await supabase
    .from("services")
    .select("id")
    .eq("campus_id", campusId)
    .eq("name", serviceName)
    .eq("active", true)
    .maybeSingle();

  throwIfError(serviceError);

  if (!service) {
    throw new Error(
      `Service "${serviceName}" is not configured.`
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("service_requests")
    .insert({
      service_id: service.id,
      user_id: userId,
      location_id: locationId,
      title,
      details,
      status: "reported",
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}


/* =========================================================================
   RESOURCE BOOKING
========================================================================= */

export async function getResources(
  campusId
) {
  let query = supabase
    .from("resources")
    .select(`
      id,
      campus_id,
      name,
      resource_type,
      active,
      locations (
        id,
        name,
        building,
        floor,
        room
      )
    `)
    .eq("active", true)
    .order("name");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return data || [];
}


export async function getMyBookings(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("bookings")
    .select(`
      id,
      resource_id,
      start_time,
      end_time,
      status,
      notes,
      created_at,
      resources (
        id,
        name,
        resource_type
      )
    `)
    .eq("user_id", userId)
    .order("start_time", {
      ascending: true,
    });

  throwIfError(error);

  return data || [];
}


export async function createResourceBooking({
  userId,
  resourceId,
  resourceName,
  startTime,
  endTime,
  notes = "",
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!startTime || !endTime) {
    throw new Error(
      "Select a start and end time."
    );
  }

  if (!hasValidBookingRange(startTime, endTime)) {
    throw new Error(
      "End time must be after start time."
    );
  }

  let resource;

  if (resourceId) {
    const {
      data,
      error,
    } = await supabase
      .from("resources")
      .select("id,name")
      .eq("id", resourceId)
      .single();

    throwIfError(error);

    resource = data;
  } else {
    const {
      data,
      error,
    } = await supabase
      .from("resources")
      .select("id,name")
      .eq("name", resourceName)
      .maybeSingle();

    throwIfError(error);

    resource = data;
  }

  if (!resource) {
    throw new Error(
      "Resource not found."
    );
  }

  /*
   * Application-level conflict check.
   *
   * We also add a database exclusion constraint
   * in the SQL migration below.
   */
  const {
    data: conflicts,
    error: conflictError,
  } = await supabase
    .from("bookings")
    .select("id")
    .eq(
      "resource_id",
      resource.id
    )
    .in("status", [
      "pending",
      "approved",
    ])
    .lt(
      "start_time",
      endTime
    )
    .gt(
      "end_time",
      startTime
    )
    .limit(1);

  throwIfError(conflictError);

  if (conflicts?.length) {
    throw new Error(
      "This resource is already booked for that time."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("bookings")
    .insert({
      resource_id: resource.id,
      user_id: userId,
      start_time: startTime,
      end_time: endTime,
      status: "pending",
      notes,
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}


/* =========================================================================
   NOTIFICATIONS
========================================================================= */

export async function getUserNotifications(
  userId
) {
  if (!userId) return [];

  try {
    const {
      data,
      error,
    } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.warn("getUserNotifications warning:", error.message);
      return [];
    }

    return (data || []).map(
      (notification) => ({
        ...notification,
        time:
          formatRelativeTime(
            notification.created_at
          ),
        unread:
          !notification.read,
      })
    );
  } catch (err) {
    console.warn("getUserNotifications catch:", err);
    return [];
  }
}


export async function markNotificationRead(
  notificationId,
  userId
) {
  if (!userId) return;

  const {
    error,
  } = await supabase
    .from("notifications")
    .update({
      read: true,
    })
    .eq("id", notificationId)
    .eq("user_id", userId);

  throwIfError(error);
}


export async function markAllNotificationsRead(
  userId
) {
  if (!userId) return;

  const {
    error,
  } = await supabase
    .from("notifications")
    .update({
      read: true,
    })
    .eq("user_id", userId);

  throwIfError(error);
}


/* =========================================================================
   REALTIME
========================================================================= */

export function subscribeToUserNotifications(
  userId,
  callback
) {
  if (!userId) return () => {};

  const channel =
    supabase
      .channel(
        `notifications:${userId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter:
            `user_id=eq.${userId}`,
        },
        callback
      )
      .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}


export function subscribeToOrders(
  userId,
  callback
) {
  if (!userId) return () => {};

  const channel =
    supabase
      .channel(`orders:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter:
            `user_id=eq.${userId}`,
        },
        callback
      )
      .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}


export function subscribeToPosts(callback) {
  const channel = supabase
    .channel("public:posts_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "post_likes" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToEvents(callback) {
  const channel = supabase
    .channel("public:events_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "event_registrations" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToClubs(callback) {
  const channel = supabase
    .channel("public:clubs_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "clubs" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "club_members" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToMarketplace(callback) {
  const channel = supabase
    .channel("public:marketplace_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "marketplace_listings" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToLostFound(callback) {
  const channel = supabase
    .channel("public:lost_found_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "lost_found_items" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/* =========================================================================
   REPORTING & AUDIT
========================================================================= */

export async function reportContent(contentType, contentId, reason) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Must be logged in to report content");

  const { data, error } = await supabase
    .from("content_reports")
    .insert([
      {
        reporter_id: user.id,
        content_type: contentType,
        content_id: contentId,
        reason: reason,
        status: "pending",
      },
    ])
    .select()
    .single();

  throwIfError(error);
  return data;
}

export async function getAuditLogs(limit = 50) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  throwIfError(error);
  return data;
}
