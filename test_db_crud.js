const { createClient } = require("@supabase/supabase-js");

const url = "https://dzjzjlylsfpmymkcavrq.supabase.co";
const key = "sb_publishable_j4jmO1YKR8a2E817czw3pw_c6xaoX9b";

const supabase = createClient(url, key);

async function testCrud() {
  console.log("=== STARTING DB INTEGRATION AUDIT ===");

  const testUserId = "00000000-0000-4000-a000-000000000002";

  // 1. Profile upsert
  const profileRes = await supabase.from("profiles").upsert({
    id: testUserId,
    name: "Sanjay Padmaraj",
    email: "sanjaypadmaraj@nhce.edu.in",
    usn: "1NH22CS101",
    course: "Computer Science & Engineering",
    year: "2nd Year",
    role: "student",
  }).select().single();
  if (profileRes.error) console.error("Profile error", profileRes.error);
  else console.log("Profile upserted", profileRes.data.id);

  // 2. Post insert
  const postRes = await supabase.from("posts").insert({
    author_id: testUserId,
    title: "DB Audit Post",
    content: "Testing DB insert via script",
    type: "General",
    tags: ["audit"]
  }).select().single();
  if (postRes.error) console.error("Post error", postRes.error);
  else console.log("Post inserted", postRes.data.id);

  // 3. Event registration (if event exists)
  const eventRes = await supabase.from("events").select("id").limit(1).maybeSingle();
  if (eventRes.data) {
    const regRes = await supabase.from("event_registrations").upsert({
      event_id: eventRes.data.id,
      user_id: testUserId,
    }, { onConflict: "event_id,user_id" }).select().single();
    if (regRes.error) console.error("Event reg error", regRes.error);
    else console.log("Event registered", regRes.data.id);
  }

  // 4. Service request
  const servRes = await supabase.from("service_requests").insert({
    user_id: testUserId,
    title: "Wi-Fi issue",
    details: {category: "Wi-Fi", room: "B-204"},
    status: "pending"
  }).select().single();
  if (servRes.error) console.error("Service error", servRes.error);
  else console.log("Service request created", servRes.data.id);

  // 5. Lost & found
  const lostRes = await supabase.from("lost_found_items").insert({
    user_id: testUserId,
    item_type: "lost",
    title: "Blue pen",
    location: "Block C",
    description: "Lost during lecture",
    category: "Stationery"
  }).select().single();
  if (lostRes.error) console.error("Lost&found error", lostRes.error);
  else console.log("Lost&found recorded", lostRes.data.id);

  // 6. Marketplace
  const marketRes = await supabase.from("marketplace_listings").insert({
    seller_id: testUserId,
    title: "Physics textbook",
    price: 350,
    condition: "Good",
    description: "Lightly used"
  }).select().single();
  if (marketRes.error) console.error("Marketplace error", marketRes.error);
  else console.log("Marketplace listing created", marketRes.data.id);

  console.log("=== AUDIT COMPLETE ===");
}

testCrud();
