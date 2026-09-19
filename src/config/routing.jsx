import { services } from "../features/services/data";
import { HiCalendarDays, HiChatBubbleLeftRight, HiHome, HiSparkles, HiUserCircle, HiUserGroup, HiWrenchScrewdriver } from "react-icons/hi2";

/* eslint-disable react/jsx-key -- these are [key, icon, label] tuples, not
   directly-rendered siblings; the actual key prop is supplied where this
   array is mapped over (`navItems.map(([key, icon, label]) => ...)` in
   App.jsx). */
const navItems = [
  ["home", <HiHome />, "Home"],
  ["campus", <HiSparkles />, "Campus"],
  ["events", <HiCalendarDays />, "Events"],
  ["services", <HiWrenchScrewdriver />, "Services"],
  ["socialize", <HiUserGroup />, "Connect"],
  ["messages", <HiChatBubbleLeftRight />, "Messages"],
  ["profile", <HiUserCircle />, "Profile"],
];
/* eslint-enable react/jsx-key */

// The phone tab bar is capped at five (the Blinkit/MyGate convention) so labels
// never truncate. Messages moves to the top bar (with its unread badge) and
// Connect lives in the Home tile grid; the desktop/tablet bar keeps all seven.
const MOBILE_NAV_KEYS = ["home", "campus", "events", "services", "profile"];
const mobileNavItems = MOBILE_NAV_KEYS.map((key) => navItems.find(([k]) => k === key));

const ROUTABLE_KEYS = new Set([
  "home", "campus", "events", "services", "socialize", "messages", "profile",
  "legal", "people", "clubs", "food", "store", "ai", "admin", "vendor",
  "facilities", "calendar", "notifications", "activity",
  "print", "issues", "booking", "lost", "market", "academics",
  "emergencydirectory", "support",
  "verify-email", "reset-password",
]);

const VENDOR_ALLOWED_KEYS = new Set(["vendor", "profile", "notifications", "legal", "verify-email", "reset-password"]);

const keyToPath = (key) => (key === "home" ? "/" : `/${key}`);

const pathToKey = (pathname) => {
  const key = pathname.replace(/^\/+|\/+$/g, "") || "home";
  return ROUTABLE_KEYS.has(key) ? key : "home";
};

const PAGE_TITLES = {
  ...Object.fromEntries(navItems.map(([key, , label]) => [key, label])),
  ...Object.fromEntries(services.map((s) => [s.id, s.title])),
  legal: "Legal",
  people: "People",
  clubs: "Clubs",
  food: "Food Ordering",
  ai: "AI Assistant",
  admin: "Admin",
  vendor: "Vendor Dashboard",
  facilities: "Facilities",
  calendar: "Calendar",
  notifications: "Notifications",
  activity: "Activity",
  "verify-email": "Verify Email",
  "reset-password": "Reset Password",
};

export { PAGE_TITLES, ROUTABLE_KEYS, VENDOR_ALLOWED_KEYS, keyToPath, mobileNavItems, navItems, pathToKey };
