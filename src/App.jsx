import React, { useEffect, useMemo, useRef, useState } from "react";
import { mergeCartItem, addonSelectionKey, isFoodItemAvailableNow, isCanteenOpenNow, calculatePrintJobPrice } from "./utils/mvpHelpers";
import {
  getDefaultCampus,
  getCurrentUser,
  getOrCreateProfile,
  getCampusPosts,
  getCampusEvents,
  getClubs,
  getCampusFood,
  getUserNotifications,
  getMyOrders,
  getOrCreateOrderInvoice,
  createFoodOrder,
  startFoodOrderPayment,
  publishPost,
  uploadPostImage,
  getSavedPosts,
  toggleSavedPost,
  submitSuspensionAppeal,
  getMySuspensionAppeal,
  markAllNotificationsRead,
  registerEvent,
  isValidPhone,
  sendMagicLink,
  signUpWithUsn,
  signInWithUsn,
  signInWithPassword,
  signInWithGoogle,
  connectGithub,
  deriveGithubUrlFromIdentities,
  connectLinkedin,
  markLinkedinVerified,
  hasLinkedinIdentity,
  uploadPrintJob,
  validatePrintFile,
  startPrintJobPayment,
  cancelPrintJob,
  startPrintJobRefund,
  getPrintRateCard,
  getPrintBindingRates,
  getPrintShopStatus,
  subscribeToAuthChanges,
  subscribeToUserNotifications,
  subscribeToOrders,
  subscribeToPosts,
  subscribeToEvents,
  subscribeToClubs,
  subscribeToFood,
  subscribeToMarketplace,
  subscribeToLostFound,
  togglePostLike,
  getPostComments,
  addPostComment,
  joinClub,
  leaveClub,
  getMyClubs,
  signOut,
  getPeople,
  getPeopleYouMayKnow,
  getCohortGroups,
  getCohortGroupMembers,
  updateProfile,
  getMyPrintJobs,
  getMyServiceRequests,
  getResources,
  getMyBookings,
  createCampusServiceRequest,
  createResourceBooking,
  getMyRegisteredEventIds,
  getSavedEvents,
  toggleSavedEvent,
  cancelEventRegistration,
  getLostFoundItems,
  createLostFoundItem,
  claimLostFoundItem,
  getMarketplaceListings,
  getMyMarketplaceListings,
  getMyEventRegistrations,
  getMyPayments,
  reportContent,
  getMyVerification,
  submitStudentVerification,
  getMyAccountDeletionRequest,
  requestAccountDeletion,
  cancelAccountDeletionRequest,
  submitOrgRequest,
  touchActivity,
  triggerSosAlert,
  cancelMySosAlert,
  getBestEffortLocation,
  logClientError,
  listMyEmergencyContacts,
  upsertEmergencyContact,
  deleteEmergencyContact,
} from "./services/mvpService";
import { openRazorpayCheckout } from "./features/payments/razorpay";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { LoadingState, EmptyState, ErrorState, OfflineBanner } from "./components/ui/States";
import { TrendChart, StatTile } from "./components/ui/Charts";
import AdminCMS from "./features/admin/AdminCMS";
import VendorDashboard from "./features/vendor/VendorDashboard";
import FacilitiesDashboard from "./features/facilities/FacilitiesDashboard";
import ClubManage from "./features/clubs/ClubManage";
import * as clubApi from "./features/clubs/api";
import Marketplace from "./features/marketplace/Marketplace";
import AcademicHub from "./features/academics/AcademicHub";
import TeamsBoard from "./features/teams/TeamsBoard";
import { applyToTeam } from "./features/teams/api";
import {
  startConversation,
  sendMessage,
  markConversationRead,
  listConversations,
  getUnreadMessageCount,
  getConversationMessages,
  subscribeToConversationList,
  subscribeToConversationMessages,
  uploadMessageAttachment,
  getMessageAttachmentUrl,
  blockUser,
  unblockUser,
  listBlockedUsers,
  deleteMessage,
} from "./services/messagingService";
import {
  globalSearch,
  logSearch,
  getRecentSearches,
  clearRecentSearches,
  getSearchSuggestions,
  SEARCH_ENTITY_DESTINATIONS,
  SEARCH_ENTITY_LABELS,
  SEARCH_FILTER_GROUPS,
} from "./services/searchService";
import { mintCampusPass } from "./services/campusPassService";
import {
  subscribeToPush,
  unsubscribeFromPush,
  getPushSubscriptionStatus,
  isPushSupported,
  getNotificationCategoryPreferences,
  setNotificationCategoryPreference,
  getNotificationChannelPreferences,
  setNotificationChannelPreference,
  setQuietHours,
} from "./services/pushService";
import {
  requestContactEmailVerification,
  confirmContactEmailVerification,
  requestPasswordReset,
  confirmPasswordReset,
} from "./services/contactService";
import QRCode from "qrcode";
import {
  getStores,
  getStoreItems,
  createStoreOrder,
  getMyStoreOrders,
  subscribeToStores,
  subscribeToStoreOrders,
} from "./services/storeService";
import {
  getOpportunities,
  getMentors,
  applyToOpportunity,
  getMyApplications,
  getMyApplicationsDetailed,
  getMyMentorRequests,
  requestMentor,
} from "./services/opportunitiesService";
import { askCampusAssistant, submitAiFeedback, logAiAction } from "./services/aiAssistantService";
import { getAllRecommendations, dismissRecommendation } from "./services/recommendationsService";
import { createReminder, listMyReminders, setReminderDone, deleteReminder, subscribeToReminders } from "./services/remindersService";
import { getStudentActivitySummary, getStudentSpendingSeries } from "./services/studentAnalyticsService";

import {
  HiHome,
  HiSparkles,
  HiArrowLeftOnRectangle,
  HiCalendarDays,
  HiWrenchScrewdriver,
  HiUserCircle,
  HiMagnifyingGlass,
  HiBell,
  HiMapPin,
  HiArrowRight,
  HiBolt,
  HiTrophy,
  HiUserGroup,
  HiPrinter,
  HiBookOpen,
  HiMap,
  HiBuildingOffice2,
  HiMagnifyingGlassCircle,
  HiShoppingCart,
  HiTicket,
  HiCpuChip,
  HiMegaphone,
  HiRocketLaunch,
  HiHeart,
  HiChatBubbleOvalLeft,
  HiArrowUpTray,
  HiCheckCircle,
  HiSun,
  HiMoon,
  HiXMark,
  HiEllipsisHorizontal,
  HiClock,
  HiAcademicCap,
  HiBriefcase,
  HiExclamationTriangle,
  HiShieldCheck,
  HiTruck,
  HiSignal,
  HiPaperAirplane,
  HiPlus,
  HiUserPlus,
  HiChevronRight,
  HiChevronDown,
  HiPhone,
  HiShoppingBag,
  HiDocumentArrowUp,
  HiCreditCard,
  HiQrCode,
  HiCheck,
  HiArrowPath,
  HiWifi,
  HiHomeModern,
  HiBoltSlash,
  HiCamera,
  HiComputerDesktop,
  HiLightBulb,
  HiStar,
  HiFire,
  HiFaceSmile,
  HiOutlineBuildingLibrary,
  HiChatBubbleLeftRight,
  HiCog6Tooth,
  HiArrowLeft,
  HiPencilSquare,
  HiTrash,
  HiPhoto,
  HiNoSymbol,
  HiHandThumbUp,
  HiHandThumbDown,
  HiFlag,
  HiBookmark,
  HiOutlineBookmark,
} from "react-icons/hi2";
import { FaLinkedin, FaGithub, FaGoogle } from "react-icons/fa6";

/* =========================================================
   NAVIGATION
========================================================= */

/* eslint-disable react/jsx-key -- these are [key, icon, label] tuples, not
   directly-rendered siblings; the actual key prop is supplied where this
   array is mapped over below (`navItems.map(([key, icon, label]) => ...)`). */
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

/* =========================================================
   ROUTING (doc §76-78)
   The plan's "multi-app split" section describes separate Student/Vendor/
   Admin/Facilities frontends. CampusOS deliberately ships as ONE app / ONE
   deployment for every role instead -- this is the route-branching layer
   that makes that a real architectural property rather than just an
   internal-state coincidence: every section gets a real URL, so deep
   links, refresh, and browser back/forward all work, and a role-gated
   section (e.g. /admin) is reachable by anyone but only *renders* for the
   right role (renderPage() below still does the actual gating -- this
   layer only keeps the address bar in sync with `active`).
========================================================= */

// Every `active` value renderPage() knows how to render. Anything else in
// the URL bar (a typo, a stale bookmark, a crawler) falls back to "home",
// matching renderPage()'s own default branch.
const ROUTABLE_KEYS = new Set([
  "home", "campus", "events", "services", "socialize", "messages", "profile",
  "map", "legal", "people", "clubs", "food", "store", "ai", "admin", "vendor",
  "facilities", "autonomous", "calendar", "notifications", "activity",
  "print", "issues", "booking", "lost", "market", "pass", "hostel", "delivery", "academics",
  "verify-email", "reset-password",
]);

// A vendor account (canteen or print shop) is a purpose-built ordering
// console, not a student app with an extra tab bolted on -- Campus/Events/
// Services/Connect/Messages/Home are all irrelevant to someone whose whole
// job is "manage my own menu/queue" (the ask that added this: "just like
// how a swiggy/zomato vendor can see their details"). Only their dashboard,
// profile, notifications (order alerts), and the legal page Profile links
// to stay reachable; everything else bounces back to the dashboard below.
const VENDOR_ALLOWED_KEYS = new Set(["vendor", "profile", "notifications", "legal", "verify-email", "reset-password"]);

const keyToPath = (key) => (key === "home" ? "/" : `/${key}`);

const pathToKey = (pathname) => {
  const key = pathname.replace(/^\/+|\/+$/g, "") || "home";
  return ROUTABLE_KEYS.has(key) ? key : "home";
};

/* =========================================================
   FREE DEMO FOOD IMAGES
   Unsplash images are linked remotely so the demo stays light.
========================================================= */

const FOOD_IMAGES = {

  // ==========================================================
  // UDUPI — SOUTH INDIAN
  // ==========================================================

  masalaDosa:
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ40JxSkHbTrsOvnDZBifOAPCP3z4QD3aTh7kZEgDc-VdQ7FNyuQuwT38Bg3NC-ieKXZ7C9ff5vmISLL2uQxK-F-ufEFT6Cw3Jrv2e64w3cCg&s=10",

  idliVada:
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS_PW83NBAEUdXYUoZVTWuP24YzRmhkwiR11AqBELTvW2Glf9Rz2tYS4lvCPymSdPMx-nF95V61yxgVXqpBjwrEjQa69qi8uaxbf1anaIZMmw&s=10",

  paneerMasalaDosa:
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSD1wmrt96nNOATDSWyDbuzSMy9IAbARYT4GCmcxmQh6w&s=10",

  setDosa:
    "https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=900",


  // ==========================================================
  // TANGO — ROLLS / NOODLES / BIRYANI / PASTA / SANDWICH
  // ==========================================================

  chickenRoll:
    "https://images.pexels.com/photos/461198/pexels-photo-461198.jpeg?auto=compress&cs=tinysrgb&w=900",

  vegNoodles:
    "https://images.pexels.com/photos/2347311/pexels-photo-2347311.jpeg?auto=compress&cs=tinysrgb&w=900",

  chickenBiryani:
    "https://images.pexels.com/photos/1624487/pexels-photo-1624487.jpeg?auto=compress&cs=tinysrgb&w=900",

  pennePasta:
    "https://images.pexels.com/photos/1437267/pexels-photo-1437267.jpeg?auto=compress&cs=tinysrgb&w=900",

  grilledSandwich:
    "https://images.pexels.com/photos/1600711/pexels-photo-1600711.jpeg?auto=compress&cs=tinysrgb&w=900",


  // ==========================================================
  // MUNCH — FRIED RICE / NOODLES / CHINESE
  // ==========================================================

  chickenFriedRice:
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRpgOm6aMKAmMOynkpok2yQNAQUvxm5J-ss3kaLZ57cXA&s=10",

  schezwanFriedRice:
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS5QRjF57ry-JUWJRPmbnIG3fMJeQDrzUmac0AdFJ_l8g&s=10",

  schezwanNoodles:
    "https://images.pexels.com/photos/2347311/pexels-photo-2347311.jpeg?auto=compress&cs=tinysrgb&w=900",

  chilliChicken:
    "https://images.pexels.com/photos/2338407/pexels-photo-2338407.jpeg?auto=compress&cs=tinysrgb&w=900",

  vegManchurian:
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTtyNdC_i7_vVpaxbyn4uO9LZ2s5vUw-j9x689Sh_VaFQ&s=10",


  // ==========================================================
  // NESCAFE — COFFEE / MAGGI / SNACKS
  // ==========================================================

  classicCoffee:
    "https://images.pexels.com/photos/312418/pexels-photo-312418.jpeg?auto=compress&cs=tinysrgb&w=900",

  coldCoffee:
    "https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg?auto=compress&cs=tinysrgb&w=900",

  masalaMaggi:
    "https://images.pexels.com/photos/2347311/pexels-photo-2347311.jpeg?auto=compress&cs=tinysrgb&w=900",

  chickenMaggi:
    "https://images.pexels.com/photos/2347311/pexels-photo-2347311.jpeg?auto=compress&cs=tinysrgb&w=900",

  chickenNuggets:
    "https://images.pexels.com/photos/6941010/pexels-photo-6941010.jpeg?auto=compress&cs=tinysrgb&w=900",

  frenchFries:
    "https://images.pexels.com/photos/1583884/pexels-photo-1583884.jpeg?auto=compress&cs=tinysrgb&w=900",
};


/* =========================================================
   COMMUNITY
========================================================= */

const postsSeed = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    type: "Hackathon",
    icon: <HiBolt />,
    title: "Need 2 Flutter developers for Smart India Hackathon",
    author: "Tech Innovators Club",
    time: "12 min ago",
    likes: 42,
    comments: 8,
    accent: "violet",
    tags: ["Flutter", "ML", "Team"],
    verified: true,
  },
  {
    id: "00000000-0000-4000-a000-000000000002",
    type: "Event",
    icon: <HiCalendarDays />,
    title: "Generative AI Workshop — registrations are open",
    author: "AI Club",
    time: "1 hr ago",
    likes: 76,
    comments: 14,
    accent: "blue",
    tags: ["Workshop", "AI"],
    verified: true,
  },
  {
    id: "00000000-0000-4000-a000-000000000003",
    type: "Help Needed",
    icon: <HiUserGroup />,
    title: "Does anyone have a Type-C charger near Block C?",
    author: "Ananya • CSE 2",
    time: "2 hrs ago",
    likes: 18,
    comments: 6,
    accent: "orange",
    tags: ["Help", "Block C"],
    verified: true,
  },
  {
    id: "00000000-0000-4000-a000-000000000004",
    type: "Achievement",
    icon: <HiTrophy />,
    title:
      "Congratulations to the robotics team for winning the regional challenge!",
    author: "Robotics Club",
    time: "Today",
    likes: 119,
    comments: 21,
    accent: "green",
    tags: ["Achievement"],
    verified: true,
  },
];

/* =========================================================
   EVENTS
========================================================= */

const eventsSeed = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    date: "12",
    month: "AUG",
    title: "Generative AI Workshop",
    club: "AI Club",
    time: "2:00 PM",
    place: "Seminar Hall 2",
    color: "purple",
    category: "Workshop",
    attendees: 184,
  },
  {
    id: "00000000-0000-4000-a000-000000000002",
    date: "14",
    month: "AUG",
    title: "Campus Hackathon 2026",
    club: "Coding Club",
    time: "9:00 AM",
    place: "Innovation Lab",
    color: "blue",
    category: "Hackathon",
    attendees: 420,
  },
  {
    id: "00000000-0000-4000-a000-000000000003",
    date: "16",
    month: "AUG",
    title: "Robotics Project Showcase",
    club: "Robotics Club",
    time: "4:30 PM",
    place: "Main Auditorium",
    color: "green",
    category: "Showcase",
    attendees: 142,
  },
];


const peopleSeed = [
  {
    id: 1,
    name: "Rahul Krishnan",
    course: "CSE",
    year: "3rd Year",
    match: 87,
    skills: ["Flutter", "Firebase", "ML", "UI/UX"],
  },
  {
    id: 2,
    name: "Megha Nair",
    course: "ISE",
    year: "2nd Year",
    match: 82,
    skills: ["React", "Node", "Figma", "MongoDB"],
  },
  {
    id: 3,
    name: "Aditya Rao",
    course: "ECE",
    year: "3rd Year",
    match: 79,
    skills: ["ESP32", "Embedded C", "IoT", "PCB"],
  },
  {
    id: 4,
    name: "Nikhil Varma",
    course: "AIML",
    year: "2nd Year",
    match: 74,
    skills: ["Python", "PyTorch", "CV", "LLMs"],
  },
];

const clubs = [
  {
    id: 1,
    name: "AI Club",
    category: "Technology",
    members: 426,
    events: 12,
    description: "AI workshops, research projects and paper discussions.",
  },
  {
    id: 2,
    name: "Robotics Club",
    category: "Technology",
    members: 218,
    events: 8,
    description: "Build robots, autonomous systems and embedded projects.",
  },
  {
    id: 3,
    name: "Coding Club",
    category: "Technology",
    members: 612,
    events: 16,
    description: "Hackathons, DSA sessions, open source and team formation.",
  },
  {
    id: 4,
    name: "Design Club",
    category: "Creative",
    members: 188,
    events: 9,
    description: "UI/UX, branding, motion and creative technology.",
  },
];

/* =========================================================
   FOUR CANTEENS
========================================================= */

const canteens = [
  {
    id: 1,
    name: "Udupi",
    subtitle: "South Indian",
    status: "Quiet",
    eta: "8–12 min",
    load: 32,
    color: "green",
  },
  {
    id: 2,
    name: "Tango",
    subtitle: "Rolls · Noodles · Biryani · Pasta",
    status: "Moderate",
    eta: "12–18 min",
    load: 58,
    color: "moderate",
  },
  {
    id: 3,
    name: "Munch",
    subtitle: "Fried Rice · Noodles · Chinese",
    status: "Busy",
    eta: "20–28 min",
    load: 84,
    color: "busy",
  },
  {
    id: 4,
    name: "Nescafe",
    subtitle: "Coffee · Maggi · Snacks",
    status: "Quiet",
    eta: "6–10 min",
    load: 26,
    color: "green",
  },
];


const foodItems = [

  // ==========================================================
  // UDUPI
  // ==========================================================

  {
    id: "udupi-1",
    name: "Masala Dosa",
    price: 55,
    image: FOOD_IMAGES.masalaDosa,
    category: "Udupi",
    description:
      "Crispy dosa with spiced potato masala, chutney and sambar",
    veg: true,
  },

  {
    id: "udupi-2",
    name: "Idli Vada",
    price: 45,
    image: FOOD_IMAGES.idliVada,
    category: "Udupi",
    description:
      "Soft idlis with crispy vada, sambar and coconut chutney",
    veg: true,
  },

  {
    id: "udupi-3",
    name: "Paneer Masala Dosa",
    price: 85,
    image: FOOD_IMAGES.paneerMasalaDosa,
    category: "Udupi",
    description:
      "Crispy dosa filled with paneer and masala",
    veg: true,
  },

  {
    id: "udupi-4",
    name: "Set Dosa",
    price: 50,
    image: FOOD_IMAGES.setDosa,
    category: "Udupi",
    description:
      "Soft fluffy set dosas served with chutney and sambar",
    veg: true,
  },


  // ==========================================================
  // TANGO
  // ==========================================================

  {
    id: "tango-1",
    name: "Chicken Roll",
    price: 90,
    image: FOOD_IMAGES.chickenRoll,
    category: "Tango",
    description:
      "Spiced chicken wrapped in a soft roll with fresh vegetables",
    veg: false,
  },

  {
    id: "tango-2",
    name: "Veg Noodles",
    price: 75,
    image: FOOD_IMAGES.vegNoodles,
    category: "Tango",
    description:
      "Wok-tossed noodles with fresh vegetables",
    veg: true,
  },

  {
    id: "tango-3",
    name: "Chicken Biryani",
    price: 120,
    image: FOOD_IMAGES.chickenBiryani,
    category: "Tango",
    description:
      "Aromatic chicken biryani with fragrant basmati rice",
    veg: false,
  },

  {
    id: "tango-4",
    name: "Penne Pasta",
    price: 95,
    image: FOOD_IMAGES.pennePasta,
    category: "Tango",
    description:
      "Penne pasta tossed in a rich, creamy sauce",
    veg: true,
  },

  {
    id: "tango-5",
    name: "Grilled Sandwich",
    price: 70,
    image: FOOD_IMAGES.grilledSandwich,
    category: "Tango",
    description:
      "Crispy grilled sandwich with a cheesy vegetable filling",
    veg: true,
  },


  // ==========================================================
  // MUNCH
  // ==========================================================

  {
    id: "munch-1",
    name: "Chicken Fried Rice",
    price: 100,
    image: FOOD_IMAGES.chickenFriedRice,
    category: "Munch",
    description:
      "Wok-fried rice with chicken, vegetables and seasoning",
    veg: false,
  },

  {
    id: "munch-2",
    name: "Schezwan Fried Rice",
    price: 90,
    image: FOOD_IMAGES.schezwanFriedRice,
    category: "Munch",
    description:
      "Spicy Schezwan-style fried rice with vegetables",
    veg: true,
  },

  {
    id: "munch-3",
    name: "Schezwan Noodles",
    price: 90,
    image: FOOD_IMAGES.schezwanNoodles,
    category: "Munch",
    description:
      "Spicy wok-tossed noodles with Schezwan sauce",
    veg: true,
  },

  {
    id: "munch-4",
    name: "Chilli Chicken",
    price: 120,
    image: FOOD_IMAGES.chilliChicken,
    category: "Munch",
    description:
      "Crispy chicken tossed with peppers, onions and chilli sauce",
    veg: false,
  },

  {
    id: "munch-5",
    name: "Veg Manchurian",
    price: 90,
    image: FOOD_IMAGES.vegManchurian,
    category: "Munch",
    description:
      "Crispy vegetable balls in a savoury Indo-Chinese sauce",
    veg: true,
  },


  // ==========================================================
  // NESCAFE
  // ==========================================================

  {
    id: "nescafe-1",
    name: "Classic Coffee",
    price: 35,
    image: FOOD_IMAGES.classicCoffee,
    category: "Nescafe",
    description:
      "Hot, creamy college-style coffee",
    veg: true,
  },

  {
    id: "nescafe-2",
    name: "Cold Coffee",
    price: 60,
    image: FOOD_IMAGES.coldCoffee,
    category: "Nescafe",
    description:
      "Chilled creamy coffee served cold",
    veg: true,
  },

  {
    id: "nescafe-3",
    name: "Masala Maggi",
    price: 50,
    image: FOOD_IMAGES.masalaMaggi,
    category: "Nescafe",
    description:
      "Hot Maggi noodles tossed with Indian masala",
    veg: true,
  },

  {
    id: "nescafe-4",
    name: "Chicken Maggi",
    price: 80,
    image: FOOD_IMAGES.chickenMaggi,
    category: "Nescafe",
    description:
      "Maggi noodles with spicy chicken pieces",
    veg: false,
  },

  {
    id: "nescafe-5",
    name: "Chicken Nuggets",
    price: 85,
    image: FOOD_IMAGES.chickenNuggets,
    category: "Nescafe",
    description:
      "Crispy golden chicken nuggets",
    veg: false,
  },

  {
    id: "nescafe-6",
    name: "French Fries",
    price: 60,
    image: FOOD_IMAGES.frenchFries,
    category: "Nescafe",
    description:
      "Crispy golden fries with seasoning",
    veg: true,
  },
];
/* =========================================================
   STORE
========================================================= */

/* =========================================================
   CAMPUS SERVICES
========================================================= */

const services = [
  {
    icon: <HiPrinter />,
    title: "Print & Documents",
    text: "Upload, print, bind and collect with QR pickup",
    action: "Open",
    id: "print",
  },
  {
    icon: <HiBookOpen />,
    title: "Campus Store",
    text: "Stationery, records, books and academic supplies",
    action: "Browse",
    id: "store",
  },
  {
    icon: <HiMap />,
    title: "Smart Campus Map",
    text: "Find rooms, labs, offices and facilities",
    action: "Explore",
    id: "map",
  },
  {
    icon: <HiWrenchScrewdriver />,
    title: "Report an Issue",
    text: "Wi-Fi, electrical, AC, furniture and equipment",
    action: "Report",
    id: "issues",
  },
  {
    icon: <HiBuildingOffice2 />,
    title: "Resource Booking",
    text: "Book halls, labs, equipment and sports facilities",
    action: "Book",
    id: "booking",
  },
  {
    icon: <HiMagnifyingGlassCircle />,
    title: "Lost & Found",
    text: "Report or find lost items around campus",
    action: "Open",
    id: "lost",
  },
  {
    icon: <HiShoppingCart />,
    title: "Campus Marketplace",
    text: "Buy and sell permitted items within campus",
    action: "Browse",
    id: "market",
  },
  {
    icon: <HiTicket />,
    title: "Digital Campus Pass",
    text: "QR entry for events, workshops and pickups",
    action: "View",
    id: "pass",
  },
  {
    icon: <HiHomeModern />,
    title: "Hostel",
    text: "Mess, maintenance, laundry and room services",
    action: "Open",
    id: "hostel",
  },
  {
    icon: <HiTruck />,
    title: "Campus Delivery",
    text: "Move food, documents and packages around campus",
    action: "Open",
    id: "delivery",
  },
  {
    icon: <HiAcademicCap />,
    title: "Academics",
    text: "Department/faculty announcements, assignments, timetable and academic calendar",
    action: "Open",
    id: "academics",
  },
];

/* =========================================================
   MAP / SYSTEM DATA
========================================================= */

const mapLocations = [
  {
    id: "a",
    name: "Block A",
    x: 14,
    y: 22,
    type: "Academic",
    rooms: 32,
  },
  {
    id: "b",
    name: "Block B",
    x: 68,
    y: 22,
    type: "Academic",
    rooms: 28,
  },
  {
    id: "c",
    name: "Block C",
    x: 14,
    y: 65,
    type: "Academic",
    rooms: 24,
  },
  {
    id: "d",
    name: "Labs",
    x: 68,
    y: 65,
    type: "Laboratory",
    rooms: 18,
  },
  {
    id: "canteen",
    name: "Food Court",
    x: 42,
    y: 47,
    type: "Food",
    rooms: 4,
  },
  {
    id: "main",
    name: "Main Auditorium",
    x: 42,
    y: 80,
    type: "Events",
    rooms: 1,
  },
];

const notificationsSeed = [
  {
    id: 1,
    type: "event",
    title: "AI Workshop starts in 30 minutes",
    time: "10 min ago",
    unread: true,
  },
  {
    id: 2,
    type: "service",
    title: "Print order #2048 is ready",
    time: "24 min ago",
    unread: true,
  },
  {
    id: 3,
    type: "community",
    title: "Someone replied to your post",
    time: "1 hr ago",
    unread: true,
  },
  {
    id: 4,
    type: "official",
    title: "Semester schedule has been published",
    time: "Yesterday",
    unread: false,
  },
];

const autonomousDevices = [
  {
    id: "DR-01",
    name: "Delivery Robot #01",
    type: "Delivery Robot",
    status: "Online",
    battery: 86,
    location: "Block B",
    icon: <HiTruck />,
  },
  {
    id: "DR-02",
    name: "Delivery Robot #02",
    type: "Delivery Robot",
    status: "Charging",
    battery: 42,
    location: "Service Bay",
    icon: <HiTruck />,
  },
  {
    id: "DL-01",
    name: "Campus Drone #01",
    type: "Autonomous Drone",
    status: "Standby",
    battery: 91,
    location: "Drone Pad",
    icon: <HiPaperAirplane />,
  },
  {
    id: "IOT-48",
    name: "Environmental Network",
    type: "IoT Network",
    status: "48 / 48 online",
    battery: 100,
    location: "Campus-wide",
    icon: <HiSignal />,
  },
];

/* =========================================================
   APP
========================================================= */

function App() {
  const online = useOnlineStatus();
  // Lazily read the initial section straight from the URL (not just
  // "home") so a deep link or a page refresh lands you back where you
  // were instead of always bouncing to Home -- see the ROUTING block
  // above.
  const [active, setActive] = useState(() =>
    typeof window !== "undefined" ? pathToKey(window.location.pathname) : "home"
  );
  const [search, setSearch] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [toast, setToast] = useState("");
  const [postFilter, setPostFilter] = useState("All");
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("campus-theme") === "dark"
  );
  const [notifications, setNotifications] = useState(notificationsSeed);
  const [modal, setModal] = useState(null);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [foodCart, setFoodCart] = useState([]);
  const [storeCart, setStoreCart] = useState([]);
  const [printFile, setPrintFile] = useState(null);
  const [dbCanteens, setDbCanteens] = useState([]);
  const [dbFoodItems, setDbFoodItems] = useState([]);
  const [dbStoreItems, setDbStoreItems] = useState([]);
  const [dbStoresLoading, setDbStoresLoading] = useState(true);
  const [myStoreOrders, setMyStoreOrders] = useState([]);
  const [dbOpportunities, setDbOpportunities] = useState([]);
  const [dbMentors, setDbMentors] = useState([]);
  const [myApplicationIds, setMyApplicationIds] = useState([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [authUser, setAuthUser] =
    useState(null);

  const [campusId, setCampusId] =
    useState(null);

  const [profile, setProfile] =
    useState(null);

  const [backendLoading, setBackendLoading] =
    useState(true);

  const [backendError, setBackendError] =
    useState("");

  const [orders, setOrders] =
    useState([]);
  const [people, setPeople] = useState([]);
  const [registeredEventIds, setRegisteredEventIds] = useState([]);
  const [savedEventIds, setSavedEventIds] = useState([]);
  const [savedPostIds, setSavedPostIds] = useState([]);
  const [printJobs, setPrintJobs] = useState([]);
  const [serviceRequests, setServiceRequests] = useState([]);
  const [resources, setResources] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [lostItems, setLostItems] = useState([]);
  const [lostItemsLoaded, setLostItemsLoaded] = useState(false);
  const [marketListings, setMarketListings] = useState([]);
  const [verification, setVerification] = useState(null);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [openConversationId, setOpenConversationId] = useState(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  const toastTimer = useRef(null);

  // Doc §9 "Offline Mode": register the service worker unconditionally on
  // mount so the app-shell caching in public/sw.js is active for every
  // signed-in-or-not visitor, not just those who opt into push (previously
  // the only registration path -- see subscribeToPush() in pushService.js,
  // which still works unchanged since it just reuses/reawaits whatever
  // registration is already in place by the time someone opts in).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const notify = (message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  };

  // Shared by the profile editor and the event-registration confirmation
  // dialog, since both can hand back an updated profile row (e.g. a phone
  // number the RPC just backfilled) that needs to land in both `profile`
  // and the merged `user` view.
  const applyProfileUpdate = (next) => {
    setProfile(next);
    setUser((current) => ({ ...current, ...next }));
  };

  const handleLogout = async () => {
  try {
    await signOut();

    setAuthUser(null);
    setProfile(null);
    setUser(null);

    go("home");

    notify(
      "You have been logged out"
    );

  } catch (error) {
    console.error(
      "Logout failed:",
      error
    );

    notify(
      "Logout failed"
    );
  }
};

  const go = (key) => {
    setActive(key);
    setModal(null);
    // Keep the address bar in sync with whatever section is actually
    // rendering. Unroutable keys (shouldn't happen -- every call site
    // passes a value renderPage() handles) fall back to "/" rather than
    // writing a dead URL into history.
    const path = keyToPath(ROUTABLE_KEYS.has(key) ? key : "home");
    if (window.location.pathname !== path) {
      window.history.pushState({ key }, "", path);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Browser back/forward: reflect the URL the user just landed on without
  // pushing a new history entry (that would fight the browser's own
  // stack).
  useEffect(() => {
    const onPopState = () => setActive(pathToKey(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Shared by "Message seller" (Marketplace), "Message" (Connect/People) and
  // a tapped message notification -- all three just need "open the
  // Messages tab with this specific thread already selected."
  const goToConversation = (conversationId) => {
    setOpenConversationId(conversationId);
    go("messages");
  };

  const toggleTheme = () => {
    setDarkMode((current) => {
      const next = !current;
      localStorage.setItem("campus-theme", next ? "dark" : "light");
      return next;
    });
  };

  const filteredPosts = useMemo(() => {
    const q = search.toLowerCase().trim();

    return posts.filter(
      (p) =>
        (postFilter === "All" ||
          (postFilter === "Saved" ? savedPostIds.includes(p.id) : p.type === postFilter)) &&
        (!q ||
          `${p.title} ${p.author} ${p.tags.join(" ")}`
            .toLowerCase()
            .includes(q))
    );
  }, [search, postFilter, posts, savedPostIds]);

  const addFood = (item) => {
    setFoodCart((cart) => {
      if (cart.length && cart[0].canteenId && item.canteenId && cart[0].canteenId !== item.canteenId) {
        notify("You can only order from one canteen at a time.");
        return cart;
      }
      notify(`${item.name} added to food cart`);
      return mergeCartItem(cart, item);
    });
  };

  const addStore = (item) => {
    setStoreCart((cart) => {
      if (cart.length && cart[0].storeId && item.storeId && cart[0].storeId !== item.storeId) {
        notify("You can only order from one store at a time.");
        return cart;
      }
      notify(`${item.name} added to store cart`);
      return mergeCartItem(cart, item);
    });
  };

  const checkoutStore = async () => {
    if (!authUser) {
      setLoginOpen(true);
      notify("Sign in before placing an order");
      return;
    }
    if (!storeCart.length) {
      notify("Your store cart is empty");
      return;
    }
    const storeId = storeCart[0]?.storeId;
    if (!storeId) {
      notify("Please pick items from the store first");
      return;
    }
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${authUser.id}-${Date.now()}`;

      const order = await createStoreOrder({ storeId, cart: storeCart, idempotencyKey });
      setMyStoreOrders((current) => [order, ...current]);
      setStoreCart([]);
      setModal(null);
      notify(`Order placed! Pickup code: ${order.pickup_code}`);
    } catch (error) {
      notify(error.message || "Could not place order");
    }
  };

  const checkoutFood = async () => {
    try {

      if (!authUser) {
        setLoginOpen(true);

        notify(
          "Sign in before placing an order"
        );

        return;
      }

      if (!foodCart.length) {
        notify(
          "Your food cart is empty"
        );

        return;
      }

      const canteenId =
        foodCart[0]?.canteenId;

      if (!canteenId) {
        notify(
          "Please select a canteen"
        );

        return;
      }

      // A fresh idempotency key per checkout *attempt* -- if this click
      // fires twice (flaky Wi-Fi, doc §63), the RPC returns the same order
      // both times instead of creating a duplicate.
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${authUser.id}-${Date.now()}`;

      const order =
        await createFoodOrder({
          userId:
            authUser.id,

          canteenId,

          cart:
            foodCart,

          idempotencyKey,
        });

      setOrders(
        (current) => [
          order,
          ...current,
        ]
      );

      setFoodCart([]);
      setModal(null);
      notify(`Order created · ₹${order.total} — opening payment…`);

      // Payment: re-derive the amount server-side and open Razorpay
      // Checkout. The order becomes PAID only once razorpay-webhook
      // verifies the gateway signature -- the realtime `orders`
      // subscription above then updates this order's status on its own.
      try {
        const payment = await startFoodOrderPayment(order.id);
        await openRazorpayCheckout({
          keyId: payment.key_id,
          gatewayOrderId: payment.gateway_order_id,
          amount: payment.amount,
          currency: payment.currency,
          prefillEmail: authUser.email,
          prefillName: user?.name,
          onDismiss: () => notify("Payment cancelled — you can pay again from My Orders"),
        });
      } catch (paymentError) {
        console.error("Payment start failed:", paymentError);
        logClientError(paymentError.message || "Payment start failed", {
          stack: paymentError.stack,
          severity: "error",
          context: { flow: "food_order_payment", orderId: order.id },
        });
        notify(
          paymentError.message?.includes("GATEWAY_NOT_CONFIGURED") ||
          paymentError.message?.includes("not configured")
            ? "Order created, but payments aren't configured on this deployment yet."
            : (paymentError.message || "Payment could not be started. Try again from My Orders.")
        );
      }

    } catch (error) {

      console.error(
        "Food order:",
        error
      );

      logClientError(error.message || "Food order creation failed", {
        stack: error.stack,
        severity: "error",
        context: { flow: "food_order_create" },
      });

      notify(
        error.message ||
        "Unable to place order"
      );
    }
  };

  const createPost = async (post) => {
    try {

      if (!authUser) {
        setLoginOpen(true);

        notify(
          "Sign in to publish posts"
        );

        return;
      }

      const savedPost =
        await publishPost({
          userId:
            authUser.id,

          campusId,

          type:
            post.type,

          title:
            post.title,

          content:
            post.content || "",

          tags:
            post.tags || [],

          imageUrls:
            post.images || [],
        });

      setPosts(
        (current) => [
          {
            ...post,

            id:
              savedPost.id,

            icon:
              <HiMegaphone />,

            time:
              "Just now",

            likes: 0,

            comments: 0,

            images:
              post.images || [],

            verified: true,
          },

          ...current,
        ]
      );

      setModal(null);

      notify(
        "Post published to Campus Feed"
      );

    } catch (error) {

      console.error(
        "Post creation:",
        error
      );

      notify(
        error.message ||
        "Unable to publish post"
      );
    }
  };

  const handleToggleSavePost = async (postId) => {
    if (!authUser?.id) {
      setLoginOpen(true);
      notify("Sign in to save posts");
      return;
    }
    try {
      const isSavedNow = await toggleSavedPost({ postId, userId: authUser.id });
      setSavedPostIds((current) =>
        isSavedNow ? [...current, postId] : current.filter((id) => id !== postId)
      );
    } catch (error) {
      notify(error.message || "Could not save this post");
    }
  };

  const markNotificationsRead =
    async () => {

      setNotifications(
        (items) =>
          items.map(
            (item) => ({
              ...item,
              unread: false,
            })
          )
      );

      if (!authUser) {
        notify(
          "Notifications marked as read"
        );

        return;
      }

      try {

        await markAllNotificationsRead(
          authUser.id
        );

        notify(
          "All notifications marked as read"
        );

      } catch (error) {

        console.error(
          "Notification update:",
          error
        );

        notify(
          "Updated locally"
        );
      }
    };
    const [events, setEvents] =
      useState([]);

    const [eventsLoading, setEventsLoading] =
      useState(false);
    const [clubs, setClubs] = useState([]);

      useEffect(() => {
        if (!campusId) return;

        let mounted = true;

        async function loadClubs() {
          try {
            const data =
              await getClubs(
                campusId
              );

            if (mounted) {
              setClubs(data);
            }

          } catch (error) {
            console.error(
              "Club loading failed:",
              error
            );
          }
        }

        loadClubs();

        return () => {
          mounted = false;
        };
      }, [campusId]);

      useEffect(() => {
        if (!campusId) return;

        let mounted = true;

        async function loadPosts() {
          try {
            setPostsLoading(true);
            const data = await getCampusPosts(campusId);
            if (mounted) setPosts(data);
          } catch (error) {
            console.error("Post loading failed:", error);
          } finally {
            if (mounted) setPostsLoading(false);
          }
        }

        loadPosts();
        const unsub = subscribeToPosts(() => loadPosts());

        return () => {
          mounted = false;
          unsub?.();
        };
      }, [campusId]);

      useEffect(() => {
        if (!campusId) return;

        let mounted = true;

        async function loadEvents() {
          try {
            setEventsLoading(true);
            const data = await getCampusEvents(campusId);
            if (mounted) setEvents(data);
          } catch (error) {
            console.error("Event loading failed:", error);
          } finally {
            if (mounted) setEventsLoading(false);
          }
        }

        loadEvents();
        const unsub = subscribeToEvents(() => loadEvents());

        return () => {
          mounted = false;
          unsub?.();
        };
      }, [campusId]);

    useEffect(() => {
      let mounted = true;

      async function initialize() {
        try {
          setBackendLoading(true);
          setBackendError("");

          const campus = await getDefaultCampus();
          if (!mounted) return;

          setCampusId(campus.id);

          const currentUser = await getCurrentUser();

          if (currentUser) {
            const currentProfile = await getOrCreateProfile(
              currentUser,
              campus.id
            );

            if (!mounted) return;

            setAuthUser(currentUser);
            setProfile(currentProfile);
            // Fire-and-forget DAU ping (see mvpService.js) -- wrapped so a
            // failure here (e.g. an incomplete mock in tests) can never
            // abort the rest of this init flow.
            try { touchActivity(); } catch (pingError) { console.warn("touchActivity warning:", pingError); }

            setUser({
              name:
                currentProfile?.name ||
                currentUser.email?.split("@")[0] ||
                "Campus Student",
              email: currentUser.email || "",
              usn: currentProfile?.usn || "",
              course:
                currentProfile?.course ||
                "Computer Science & Engineering",
              year: currentProfile?.year || "2nd Year",
            });

            const [userNotifications, userOrders] = await Promise.all([
              getUserNotifications(currentUser.id),
              getMyOrders(currentUser.id),
            ]);

            if (!mounted) return;

            if (userNotifications?.length) {
              setNotifications(
                userNotifications.map((item) => ({
                  id: item.id,
                  type: item.type || "official",
                  title: item.title || "",
                  time: item.created_at
                    ? new Date(item.created_at).toLocaleString()
                    : "Recently",
                  unread: !item.read,
                }))
              );
            }
            if (userOrders?.length) {
              setOrders(userOrders);
            }
          }
        } catch (error) {
          console.error("CampusOS initialization failed:", error);
          if (mounted) {
            setBackendError(
              error?.message || "Unable to connect to CampusOS."
            );
          }
        } finally {
          if (mounted) {
            setBackendLoading(false);
          }
        }
      }

      initialize();

      const unsubscribe = subscribeToAuthChanges(async ({ user: nextUser }) => {
        if (!mounted) return;
        setAuthUser(nextUser);
        if (!nextUser) {
          setProfile(null);
          setUser(null);
          return;
        }
        try {
          const campus = await getDefaultCampus();
          const currentProfile = await getOrCreateProfile(
            nextUser,
            campus.id
          );
          if (!mounted) return;
          setCampusId(campus.id);
          setProfile(currentProfile);
          setUser({
            name:
              currentProfile?.name ||
              nextUser.email?.split("@")[0] ||
              "Campus Student",
            email: nextUser.email || "",
            usn: currentProfile?.usn || "",
            course:
              currentProfile?.course ||
              "Computer Science & Engineering",
            year: currentProfile?.year || "2nd Year",
          });
          setLoginOpen(false);
          notify("Welcome to CampusOS");
        } catch (error) {
          console.error("Auth sync failed:", error);
        }
      });

      return () => {
        mounted = false;
        unsubscribe?.();
      };
    }, []);

    useEffect(() => {
      let mounted = true;

      async function loadFood() {
        try {
          setDbLoading(true);
          setDbError("");

          const { canteens, items } = await getCampusFood(campusId);

          if (!mounted) return;

          setDbCanteens(canteens);
          setDbFoodItems(items);
        } catch (error) {
          console.error("Food loading error:", error);
          if (mounted) {
            setDbError(error.message || "Unable to load campus food.");
          }
        } finally {
          if (mounted) {
            setDbLoading(false);
          }
        }
      }

      loadFood();
      const unsub = subscribeToFood(() => loadFood());

      return () => {
        mounted = false;
        unsub?.();
      };
    }, [campusId]);

    useEffect(() => {
      let mounted = true;

      async function loadStore() {
        try {
          setDbStoresLoading(true);
          // Every active store's catalog, flattened into one shopping grid --
          // same "one flat list" shape the old hardcoded storeItems array
          // had, just backed by real per-store items now. Each item carries
          // its store_id/store name so the cart can enforce "one store at a
          // time" (create_store_order requires it) and the receipt can show
          // who it's from.
          const stores = await getStores(campusId);
          const perStore = await Promise.all(stores.map((s) => getStoreItems(s.id)));
          const flattened = stores.flatMap((s, i) =>
            perStore[i].map((item) => ({ ...item, storeId: s.id, storeName: s.name, vendor: s.name }))
          );
          if (!mounted) return;
          setDbStoreItems(flattened);
        } catch (error) {
          console.error("Store loading error:", error);
        } finally {
          if (mounted) setDbStoresLoading(false);
        }
      }

      loadStore();
      const unsub = subscribeToStores(() => loadStore());

      return () => {
        mounted = false;
        unsub?.();
      };
    }, [campusId]);

    useEffect(() => {
      let mounted = true;

      Promise.all([getOpportunities(campusId), getMentors(campusId)])
        .then(([opps, mentorList]) => {
          if (!mounted) return;
          setDbOpportunities(opps);
          setDbMentors(mentorList);
        })
        .catch((error) => console.error("Opportunities/mentors loading error:", error));

      return () => { mounted = false; };
    }, [campusId]);

    useEffect(() => {
      if (!authUser?.id) { setMyApplicationIds([]); return; }
      getMyApplications(authUser.id)
        .then((apps) => setMyApplicationIds(apps.map((a) => a.opportunity_id)))
        .catch(() => {});
    }, [authUser?.id]);

    useEffect(() => {
      if (!authUser?.id) return;

      const unsubscribeNotifications = subscribeToUserNotifications(
        authUser.id,
        () => {
          getUserNotifications(authUser.id).then((items) => {
            if (items?.length) {
              setNotifications(
                items.map((item) => ({
                  id: item.id,
                  type: item.type || "official",
                  title: item.title || "",
                  time: item.created_at
                    ? new Date(item.created_at).toLocaleString()
                    : "Recently",
                  unread: !item.read,
                  actionType: item.action_type || null,
                  actionId: item.action_id || null,
                }))
              );
            }
          });
        }
      );

      const unsubscribeOrders = subscribeToOrders(authUser.id, () => {
        getMyOrders(authUser.id).then((ordersList) => {
          if (ordersList) {
            setOrders(ordersList);
          }
        });
      });

      return () => {
        unsubscribeNotifications?.();
        unsubscribeOrders?.();
      };
    }, [authUser?.id]);

    useEffect(() => {
      if (!authUser?.id) { setMyStoreOrders([]); return; }

      const loadMyStoreOrders = () => {
        getMyStoreOrders(authUser.id).then(setMyStoreOrders).catch(() => {});
      };

      loadMyStoreOrders();
      const unsub = subscribeToStoreOrders(authUser.id, loadMyStoreOrders);
      return () => unsub?.();
    }, [authUser?.id]);

    const reloadUnreadMessages = () => {
      if (!authUser?.id) { setUnreadMessageCount(0); return; }
      getUnreadMessageCount().then(setUnreadMessageCount).catch(() => {});
    };

    useEffect(() => {
      reloadUnreadMessages();
      if (!authUser?.id) return;

      const unsubMessages = subscribeToConversationList(() => reloadUnreadMessages());
      return () => unsubMessages?.();
    }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const reloadVerification = () => {
      if (!profile?.id) { setVerification(null); return; }
      getMyVerification(profile.id).then(setVerification).catch((error) => console.error("Verification status loading failed", error));
    };

    useEffect(() => { reloadVerification(); }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (!campusId) return;

      const loadCampusData = () => {
        getPeople({ campusId }).then(setPeople).catch((error) => console.error("People loading failed", error));
        getResources(campusId).then(setResources).catch((error) => console.error("Resource loading failed", error));
        getLostFoundItems(campusId).then(setLostItems).catch((error) => console.error("Lost & found loading failed", error)).finally(() => setLostItemsLoaded(true));
        getMarketplaceListings(campusId).then(setMarketListings).catch((error) => console.error("Marketplace loading failed", error));
      };

      loadCampusData();

      const unsubMarket = subscribeToMarketplace(() => {
        getMarketplaceListings(campusId).then(setMarketListings).catch(() => {});
      });

      const unsubLost = subscribeToLostFound(() => {
        getLostFoundItems(campusId).then(setLostItems).catch(() => {});
      });

      return () => {
        unsubMarket?.();
        unsubLost?.();
      };
    }, [campusId]);

    useEffect(() => {
      if (!authUser?.id) return;
      Promise.all([
        getMyRegisteredEventIds(authUser.id), getSavedEvents(authUser.id), getMyPrintJobs(authUser.id),
        getMyServiceRequests(authUser.id), getMyBookings(authUser.id), getMyOrders(authUser.id), getSavedPosts(authUser.id),
      ]).then(([registered, saved, jobs, requests, myBookings, myOrders, savedPosts]) => {
        setRegisteredEventIds(registered); setSavedEventIds(saved); setPrintJobs(jobs);
        setServiceRequests(requests); setBookings(myBookings); setOrders(myOrders); setSavedPostIds(savedPosts);
      }).catch((error) => console.error("Personal workspace loading failed", error));
    }, [authUser?.id]);

    // Doc §9 "Offline Mode" -- synchronization: reads served while offline
    // come from mvpService.js's offline cache (withOfflineCache) and can be
    // stale. There's no real write-conflict to resolve (every write-capable
    // action is online-required, see the doc), so "sync" here just means
    // refetching the offline-cached reads the moment connectivity comes
    // back, so both the UI and the cache catch up with whatever changed on
    // the server while this device was offline. Guarded by a ref (not just
    // `online` itself) so this only fires on a real false->true transition,
    // never on first mount.
    const wasOnline = useRef(online);
    useEffect(() => {
      const justReconnected = !wasOnline.current && online;
      wasOnline.current = online;
      if (!justReconnected) return;

      if (campusId) {
        getCampusEvents(campusId).then(setEvents).catch(() => {});
        getCampusFood(campusId)
          .then(({ canteens, items }) => {
            setDbCanteens(canteens);
            setDbFoodItems(items);
          })
          .catch(() => {});
      }

      if (authUser?.id) {
        getOrCreateProfile(authUser, campusId).then(setProfile).catch(() => {});
        getSavedEvents(authUser.id).then(setSavedEventIds).catch(() => {});
        getUserNotifications(authUser.id).then((items) => {
          if (items?.length) {
            setNotifications(
              items.map((item) => ({
                id: item.id,
                type: item.type || "official",
                title: item.title || "",
                time: item.created_at
                  ? new Date(item.created_at).toLocaleString()
                  : "Recently",
                unread: !item.read,
                actionType: item.action_type || null,
                actionId: item.action_id || null,
              }))
            );
          }
        }).catch(() => {});
      }
    }, [online, campusId, authUser]);

    // Once a GitHub identity is linked (via the profile page's "Connect
    // GitHub" button), derive a real github.com/<username> link from it and
    // save it to the profile -- runs on every auth/profile change so it's
    // self-healing (catches a link completed in a previous session too),
    // and is a no-op once profile.github_url already matches.
    useEffect(() => {
      if (!authUser?.identities || !profile?.id) return;
      const derived = deriveGithubUrlFromIdentities(authUser.identities);
      if (derived && derived !== profile.github_url) {
        updateProfile(profile.id, { github_url: derived })
          .then(applyProfileUpdate)
          .catch((error) => console.error("GitHub link sync failed", error));
      }
    }, [authUser?.identities, profile?.id, profile?.github_url]); // eslint-disable-line react-hooks/exhaustive-deps

    // Same idea for LinkedIn, but LinkedIn's OAuth can't hand back a
    // profile URL (see mvpService.js) -- this only records the verified
    // badge server-side via mark_linkedin_verified(), never writes
    // linkedin_url itself.
    useEffect(() => {
      if (!authUser?.identities || !profile?.id || profile.linkedin_verified_at) return;
      if (!hasLinkedinIdentity(authUser.identities)) return;
      markLinkedinVerified()
        .then(applyProfileUpdate)
        .catch((error) => console.error("LinkedIn verification sync failed", error));
    }, [authUser?.identities, profile?.id, profile?.linkedin_verified_at]); // eslint-disable-line react-hooks/exhaustive-deps

    // A direct link, bookmark, or refresh into a role-gated route
    // (/admin, /vendor, /facilities) shouldn't sit there showing a
    // "restricted" screen forever -- bounce back to Home and fix the URL
    // once we actually know the signed-in role (renderPage() below is
    // still the real gate; this just keeps the address bar honest once
    // that gate says no). Waits for backendLoading to clear so a
    // still-loading profile doesn't get misread as "no access" and
    // bounce a legitimate admin/vendor/facilities user before their
    // role has even loaded.
    useEffect(() => {
      if (backendLoading) return;

      // Vendor accounts are further restricted to their own dashboard --
      // "home" isn't a safe fallback for them the way it is for everyone
      // else (their whole nav is the dashboard + profile), so this branch
      // bounces to "vendor" instead of falling through to the shared check
      // below, which would otherwise send a vendor to a Home page they
      // don't have a nav button to get back out of.
      if (profile?.role === "vendor") {
        if (!VENDOR_ALLOWED_KEYS.has(active)) go("vendor");
        return;
      }

      const roleGatedButAllowed =
        (active !== "admin" || profile?.role === "college_admin" || profile?.role === "super_admin") &&
        (active !== "vendor" || profile?.role === "vendor") &&
        (active !== "facilities" ||
          profile?.role === "facilities_staff" ||
          profile?.role === "college_admin" ||
          profile?.role === "super_admin");
      if (!roleGatedButAllowed) go("home");
    }, [active, backendLoading, profile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderPage = () => {
    if (active === "home") {
      return (
        <Home
          go={go}
          search={search}
          setSearch={setSearch}
          notify={notify}
          notifications={notifications}
          openModal={setModal}
          foodCart={foodCart}
          storeCart={storeCart}
          authUser={authUser}
        />
      );
    }

    if (active === "campus") {
      return (
        <Campus
          search={search}
          setSearch={setSearch}
          filter={postFilter}
          setFilter={setPostFilter}
          notify={notify}
          posts={filteredPosts}
          openModal={setModal}
          people={people}
          clubs={clubs}
          go={go}
          authUser={authUser}
          setLoginOpen={() => setLoginOpen(true)}
          postsLoading={postsLoading}
          savedPostIds={savedPostIds}
          onToggleSave={handleToggleSavePost}
        />
      );
    }

    if (active === "events") {
      return (
        <Events
          notify={notify}
          events={events.length ? events : eventsSeed}
          eventsLoading={eventsLoading}
          opportunities={dbOpportunities}
          mentors={dbMentors}
          appliedIds={myApplicationIds}
          onApplied={(id) => setMyApplicationIds((ids) => [...ids, id])}
          go={go}
          authUser={authUser}
          profile={profile}
          openLogin={() => setLoginOpen(true)}
          registeredIds={registeredEventIds}
          savedIds={savedEventIds}
          onRegistrationChange={setRegisteredEventIds}
          onSavedChange={setSavedEventIds}
          onProfileUpdated={applyProfileUpdate}
        />
      );
    }

    if (active === "services") {
      return (
        <Services
          notify={notify}
          go={go}
          openModal={setModal}
          foodCart={foodCart}
          storeCart={storeCart}
          printFile={printFile}
        />
      );
    }

    if (active === "socialize") {
      return <Socialize notify={notify} people={people} profile={profile} campusId={campusId} authUser={authUser} openLogin={() => setLoginOpen(true)} onOpenConversation={goToConversation} />;
    }

    if (active === "messages") {
      if (!authUser) {
        return (
          <ErrorState
            title="Sign in to view messages"
            text="Messages are only available to signed-in students."
          />
        );
      }
      return (
        <Messages
          notify={notify}
          authUser={authUser}
          openConversationId={openConversationId}
          onConversationOpened={() => setOpenConversationId(null)}
          onUnreadChange={setUnreadMessageCount}
        />
      );
    }

    if (active === "profile") {
      return (
        <Profile
          user={user}
          onLogin={() => setLoginOpen(true)}
          onLogout={handleLogout}
          notify={notify}
          openModal={setModal}
          profile={profile}
          onProfileUpdated={applyProfileUpdate}
          stats={{ posts: posts.length, events: registeredEventIds.length, clubs: 0 }}
          verification={verification}
          onVerificationChanged={reloadVerification}
          campusId={campusId}
          go={go}
        />
      );
    }

    if (active === "activity") {
      if (!authUser) {
        return (
          <ErrorState
            title="Sign in to view your activity"
            text="Your food orders, bookings, applications, payments and more all live here once you're signed in."
          />
        );
      }
      return (
        <YourActivity
          profile={profile}
          authUser={authUser}
          notify={notify}
          go={go}
          orders={orders}
          printJobs={printJobs}
          serviceRequests={serviceRequests}
          bookings={bookings}
          notifications={notifications}
        />
      );
    }

    if (active === "map") {
      return <CampusMap notify={notify} openModal={setModal} />;
    }

    if (active === "legal") {
      return <LegalPage go={go} />;
    }

    if (active === "verify-email") {
      return <VerifyEmailPage go={go} />;
    }

    if (active === "reset-password") {
      return <ResetPasswordPage go={go} notify={notify} />;
    }

    if (active === "people") {
      return (
        <People notify={notify} people={people} campusId={campusId} authUser={authUser} openLogin={() => setLoginOpen(true)} onOpenConversation={goToConversation} />
      );
    }

    if (active === "clubs") {
      return <Clubs notify={notify} clubs={clubs} authUser={authUser} setLoginOpen={setLoginOpen} campusId={campusId} />;
    }

    if (active === "food") {
      return (
        <Food
        notify={notify}
        canteens={dbCanteens}
        items={dbFoodItems}
        cart={foodCart}
        addFood={addFood}
        openModal={setModal}
        loading={dbLoading}
        error={dbError}
      />
      );
    }

    if (active === "store") {
      return (
        <Store
          notify={notify}
          items={dbStoreItems}
          loading={dbStoresLoading}
          cart={storeCart}
          addStore={addStore}
          openModal={setModal}
          orders={myStoreOrders}
        />
      );
    }

    if (active === "ai") {
      return <CampusAI notify={notify} go={go} authUser={authUser} profile={profile} campusId={campusId} addFood={addFood} openLogin={() => setLoginOpen(true)} />;
    }

    if (active === "admin") {
      if (!(profile?.role === "college_admin" || profile?.role === "super_admin")) {
        return (
          <ErrorState
            title="Admin access only"
            text="This area is restricted to campus administrators."
          />
        );
      }
      return <AdminCMS notify={notify} campusId={campusId} authUser={authUser} />;
    }

    if (active === "vendor") {
      if (profile?.role !== "vendor") {
        return (
          <ErrorState
            title="Vendor access only"
            text="This area is restricted to vendor accounts."
          />
        );
      }
      return <VendorDashboard notify={notify} authUser={authUser} />;
    }

    if (active === "facilities") {
      if (profile?.role !== "facilities_staff" && !(profile?.role === "college_admin" || profile?.role === "super_admin")) {
        return (
          <ErrorState
            title="Facilities staff access only"
            text="This area is restricted to facilities staff accounts."
          />
        );
      }
      return <FacilitiesDashboard notify={notify} campusId={campusId} />;
    }

    if (active === "autonomous") {
      return <AutonomousCampus notify={notify} devices={autonomousDevices} />;
    }

    if (active === "calendar") {
      return <MyCalendar notify={notify} events={events.length ? events : eventsSeed} />;
    }

    if (active === "notifications") {
      return (
        <NotificationsPage
          notifications={notifications}
          markRead={markNotificationsRead}
          notify={notify}
          onOpenConversation={goToConversation}
          authUser={authUser}
          profile={profile}
        />
      );
    }

    if (
      [
        "print",
        "issues",
        "booking",
        "lost",
        "market",
        "pass",
        "hostel",
        "delivery",
        "academics",
      ].includes(active)
    ) {
      return (
        <ServiceDetail
          serviceId={active}
          notify={notify}
          go={go}
          openModal={setModal}
          openLogin={() => setLoginOpen(true)}
          authUser={authUser}
          user={user}
          profile={profile}
          campusId={campusId}
          resources={resources}
          bookings={bookings}
          serviceRequests={serviceRequests}
          printJobs={printJobs}
          lostItems={lostItems}
          lostItemsLoaded={lostItemsLoaded}
          marketListings={marketListings}
          onBookingsChange={setBookings}
          onRequestsChange={setServiceRequests}
          onLostItemsChange={setLostItems}
          onMarketListingsChange={setMarketListings}
          onPrintJobsChange={setPrintJobs}
          onOpenConversation={goToConversation}
        />
      );
    }

    return <Home go={go} search={search} setSearch={setSearch} notify={notify} />;
  };

  return (
    <div className={`app-shell ${darkMode ? "dark-mode" : "light-mode"}`}>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => go(profile?.role === "vendor" ? "vendor" : "home")}
          aria-label="Campus OS home"
        >
          <span className="brand-mark">C</span>
          <span>
            <b>Campus</b>
            <em>OS</em>
          </span>
        </button>

        <div className="location">
          <span className="pin">
            <HiMapPin />
          </span>
          <span>
            <small>YOUR CAMPUS</small>
            <b>New Horizon College Of Engineering</b>
          </span>
        </div>

        <div className="top-actions">
          {authUser && profile?.role !== "vendor" && (
            <button
              className="icon-btn"
              onClick={() => setGlobalSearchOpen(true)}
              aria-label="Search CampusOS"
              data-testid="global-search-button"
            >
              <HiMagnifyingGlass />
            </button>
          )}

          <button
            className="icon-btn"
            onClick={() => {
              go("notifications");
              markNotificationsRead();
            }}
            aria-label="Notifications"
          >
            <HiBell />
            <i>{notifications.filter((n) => n.unread).length}</i>
          </button>

          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={
              darkMode ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            <span className="theme-track">
              <span className="theme-thumb">
                {darkMode ? <HiMoon /> : <HiSun />}
              </span>
            </span>
          </button>

          {user ? (
            <button className="profile-mini" onClick={() => go("profile")}>
              <span>{user.name[0]}</span>
              {user.name.split(" ")[0]}
            </button>
          ) : (
            <button
              className="login-btn"
              onClick={() => setLoginOpen(true)}
              data-testid="sign-in-button"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <OfflineBanner online={online} />

      {backendError && (
        <div className="offline-banner" role="alert" style={{ background: "#e2555522", color: "#c23a3a" }}>
          <HiExclamationTriangle /> {backendError} — some data may be out of date.
        </div>
      )}

      <main>{profile?.status === "suspended" ? <SuspendedAccountScreen profile={profile} notify={notify} /> : renderPage()}</main>

      <nav className="bottom-nav">
        {/* A vendor account is a purpose-built ordering console, not the
            full student nav plus an extra tab -- swap the whole bar for
            just Dashboard + Profile rather than filtering navItems down to
            one real entry and bolting a second button on after it. */}
        {(profile?.role === "vendor" ? [["vendor", <HiShoppingBag key="vendor-icon" />, "Dashboard"], ["profile", <HiUserCircle key="profile-icon" />, "Profile"]] : navItems).map(([key, icon, label]) => (
          <button
            key={key}
            className={active === key ? "active" : ""}
            onClick={() => go(key)}
            data-testid={`nav-${key}-button`}
          >
            <span style={key === "messages" ? { position: "relative" } : undefined}>
              {icon}
              {key === "messages" && unreadMessageCount > 0 && (
                <i style={{ position: "absolute", top: -6, right: -10, width: 16, height: 16, borderRadius: "50%", fontSize: 9, background: "var(--purple)", color: "#fff", fontStyle: "normal", display: "grid", placeItems: "center" }}>
                  {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                </i>
              )}
            </span>
            <small>{label}</small>
          </button>
        ))}
        {(profile?.role === "college_admin" || profile?.role === "super_admin") && (
          <button
            className={active === "admin" ? "active" : ""}
            onClick={() => go("admin")}
            data-testid="nav-admin-button"
          >
            <span><HiCog6Tooth /></span>
            <small>Admin</small>
          </button>
        )}
        {profile?.role === "facilities_staff" && (
          <button
            className={active === "facilities" ? "active" : ""}
            onClick={() => go("facilities")}
            data-testid="nav-facilities-button"
          >
            <span><HiWrenchScrewdriver /></span>
            <small>Tickets</small>
          </button>
        )}
      </nav>

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          notify={notify}
        />
      )}

      {globalSearchOpen && (
        <GlobalSearchOverlay
          onClose={() => setGlobalSearchOpen(false)}
          go={go}
          setSearch={setSearch}
          authUser={authUser}
          openLogin={() => setLoginOpen(true)}
          notify={notify}
        />
      )}

      {modal === "post" && (
        <PostComposer
          onClose={() => setModal(null)}
          onCreate={createPost}
          user={user}
          authUser={authUser}
          notify={notify}
        />
      )}

      {modal === "edit-profile" && profile && (
        <EditProfileModal
          profile={profile}
          onClose={() => setModal(null)}
          onSaved={(next) => { applyProfileUpdate(next); setModal(null); notify("Profile updated"); }}
          notify={notify}
        />
      )}

      {modal === "food-cart" && (
      <CartModal
        title="Food cart"
        cart={foodCart}
        type="food"
        onClose={() => setModal(null)}
        notify={notify}
        onCheckout={checkoutFood}
        onUpdateQuantity={(index, quantity) =>
          setFoodCart((cart) => (quantity <= 0 ? cart.filter((_, i) => i !== index) : cart.map((entry, i) => (i === index ? { ...entry, quantity } : entry))))
        }
        onRemove={(index) => setFoodCart((cart) => cart.filter((_, i) => i !== index))}
      />
      )}

      {modal === "store-cart" && (
        <CartModal
          title="Store cart"
          cart={storeCart}
          type="store"
          onClose={() => setModal(null)}
          notify={notify}
          onCheckout={checkoutStore}
          onUpdateQuantity={(index, quantity) =>
            setStoreCart((cart) => (quantity <= 0 ? cart.filter((_, i) => i !== index) : cart.map((entry, i) => (i === index ? { ...entry, quantity } : entry))))
          }
          onRemove={(index) => setStoreCart((cart) => cart.filter((_, i) => i !== index))}
        />
      )}

      {modal === "print" && (
        <PrintModal
          onClose={() => setModal(null)}
          setPrintFile={setPrintFile}
          notify={notify}
          authUser={authUser}
          user={user}
          campusId={campusId}
        />
      )}

      {modal === "sos" && (
        <SOSModal
          onClose={() => setModal(null)}
          notify={notify}
          authUser={authUser}
          openLogin={() => setLoginOpen(true)}
        />
      )}

      {modal === "navigation" && (
        <NavigationModal onClose={() => setModal(null)} notify={notify} />
      )}

      {toast && (
        <div className="toast">
          <HiCheckCircle />
          {toast}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   HOME
========================================================= */

function Home({
  go,
  search,
  setSearch,
  notify,
  notifications,
  openModal,
  foodCart,
  storeCart,
  authUser,
}) {
  return (
    <>
      <section className="hero-wrap">
        <div className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              THE DIGITAL LAYER FOR CAMPUS LIFE
            </span>

            <h1>
              Everything happening
              <br />
              <span>on your campus.</span>
            </h1>

            <p>
              Connect with students, discover opportunities, access campus
              services and eventually connect the campus to intelligent
              hardware.
            </p>

            <div className="searchbar">
              <span>
                <HiMagnifyingGlass />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events, clubs, services, people..."
              />
              <kbd>⌘ K</kbd>
            </div>

            <div className="hero-links">
              <button onClick={() => go("campus")}>
                Explore Campus <b><HiArrowRight /></b>
              </button>
              <button onClick={() => go("events")}>
                See what&rsquo;s happening <b><HiArrowRight /></b>
              </button>
            </div>
          </div>

          <div className="hero-orbit">
            <div className="orbit-card card-a">
              <HiRocketLaunch />
              <b>Hackathon</b>
              <small>3 teams need members</small>
            </div>
            <div className="orbit-card card-b">
              <HiCalendarDays />
              <b>AI Workshop</b>
              <small>Today · 2:00 PM</small>
            </div>
            <div className="orbit-card card-c">
              <HiUserGroup />
              <b>Help needed</b>
              <small>Block C · 2 replies</small>
            </div>
            <div className="orbit-core">
              <strong>C</strong>
              <span>
                Campus
                <br />
                Pulse
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="section-head">
          <div>
            <span className="section-kicker">YOUR CAMPUS</span>
            <h2>Good evening.</h2>
            <p>Here&rsquo;s what&rsquo;s happening around you.</p>
          </div>
          <button className="text-btn" onClick={() => go("calendar")}>
            My calendar <HiArrowRight />
          </button>
        </div>

        <div className="pulse-grid">
          <PulseCard
            icon={<HiBolt />}
            label="HACKATHON"
            title="Teams are looking for developers"
            meta="Find or start a team"
            onClick={() => go("people")}
          />
          <PulseCard
            icon={<HiCalendarDays />}
            label="EVENT"
            title="Generative AI Workshop"
            meta="Today · Seminar Hall 2"
            onClick={() => go("events")}
          />
          <PulseCard
            icon={<HiWrenchScrewdriver />}
            label="CAMPUS"
            title="8 maintenance requests resolved"
            meta="This week"
            onClick={() => go("services")}
          />
          <PulseCard
            icon={<HiTrophy />}
            label="FOOD"
            title="Udupi has the shortest queue"
            meta="8–12 min · Food Hub"
            onClick={() => go("food")}
          />
        </div>
      </section>

      <section className="page-section">
        <div className="section-head">
          <div>
            <span className="section-kicker">QUICK ACTIONS</span>
            <h2>Get things done.</h2>
          </div>
        </div>

        <div className="action-grid">
          <ActionTile
            icon={<HiPrinter />}
            title="Print"
            text="Upload & collect"
            onClick={() => go("print")}
          />
          <ActionTile
            icon={<HiShoppingCart />}
            title="Food"
            text={`${foodCart.length} items in cart`}
            onClick={() => go("food")}
          />
          <ActionTile
            icon={<HiBookOpen />}
            title="Store"
            text={`${storeCart.length} items in cart`}
            onClick={() => go("store")}
          />
          <ActionTile
            icon={<HiMap />}
            title="Campus Map"
            text="Find a room"
            onClick={() => go("map")}
          />
          <ActionTile
            icon={<HiBuildingOffice2 />}
            title="Book"
            text="Rooms & resources"
            onClick={() => go("booking")}
          />
          <ActionTile
            icon={<HiExclamationTriangle />}
            title="Report"
            text="Campus issue"
            onClick={() => go("issues")}
          />
          <ActionTile
            icon={<HiUserPlus />}
            title="Find People"
            text="Skills & teams"
            onClick={() => go("people")}
          />
          <ActionTile
            icon={<HiUserGroup />}
            title="Connect"
            text="Meet your classmates"
            onClick={() => go("socialize")}
          />
        </div>
      </section>

      {authUser && <RemindersWidget authUser={authUser} notify={notify} />}

      {authUser && <RecommendedForYou authUser={authUser} go={go} notify={notify} />}

      <section className="page-section feature-strip">
        <div>
          <span className="section-kicker">ONE PLATFORM</span>
          <h2>Built around real student needs.</h2>
        </div>

        <div className="feature-row">
          <Feature
            icon={<HiMegaphone />}
            title="Community"
            text="Posts, clubs, help & lost and found"
            onClick={() => go("campus")}
          />
          <Feature
            icon={<HiRocketLaunch />}
            title="Opportunities"
            text="Hackathons, events & team matching"
            onClick={() => go("events")}
          />
          <Feature
            icon={<HiWrenchScrewdriver />}
            title="Services"
            text="Food, print, store, map & booking"
            onClick={() => go("services")}
          />
          <Feature
            icon={<HiUserGroup />}
            title="Connect"
            text="Classmates, branches & achievements"
            onClick={() => go("socialize")}
          />
        </div>
      </section>

      <section className="page-section ai-banner">
        <div>
          <span className="ai-icon">
            <HiSparkles />
          </span>
          <div>
            <span className="section-kicker">CAMPUS AI</span>
            <h2>Your campus, searchable in natural language.</h2>
            <p>
              &ldquo;Find me a Flutter developer.&rdquo; · &ldquo;Where is Lab 204?&rdquo; · &ldquo;What is
              happening tomorrow?&rdquo;
            </p>
          </div>
        </div>

        <button onClick={() => go("ai")}>
          Ask Campus AI <b><HiArrowRight /></b>
        </button>
      </section>

      <section className="page-section autonomous-preview">
        <div className="section-head">
          <div>
            <span className="section-kicker">FUTURE INFRASTRUCTURE</span>
            <h2>Autonomous Campus</h2>
            <p>One digital layer for people, services, AI and future hardware.</p>
          </div>
          <button className="text-btn" onClick={() => go("autonomous")}>
            Explore <HiArrowRight />
          </button>
        </div>

        <div className="device-preview-grid">
          <DeviceMini icon={<HiTruck />} name="Delivery Robots" value="3 online" />
          <DeviceMini icon={<HiPaperAirplane />} name="Autonomous Drones" value="1 standby" />
          <DeviceMini icon={<HiSignal />} name="IoT Network" value="48 devices" />
          <DeviceMini icon={<HiCpuChip />} name="Campus AI" value="Operational" />
        </div>
      </section>
    </>
  );
}

/* =========================================================
   CAMPUS COMMUNITY
========================================================= */

function Campus({
  search,
  setSearch,
  filter,
  setFilter,
  notify,
  posts,
  postsLoading,
  openModal,
  go,
  authUser,
  setLoginOpen,
  savedPostIds = [],
  onToggleSave,
}) {
  const filters = [
    "All",
    "Hackathon",
    "Event",
    "Help Needed",
    "Achievement",
    "Saved",
  ];

  return (
    <section className="page-section campus-page">
      <div className="section-head large">
        <div>
          <span className="section-kicker">COMMUNITY</span>
          <h1>Campus Feed</h1>
          <p>A verified social layer for your entire campus.</p>
        </div>

        <button className="primary" onClick={() => openModal("post")}>
          <HiPlus /> Create post
        </button>
      </div>

      <div className="feed-toolbar">
        <div className="searchbar compact">
          <HiMagnifyingGlass />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campus posts..."
          />
        </div>

        <div className="chips">
          {filters.map((item) => (
            <button
              className={filter === item ? "chip active" : "chip"}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="campus-command-grid">
        <CommandCard
          icon={<HiUserGroup />}
          title="Find People"
          text="Match skills & teams"
          onClick={() => go("people")}
        />
        <CommandCard
          icon={<HiAcademicCap />}
          title="Clubs"
          text="Explore student communities"
          onClick={() => go("clubs")}
        />
        <CommandCard
          icon={<HiUserGroup />}
          title="Connect"
          text="Classmates & achievements"
          onClick={() => go("socialize")}
        />
      </div>

      <div className="feed-layout">
        <div className="feed">
          {postsLoading && <LoadingState label="Loading campus feed…" />}

          {!postsLoading && posts.length === 0 && (
            <EmptyState
              title="No posts yet"
              text="Be the first to share something with your campus."
            />
          )}

          {!postsLoading && posts.map((post) => (
            <Post
              key={post.id}
              post={post}
              notify={notify}
              authUser={authUser}
              setLoginOpen={setLoginOpen}
              saved={savedPostIds.includes(post.id)}
              onToggleSave={onToggleSave}
            />
          ))}
        </div>

        <aside className="side-card">
          <span className="section-kicker">TRENDING</span>
          <h3>Campus topics</h3>

          {[
            "#Hackathon2026",
            "#AIWorkshop",
            "#PlacementPrep",
            "#Robotics",
            "#LostAndFound",
          ].map((item, index) => (
            <button key={item} onClick={() => notify(`${item} selected`)}>
              <b>0{index + 1}</b>
              {item}
              <span><HiArrowRight /></span>
            </button>
          ))}

          <hr />

          <span className="section-kicker">YOUR CAMPUS</span>

          <div className="mini-stat">
            <b>6,000+</b>
            <span>students</span>
          </div>

          <div className="mini-stat">
            <b>20</b>
            <span>active clubs</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

/* =========================================================================
   RECOMMENDED FOR YOU (doc §108 -- dashboard personalization)
   Food/events/clubs/opportunities scored server-side from signals the
   student already gave the app (skills, course/dept/year, club memberships,
   past orders/registrations/applications). "Recommended people" reuses the
   existing "People you may know" feature instead of duplicating it here --
   see the Find Your People page.
========================================================================= */
function RemindersWidget({ authUser, notify }) {
  const [reminders, setReminders] = useState(null); // null = loading

  const reload = () => {
    listMyReminders().then(setReminders).catch(() => setReminders([]));
  };

  useEffect(() => {
    if (!authUser?.id) return;
    reload();
    const unsub = subscribeToReminders(() => reload());
    return () => unsub?.();
  }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!reminders || reminders.length === 0) return null;

  const complete = async (reminder) => {
    setReminders((current) => current.filter((r) => r.id !== reminder.id));
    try {
      await setReminderDone(reminder.id, true);
    } catch (error) {
      notify(error.message || "Could not update that reminder");
      reload();
    }
  };

  const remove = async (reminder) => {
    setReminders((current) => current.filter((r) => r.id !== reminder.id));
    try {
      await deleteReminder(reminder.id);
    } catch (error) {
      notify(error.message || "Could not delete that reminder");
      reload();
    }
  };

  return (
    <section className="page-section reminders-section">
      <div className="section-head">
        <div>
          <span className="section-kicker">REMINDERS</span>
          <h2>Don&apos;t forget.</h2>
          <p>Set manually or by asking Campus AI.</p>
        </div>
      </div>

      <div className="reminders-list">
        {reminders.slice(0, 5).map((r) => {
          const overdue = new Date(r.remind_at) < new Date();
          return (
            <article className={`reminder-row ${overdue ? "overdue" : ""}`} key={r.id}>
              <button className="reminder-check" aria-label="Mark done" onClick={() => complete(r)}>
                <HiCheck />
              </button>
              <div>
                <b>{r.title}</b>
                <small>{new Date(r.remind_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}{r.source === "ai" ? " · via Campus AI" : ""}</small>
                {r.notes && <small>{r.notes}</small>}
              </div>
              <button className="reminder-delete" aria-label="Delete reminder" onClick={() => remove(r)}>
                <HiXMark />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RecommendedForYou({ authUser, go, notify }) {
  const [recs, setRecs] = useState(null); // null = loading
  const [dismissed, setDismissed] = useState(new Set());

  useEffect(() => {
    if (!authUser?.id) return;
    let cancelled = false;
    getAllRecommendations(6)
      .then((data) => { if (!cancelled) setRecs(data); })
      .catch((error) => { console.error("getAllRecommendations failed", error); if (!cancelled) setRecs({ food: [], events: [], clubs: [], opportunities: [] }); });
    return () => { cancelled = true; };
  }, [authUser?.id]);

  const handleDismiss = async (entityType, entityId) => {
    setDismissed((prev) => new Set(prev).add(`${entityType}:${entityId}`));
    try {
      await dismissRecommendation(entityType, entityId);
    } catch (error) {
      notify(error.message || "Could not update recommendations");
    }
  };

  if (!recs) return null;

  const visible = (entityType, items) =>
    (items || []).filter((item) => !dismissed.has(`${entityType}:${item.id}`));

  const foodItems = visible("food_item", recs.food);
  const eventItems = visible("event", recs.events);
  const clubItems = visible("club", recs.clubs);
  const oppItems = visible("opportunity", recs.opportunities);

  if (!foodItems.length && !eventItems.length && !clubItems.length && !oppItems.length) return null;

  return (
    <section className="page-section recommended-section">
      <div className="section-head">
        <div>
          <span className="section-kicker">FOR YOU</span>
          <h2>Recommended for you.</h2>
          <p>Based on your clubs, skills and activity -- not a guess.</p>
        </div>
        <button className="text-btn" onClick={() => go("profile")}>
          Personalization settings <HiArrowRight />
        </button>
      </div>

      <div className="recommend-rows">
        {foodItems.length > 0 && (
          <div className="recommend-row">
            <h4>Food</h4>
            <div className="recommend-cards">
              {foodItems.map((item) => (
                <RecommendCard
                  key={item.id}
                  title={item.name}
                  meta={`₹${item.price} · ${item.canteen_name}`}
                  reason={item.reason}
                  onClick={() => go("food")}
                  onDismiss={() => handleDismiss("food_item", item.id)}
                />
              ))}
            </div>
          </div>
        )}

        {eventItems.length > 0 && (
          <div className="recommend-row">
            <h4>Events</h4>
            <div className="recommend-cards">
              {eventItems.map((item) => (
                <RecommendCard
                  key={item.id}
                  title={item.title}
                  meta={new Date(item.event_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  reason={item.reason}
                  onClick={() => go("events")}
                  onDismiss={() => handleDismiss("event", item.id)}
                />
              ))}
            </div>
          </div>
        )}

        {clubItems.length > 0 && (
          <div className="recommend-row">
            <h4>Clubs</h4>
            <div className="recommend-cards">
              {clubItems.map((item) => (
                <RecommendCard
                  key={item.id}
                  title={item.name}
                  meta={item.category || "Club"}
                  reason={item.reason}
                  onClick={() => go("campus")}
                  onDismiss={() => handleDismiss("club", item.id)}
                />
              ))}
            </div>
          </div>
        )}

        {oppItems.length > 0 && (
          <div className="recommend-row">
            <h4>Opportunities</h4>
            <div className="recommend-cards">
              {oppItems.map((item) => (
                <RecommendCard
                  key={item.id}
                  title={`${item.role} @ ${item.company}`}
                  meta={item.type}
                  reason={item.reason}
                  onClick={() => go("events")}
                  onDismiss={() => handleDismiss("opportunity", item.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function RecommendCard({ title, meta, reason, onClick, onDismiss }) {
  return (
    <div className="recommend-card">
      <button className="recommend-dismiss" title="Not interested" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>
        <HiXMark />
      </button>
      <div onClick={onClick}>
        <b>{title}</b>
        <small>{meta}</small>
        <span className="recommend-reason"><HiSparkles /> {reason}</span>
      </div>
    </div>
  );
}

function Post({ post, notify, authUser, setLoginOpen, saved = false, onToggleSave }) {
  const [likes, setLikes] = useState(post.likes || 0);
  const [liked, setLiked] = useState(post.liked || false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");

  const handleShare = async () => {
    const url = `${window.location.origin}/campus?post=${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, url });
        return;
      } catch {
        return; // user cancelled the native share sheet -- not an error
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copied to clipboard");
    } catch {
      notify(url); // last-resort fallback so the link is still visible
    }
  };

  const handleLike = async () => {
    if (!authUser) {
      setLoginOpen?.();
      notify("Sign in to like posts");
      return;
    }

    try {
      const isLikedNow = await togglePostLike({ postId: post.id, userId: authUser.id });
      setLiked(isLikedNow);
      setLikes((prev) => (isLikedNow ? prev + 1 : Math.max(0, prev - 1)));
    } catch (err) {
      console.error(err);
      notify("Could not toggle like");
    }
  };

  const toggleComments = async () => {
    if (!showComments) {
      try {
        const loaded = await getPostComments(post.id);
        setComments(loaded);
      } catch (err) {
        console.error(err);
      }
    }
    setShowComments(!showComments);
  };

  const handleAddComment = async () => {
    if (!authUser) {
      setLoginOpen?.();
      notify("Sign in to comment");
      return;
    }
    if (!commentText.trim()) return;

    try {
      const added = await addPostComment({
        postId: post.id,
        userId: authUser.id,
        content: commentText,
      });
      setComments((prev) => [
        ...prev,
        {
          id: added.id,
          author: authUser.email?.split("@")[0] || "You",
          content: commentText,
          time: "Just now",
        },
      ]);
      setCommentText("");
      notify("Comment added");
    } catch (err) {
      console.error(err);
      notify("Could not post comment");
    }
  };

  return (
    <article className={`post ${post.accent}`}>
      <div className="post-head">
        <div className="avatar">{post.author ? post.author[0] : "C"}</div>

        <div>
          <b>
            {post.author}{" "}
            {post.verified && <HiShieldCheck className="verified" />}
          </b>
          <small>{post.time}</small>
        </div>

        <button
          onClick={async () => {
            if (!authUser) { setLoginOpen?.(); notify("Sign in to report a post"); return; }
            const reason = window.prompt("Why are you reporting this post? (spam, harassment, etc.)");
            if (!reason?.trim()) return;
            try {
              await reportContent("post", post.id, reason.trim());
              notify("Reported to campus moderators");
            } catch (err) {
              notify(err.message || "Could not report this post");
            }
          }}
          aria-label="Report post"
        >
          <HiEllipsisHorizontal />
        </button>
      </div>

      <div className="post-type">
        <span>{post.icon}</span>
        {post.type}
      </div>

      <h3>{post.title}</h3>

      {post.images?.length > 0 && (
        <div className="post-images" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          {post.images.map((url) => (
            <img key={url} src={url} alt="" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10, objectFit: "cover" }} />
          ))}
        </div>
      )}

      <div className="tags">
        {post.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>

      <div className="post-actions">
        <button onClick={handleLike} className={liked ? "liked" : ""}>
          <HiHeart style={{ color: liked ? "#ef4444" : "inherit" }} /> {likes}
        </button>
        <button onClick={toggleComments}>
          <HiChatBubbleOvalLeft /> {post.comments + comments.length}
        </button>
        <button onClick={handleShare}>
          <HiArrowUpTray /> Share
        </button>
        <button
          onClick={() => {
            if (!authUser) { setLoginOpen?.(); notify("Sign in to save posts"); return; }
            onToggleSave?.(post.id);
          }}
        >
          {saved ? <HiBookmark style={{ color: "#f59e0b" }} /> : <HiOutlineBookmark />} {saved ? "Saved" : "Save"}
        </button>
      </div>

      {showComments && (
        <div className="comments-section" style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          {comments.map((c) => (
            <div key={c.id} style={{ marginBottom: "8px", fontSize: "0.9rem" }}>
              <b>{c.author}: </b>
              <span>{c.content}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              style={{ flex: 1, padding: "6px 12px", borderRadius: "6px" }}
            />
            <button className="primary" onClick={handleAddComment}>
              Post
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/* =========================================================
   PEOPLE / CLUBS
========================================================= */

function People({ notify, people, campusId, authUser, openLogin, onOpenConversation }) {
  const [section, setSection] = useState("people"); // 'people' | 'teams'
  const [q, setQ] = useState("");

  const filtered = people.filter((person) =>
    `${person.name} ${person.skills.join(" ")}`
      .toLowerCase()
      .includes(q.toLowerCase())
  );

  return (
    <section className="page-section">
      <PageHeader
        kicker="NETWORK"
        title="Find Your People"
        text="Discover students based on skills, interests and projects, or start a team and let Campus OS find teammates who match."
        action={
          section === "people" ? (
            <button className="primary" onClick={() => setSection("teams")}>
              <HiUserPlus /> Need a teammate
            </button>
          ) : null
        }
      />

      <div className="chips" style={{ margin: "4px 0 22px", justifyContent: "flex-start" }}>
        <button className={section === "people" ? "chip active" : "chip"} onClick={() => setSection("people")}>People</button>
        <button className={section === "teams" ? "chip active" : "chip"} onClick={() => setSection("teams")}>
          <HiSparkles /> Teams
        </button>
      </div>

      {section === "people" && (
        <>
          <div className="searchbar compact wide-search">
            <HiMagnifyingGlass />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people or skills..."
            />
          </div>

          <div className="people-grid">
            {filtered.map((person) => (
              <PersonCard key={person.id} person={person} notify={notify} authUser={authUser} openLogin={openLogin} onOpenConversation={onOpenConversation} />
            ))}
          </div>
        </>
      )}

      {section === "teams" && (
        <TeamsBoard campusId={campusId} authUser={authUser} notify={notify} openLogin={openLogin} />
      )}
    </section>
  );
}

function PersonCard({ person, notify, authUser, openLogin, onOpenConversation }) {
  const [messaging, setMessaging] = useState(false);

  const messagePerson = async () => {
    if (!authUser) { openLogin?.(); notify("Sign in to send a message"); return; }
    if (person.id === authUser.id) { notify("That's you!"); return; }
    try {
      setMessaging(true);
      const conversationId = await startConversation(person.id);
      onOpenConversation?.(conversationId);
    } catch (error) {
      notify(error.message || "Could not start a conversation");
    } finally {
      setMessaging(false);
    }
  };

  return (
    <article className="person-card">
      <div className="person-top">
        <div className="big-avatar small">{person.name[0]}</div>

        <div>
          <h3>{person.name}</h3>
          <p>
            {person.course} · {person.year}
          </p>
        </div>

        <span className="match">{person.match}%</span>
      </div>

      <div className="skill-list">
        {person.skills.map((skill) => (
          <span key={skill}>{skill}</span>
        ))}
      </div>

      <div className="person-actions">
        <button onClick={() => notify(`Connection request sent to ${person.name}`)}>
          <HiUserPlus /> Connect
        </button>
        <button className="ghost" disabled={messaging} onClick={messagePerson}>
          <HiChatBubbleLeftRight /> {messaging ? "Starting…" : "Message"}
        </button>
      </div>
    </article>
  );
}

function Clubs({ notify, clubs: clubList, authUser, setLoginOpen, campusId }) {
  const [selectedClub, setSelectedClub] = useState(null);
  const [joinedClubs, setJoinedClubs] = useState({});
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [leadership, setLeadership] = useState({});
  const [managingClubId, setManagingClubId] = useState(null);
  const [applications, setApplications] = useState({}); // club_id -> latest application row
  const [applyClub, setApplyClub] = useState(null);

  const reloadApplications = () => {
    if (!authUser?.id) { setApplications({}); return; }
    clubApi.getMyClubApplications(authUser.id).then((rows) => {
      const map = {};
      // Latest first (already ordered by created_at desc) -- keep only the
      // newest application per club so a rejected-then-reapplied history
      // doesn't shadow the fresh pending one.
      (rows || []).forEach((row) => { if (!map[row.club_id]) map[row.club_id] = row; });
      setApplications(map);
    }).catch(() => {});
  };

  useEffect(() => {
    if (!authUser?.id) { setLeadership({}); setApplications({}); return; }
    getMyClubs(authUser.id).then((myClubs) => {
      const map = {};
      (myClubs || []).forEach((item) => {
        map[item.club_id] = true;
      });
      setJoinedClubs(map);
    });
    clubApi.getMyClubLeadership().then((rows) => {
      const map = {};
      (rows || []).forEach((row) => { map[row.club_id] = row.role; });
      setLeadership(map);
    }).catch(() => {});
    reloadApplications();
  }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (managingClubId) {
    return (
      <ClubManage
        clubId={managingClubId}
        campusId={campusId}
        authUser={authUser}
        notify={notify}
        onBack={() => setManagingClubId(null)}
      />
    );
  }

  const handleToggleJoin = async (club) => {
    if (!authUser) {
      setLoginOpen?.();
      notify("Sign in to join clubs");
      return;
    }

    const isJoined = joinedClubs[club.id];
    try {
      if (isJoined) {
        await leaveClub({ clubId: club.id, userId: authUser.id });
        setJoinedClubs((prev) => ({ ...prev, [club.id]: false }));
        notify(`Left ${club.name}`);
        return;
      }

      if (club.recruitment_mode === "closed") {
        notify(`${club.name} isn't accepting new members right now`);
        return;
      }
      if (club.recruitment_mode === "application") {
        setApplyClub(club);
        return;
      }

      await joinClub({ clubId: club.id, userId: authUser.id });
      setJoinedClubs((prev) => ({ ...prev, [club.id]: true }));
      notify(`Joined ${club.name}!`);
    } catch (err) {
      console.error(err);
      notify(err.message || "Club action failed");
    }
  };

  // For an "application"-mode club: what to show instead of a plain
  // Join/Leave toggle, driven by the latest application row (if any).
  const joinButtonFor = (club) => {
    if (joinedClubs[club.id]) return { label: "Leave", action: () => handleToggleJoin(club), className: "ghost" };
    if (club.recruitment_mode === "closed") return { label: "Recruitment closed", disabled: true, className: "ghost" };
    if (club.recruitment_mode === "application") {
      const app = applications[club.id];
      if (app?.status === "pending") {
        return {
          label: "Application pending", className: "ghost",
          action: async () => {
            if (!window.confirm("Withdraw your pending application?")) return;
            try {
              await clubApi.cancelClubApplication(app.id);
              notify("Application withdrawn");
              reloadApplications();
            } catch (err) {
              notify(err.message || "Could not withdraw application");
            }
          },
        };
      }
      return { label: app?.status === "rejected" ? "Apply again" : "Apply to join", action: () => handleToggleJoin(club), className: "primary" };
    }
    return { label: "Join", action: () => handleToggleJoin(club), className: "primary" };
  };

  return (
    <section className="page-section">
      <PageHeader
        kicker="STUDENT COMMUNITIES"
        title="Clubs Hub"
        text="Discover the communities shaping campus life."
        action={
          <button
            className="primary"
            onClick={() => {
              if (!authUser) { setLoginOpen?.(); notify("Sign in to start a club"); return; }
              setRequestModalOpen(true);
            }}
          >
            <HiPlus /> Start a club
          </button>
        }
      />

      <div className="club-grid">
        {clubList.map((club) => {
          const isMember = Boolean(joinedClubs[club.id]);
          return (
            <article className="club-card" key={club.id}>
              <div className="club-icon">
                <HiAcademicCap />
              </div>
              <h3>{club.name}</h3>
              <p>{club.description}</p>

              <div className="club-stats">
                <span>{club.members + (isMember ? 1 : 0)} members</span>
                <span>{club.events} events</span>
              </div>

              <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                <button
                  className="ghost"
                  onClick={() => setSelectedClub(club)}
                >
                  View club <HiArrowRight />
                </button>
                {(() => {
                  const btn = joinButtonFor(club);
                  return (
                    <button className={btn.className} disabled={btn.disabled} onClick={btn.action}>
                      {btn.label}
                    </button>
                  );
                })()}
                {leadership[club.id] && (
                  <button className="primary" onClick={() => setManagingClubId(club.id)}>
                    Manage club
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {selectedClub && (
        <ModalShell
          kicker="CLUB DETAILS"
          title={selectedClub.name}
          onClose={() => setSelectedClub(null)}
        >
          <p>{selectedClub.description}</p>
          <div className="club-stats" style={{ margin: "16px 0" }}>
            <span>Category: {selectedClub.category}</span>
            <span>Members: {selectedClub.members}</span>
          </div>
          {selectedClub.recruitment_mode === "application" && selectedClub.recruitment_message && !joinedClubs[selectedClub.id] && (
            <p style={{ marginBottom: 12 }}>{selectedClub.recruitment_message}</p>
          )}
          {(() => {
            const btn = joinButtonFor(selectedClub);
            return (
              <button
                className="primary wide"
                disabled={btn.disabled}
                onClick={() => {
                  setSelectedClub(null);
                  btn.action();
                }}
              >
                {btn.label}
              </button>
            );
          })()}
        </ModalShell>
      )}

      {applyClub && (
        <ApplyClubModal
          club={applyClub}
          onClose={() => setApplyClub(null)}
          onApplied={() => { setApplyClub(null); reloadApplications(); }}
          notify={notify}
        />
      )}

      {requestModalOpen && (
        <OrgRequestModal
          requestType="club"
          authUser={authUser}
          campusId={campusId}
          onClose={() => setRequestModalOpen(false)}
          notify={notify}
        />
      )}
    </section>
  );
}

// Application-mode clubs (recruitment_mode = 'application') route "Join"
// through here instead of an instant insert -- a leader has to approve it
// (see ApplicationsTab in features/clubs/ClubManage.jsx).
function ApplyClubModal({ club, onClose, onApplied, notify }) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <ModalShell kicker="CLUB APPLICATION" title={`Apply to join ${club.name}`} onClose={onClose}>
      {club.recruitment_message && <p style={{ marginBottom: 12 }}>{club.recruitment_message}</p>}
      <label>Why do you want to join? (optional)
        <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell the club a bit about yourself…" />
      </label>
      <button
        className="primary wide"
        disabled={submitting}
        onClick={async () => {
          try {
            setSubmitting(true);
            await clubApi.applyToClub(club.id, message);
            notify("Application sent — a club leader will review it");
            onApplied();
          } catch (err) {
            notify(err.message || "Could not submit application");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Submitting…" : "Submit application"}
      </button>
    </ModalShell>
  );
}

// Shared intake form for both "start a club" (Clubs Hub) and "apply to
// become a vendor" (Profile) -- neither can self-serve past a request:
// club approval creates the real club server-side via approve_org_request();
// vendor approval can't create a Supabase Auth account from client code
// (needs the service_role key), so it's an admin sign-off that a campus
// admin then acts on with scripts/setup-vendor-accounts.mjs.
function OrgRequestModal({ requestType, authUser, campusId, onClose, notify }) {
  const [form, setForm] = useState({ name: "", description: "", category: "", contactPhone: "" });
  const [submitting, setSubmitting] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isVendor = requestType === "vendor";

  return (
    <ModalShell
      kicker={isVendor ? "VENDOR APPLICATION" : "NEW CLUB"}
      title={isVendor ? "Apply to become a campus vendor" : "Start a new club"}
      onClose={onClose}
    >
      {isVendor && (
        <p>
          A campus admin reviews every application. Approval means your
          request is accepted — a vendor account still has to be set up for
          you by an admin as a separate step.
        </p>
      )}
      <label>{isVendor ? "Business name" : "Club name"}<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>{isVendor ? "What will you sell?" : "What's this club about?"}<textarea value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>{isVendor ? "Category (canteen, print, etc.)" : "Category"}<input value={form.category} onChange={(e) => change("category", e.target.value)} /></label>
      {isVendor && <label>Contact phone<input value={form.contactPhone} onChange={(e) => change("contactPhone", e.target.value)} /></label>}
      <button
        className="primary wide"
        disabled={submitting || !form.name.trim() || !form.description.trim()}
        onClick={async () => {
          try {
            setSubmitting(true);
            await submitOrgRequest({
              userId: authUser.id,
              campusId,
              requestType,
              name: form.name,
              description: form.description,
              category: form.category,
              contactPhone: form.contactPhone,
            });
            notify("Request submitted — a campus admin will review it");
            onClose();
          } catch (error) {
            notify(error.message || "Could not submit request");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Submitting…" : "Submit request"}
      </button>
    </ModalShell>
  );
}

/* =========================================================
   EVENTS
========================================================= */

function Events({
  notify,
  events,
  eventsLoading,
  opportunities: opps,
  mentors: mentorList,
  appliedIds = [],
  onApplied,
  authUser,
  profile,
  openLogin,
  registeredIds = [],
  savedIds = [],
  onRegistrationChange,
  onSavedChange,
  onProfileUpdated,
}) {
  const [confirmingEvent, setConfirmingEvent] = useState(null);
  const [applyingTo, setApplyingTo] = useState(null);
  const [requestingMentor, setRequestingMentor] = useState(null);

  return (
    <section className="page-section events-page">
      <PageHeader
        kicker="DISCOVER"
        title="Events & Opportunities"
        text="Everything happening across campus, in one calendar."
        action={
          <button
            className="primary"
            onClick={() => notify("Event creation opened — demo mode")}
          >
            <HiPlus /> Create event
          </button>
        }
      />

      <div className="event-grid">
        {eventsLoading && <LoadingState label="Loading events…" />}

        {!eventsLoading && events.length === 0 && (
          <EmptyState title="No events yet" text="Check back soon — clubs are still planning." />
        )}

        {!eventsLoading && events.map((event) => (
          <article className="event-card" key={event.id}>
            <div className={`date-box ${event.color}`}>
              <b>{event.date}</b>
              <span>{event.month}</span>
            </div>

            <div className="event-content">
              <span className="event-club">{event.club}</span>
              <h3>{event.title}</h3>

              <p>
                <HiClock /> {event.time} <span>·</span>{" "}
                <HiMapPin /> {event.place}
              </p>

              <div>
                <button
                  onClick={async () => {

                    try {

                      if (!authUser) {
                        openLogin();

                        notify(
                          "Sign in to register"
                        );

                        return;
                      }

                      if (registeredIds.includes(event.id)) {
                        await cancelEventRegistration({ eventId: event.id });
                        onRegistrationChange?.((ids) => ids.filter((id) => id !== event.id));
                        notify(`${event.title}: registration cancelled`);
                        return;
                      }

                      // Registering opens a confirmation dialog (name/USN/
                      // email prefilled from the profile, phone entered
                      // there) instead of registering immediately.
                      setConfirmingEvent(event);

                    } catch (error) {

                      console.error(
                        "Event registration:",
                        error
                      );

                      notify(
                        error.message ||
                        "Registration failed"
                      );
                    }
                  }}
                                  >
                  {registeredIds.includes(event.id) ? "Cancel registration" : "Register"}
                </button>

                <button
                  className="ghost"
                  onClick={async () => {
                    if (!authUser) { openLogin(); notify("Sign in to save events"); return; }
                    try {
                      const saved = await toggleSavedEvent({ eventId: event.id, userId: authUser.id });
                      onSavedChange?.((ids) => saved ? [...ids, event.id] : ids.filter((id) => id !== event.id));
                      notify(saved ? "Event saved" : "Event removed from saved");
                    } catch (error) { notify(error.message || "Could not save event"); }
                  }}
                >
                  <HiHeart /> {savedIds.includes(event.id) ? "Saved" : "Save"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="section-head inner-head">
        <div>
          <span className="section-kicker">OPPORTUNITIES</span>
          <h2>Build beyond the classroom.</h2>
        </div>
      </div>

      <div className="opportunity-grid">
        {opps.length === 0 && (
          <EmptyState icon={<HiBriefcase />} title="No opportunities posted yet" text="Check back soon — admins post internships and research openings here." />
        )}
        {opps.map((item) => {
          const applied = appliedIds.includes(item.id);
          return (
            <article className="opportunity-card" key={item.id}>
              <div className="company-avatar">
                <HiBriefcase />
              </div>
              <div>
                <h3>{item.role}</h3>
                <p>{item.company} · {item.type}</p>
              </div>
              <span className="deadline">{item.deadline ? new Date(item.deadline).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "Open"}</span>
              <button
                disabled={applied}
                onClick={() => {
                  if (applied) return;
                  if (item.apply_url) { window.open(item.apply_url, "_blank", "noreferrer"); return; }
                  if (!authUser) { openLogin(); notify("Sign in to apply"); return; }
                  setApplyingTo(item);
                }}
              >
                {applied ? "Applied" : item.apply_url ? "Apply externally" : "Apply"} <HiArrowRight />
              </button>
            </article>
          );
        })}
      </div>

      <div className="section-head inner-head">
        <div>
          <span className="section-kicker">MENTORS</span>
          <h2>People who can accelerate your project.</h2>
        </div>
      </div>

      <div className="mentor-grid">
        {mentorList.length === 0 && (
          <EmptyState icon={<HiUserGroup />} title="No mentors listed yet" text="Check back soon — admins curate this list." />
        )}
        {mentorList.map((mentor) => (
          <article className="mentor-card" key={mentor.id}>
            <div className="big-avatar small">{mentor.name[0]}</div>
            <div>
              <h3>{mentor.name}</h3>
              <p>{mentor.role}</p>
              <small>{(mentor.skills || []).join(" · ")}</small>
            </div>
            <button onClick={() => {
              if (!authUser) { openLogin(); notify("Sign in to request mentorship"); return; }
              setRequestingMentor(mentor);
            }}>
              <HiChatBubbleLeftRight />
            </button>
          </article>
        ))}
      </div>

      {applyingTo && (
        <OpportunityApplyModal
          opportunity={applyingTo}
          onClose={() => setApplyingTo(null)}
          onApplied={() => { onApplied?.(applyingTo.id); setApplyingTo(null); }}
          notify={notify}
        />
      )}

      {requestingMentor && (
        <MentorRequestModal
          mentor={requestingMentor}
          onClose={() => setRequestingMentor(null)}
          notify={notify}
        />
      )}

      {confirmingEvent && (
        <EventRegistrationConfirmModal
          event={confirmingEvent}
          profile={profile}
          authUser={authUser}
          onClose={() => setConfirmingEvent(null)}
          onProfileUpdated={onProfileUpdated}
          onConfirmed={(result) => {
            if (result?.status === "waitlisted") {
              notify(`${confirmingEvent.title}: event is full — you're #${result.position} on the waitlist`);
            } else {
              onRegistrationChange?.((ids) => [...ids, confirmingEvent.id]);
              notify(`${confirmingEvent.title}: registration confirmed`);
            }
            setConfirmingEvent(null);
          }}
        />
      )}
    </section>
  );
}

function OpportunityApplyModal({ opportunity, onClose, onApplied, notify }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <ModalShell kicker="APPLY" title={`${opportunity.role} at ${opportunity.company}`} onClose={onClose}>
      {opportunity.description && <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>{opportunity.description}</p>}
      {opportunity.tags?.length > 0 && (
        <div className="tags" style={{ marginBottom: 14 }}>
          {opportunity.tags.map((t) => <span key={t}>{t}</span>)}
        </div>
      )}
      <label>A short note to the poster (optional)
        <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Why you're a good fit…" />
      </label>
      <button
        className="primary wide"
        disabled={saving}
        onClick={async () => {
          try {
            setSaving(true);
            await applyToOpportunity(opportunity.id, message);
            notify("Application submitted");
            onApplied();
          } catch (error) {
            notify(error.message || "Could not submit application");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Submitting…" : "Submit application"}
      </button>
    </ModalShell>
  );
}

function MentorRequestModal({ mentor, onClose, notify }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <ModalShell kicker="MENTORSHIP" title={`Request ${mentor.name}`} onClose={onClose}>
      {mentor.bio && <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>{mentor.bio}</p>}
      <label>What do you need help with? (optional)
        <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A quick note helps them respond faster…" />
      </label>
      <button
        className="primary wide"
        disabled={saving}
        onClick={async () => {
          try {
            setSaving(true);
            await requestMentor(mentor.id, message);
            notify(`Request sent to ${mentor.name}`);
            onClose();
          } catch (error) {
            notify(error.message || "Could not send request");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Sending…" : "Send request"}
      </button>
    </ModalShell>
  );
}

// Secondary confirmation dialog shown when "Register" is clicked. Name is
// editable (a preferred name for this registration); USN/email stay
// read-only, sourced from the signed-in profile server-side (unspoofable).
// Phone/roll number/department are entered here and, once submitted,
// remembered on the profile so they're prefilled again next time.
function EventRegistrationConfirmModal({ event, profile, authUser, onClose, onConfirmed, onProfileUpdated }) {
  const [name, setName] = useState(profile?.name || authUser?.user_metadata?.name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [rollNumber, setRollNumber] = useState(profile?.roll_number || "");
  const [department, setDepartment] = useState(profile?.department || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const usn = profile?.usn || authUser?.user_metadata?.usn || "";
  const email = profile?.email || authUser?.email || "";

  const handleConfirm = async () => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedName) {
      setError("Enter a name.");
      return;
    }
    if (!isValidPhone(trimmedPhone)) {
      setError("Enter a valid phone number (7-15 digits).");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      const result = await registerEvent({
        eventId: event.id,
        userId: authUser.id,
        contactPhone: trimmedPhone,
        contactName: trimmedName,
        rollNumber,
        department,
      });

      if (profile) {
        const next = { ...profile, phone: trimmedPhone };
        if (rollNumber.trim()) next.roll_number = rollNumber.trim();
        if (department.trim()) next.department = department.trim();
        onProfileUpdated?.(next);
      }

      onConfirmed(result);
    } catch (err) {
      console.error("Event registration:", err);
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell kicker="CONFIRM REGISTRATION" title={event.title} onClose={onClose}>
      <p className="modal-subtext">
        Review your details before we confirm your spot.
      </p>

      <div className="form-grid">
        <label>
          Name
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError("");
            }}
          />
        </label>
        <label>
          USN
          <input value={usn} disabled readOnly />
        </label>
      </div>

      <label>
        Email
        <input value={email} disabled readOnly />
      </label>

      <div className="form-grid">
        <label>
          Phone number
          <input
            type="tel"
            value={phone}
            placeholder="e.g. 9876543210"
            onChange={(e) => {
              setPhone(e.target.value);
              if (error) setError("");
            }}
          />
        </label>
        <label>
          Roll number
          <input
            value={rollNumber}
            placeholder="Optional"
            onChange={(e) => setRollNumber(e.target.value)}
          />
        </label>
      </div>

      <label>
        Department
        <input
          value={department}
          placeholder="Optional — e.g. Computer Science & Engineering"
          onChange={(e) => setDepartment(e.target.value)}
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <button className="primary wide" disabled={submitting} onClick={handleConfirm}>
        {submitting ? "Confirming…" : "Confirm registration"}
      </button>
    </ModalShell>
  );
}

/* =========================================================
   SERVICES
========================================================= */

function Services({ go, notify, foodCart, storeCart, printFile, openModal }) {
  return (
    <section className="page-section services-page">
      <PageHeader
        kicker="CAMPUS SERVICES"
        title="Get things done."
        text="Everyday services, without the queue."
      />

      <div className="service-grid">
        {services.map((service) => (
          <button
            className="service-card"
            key={service.id}
            onClick={() => go(service.id)}
          >
            <span className="service-icon">{service.icon}</span>
            <div>
              <h3>{service.title}</h3>
              <p>{service.text}</p>
            </div>
            <span className="service-arrow">
              {service.action} <HiArrowRight />
            </span>
          </button>
        ))}
      </div>

      <div className="service-dashboard">
        <div className="service-dash-card">
          <span className="section-kicker">PRINT HUB</span>
          <h2>Upload. Pay. Pick up.</h2>
          <p>
            {printFile
              ? `Selected: ${printFile}`
              : "Send your project report before you reach the print shop."}
          </p>

          <div className="steps">
            <span><b>1</b> Upload</span>
            <span><b>2</b> Configure</span>
            <span><b>3</b> Pay</span>
            <span><b>4</b> QR Pickup</span>
          </div>

          <button onClick={() => go("print")}>
            Open Print Hub <HiArrowRight />
          </button>
        </div>

        <div className="service-dash-card">
          <span className="section-kicker">FOOD HUB</span>
          <h2>Four canteens. One checkout.</h2>
          <p>
            Udupi, Tango, Munch and Nescafe are now searchable from the same
            campus interface.
          </p>

          <div className="mini-canteens">
            {canteens.map((canteen) => (
              <div key={canteen.id}>
                <b>{canteen.name}</b>
                <small>{canteen.eta} · {canteen.status}</small>
              </div>
            ))}
          </div>

          <button onClick={() => go("food")}>
            Open Food Hub <HiArrowRight />
          </button>
        </div>
      </div>

      <div className="service-footer-grid">
        <MiniService
          icon={<HiShoppingCart />}
          title="Stationery"
          text={`${storeCart.length} items in cart`}
          onClick={() => go("store")}
        />
        <MiniService
          icon={<HiMap />}
          title="Campus Map"
          text="Find rooms & facilities"
          onClick={() => go("map")}
        />
        <MiniService
          icon={<HiExclamationTriangle />}
          title="Emergency"
          text="Campus SOS"
          onClick={() => openModal?.("sos")}
        />
        <MiniService
          icon={<HiTruck />}
          title="Delivery"
          text="Move items around campus"
          onClick={() => go("delivery")}
        />
      </div>
    </section>
  );
}

function MiniService({ icon, title, text, onClick }) {
  return (
    <button className="mini-service" onClick={onClick}>
      <span>{icon}</span>
      <div>
        <b>{title}</b>
        <small>{text}</small>
      </div>
      <HiArrowRight />
    </button>
  );
}

/* =========================================================
   FOOD HUB
========================================================= */

/* =========================================================
   FOOD HUB — TRADITIONAL CAMPUS MENU
========================================================= */

/* =========================================================
   FOOD HUB
========================================================= */

function Food({ canteens: vendorList, items, cart, addFood, openModal, loading, error }) {
  const [selectedCanteen, setSelectedCanteen] = useState("All");
  const [q, setQ] = useState("");
  const [dietFilters, setDietFilters] = useState(() => new Set());

  const dietaryOptions = useMemo(() => {
    const tags = new Set(["Vegetarian"]);
    items.forEach((item) => (item.dietaryTags || []).forEach((t) => tags.add(t)));
    return [...tags];
  }, [items]);

  const toggleDietFilter = (tag) => {
    setDietFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  if (loading) {
    return (
      <section className="page-section food-page">
        <LoadingState label="Loading today's menu…" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="page-section food-page">
        <ErrorState title="Couldn't load the food menu" text={error} onRetry={() => window.location.reload()} />
      </section>
    );
  }

  /* Filter food by selected canteen + search */
  const filtered = items.filter((item) => {
    const matchesCanteen =
      selectedCanteen === "All" ||
      item.category.toLowerCase() === selectedCanteen.toLowerCase();

    const matchesSearch =
      `${item.name} ${item.category} ${item.description || ""}`
        .toLowerCase()
        .includes(q.toLowerCase());

    const matchesDiet = [...dietFilters].every((tag) =>
      tag === "Vegetarian" ? item.vegetarian : (item.dietaryTags || []).includes(tag)
    );

    return matchesCanteen && matchesSearch && matchesDiet;
  });

  const total = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );
  const itemCount = cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  return (
    <section className="page-section food-page">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <PageHeader
        kicker="CAMPUS FOOD"
        title="Food Hub"
        text="Four canteens, one campus checkout."
        action={
          <button
            className="primary"
            onClick={() => openModal("food-cart")}
          >
            <HiShoppingCart />
            Cart ({itemCount})
          </button>
        }
      />


      {/* =====================================================
          CANTEEN TOGGLE
      ===================================================== */}

      <div className="food-canteen-toggle">

        <button
          className={`canteen-toggle-btn ${
            selectedCanteen === "All" ? "active" : ""
          }`}
          onClick={() => setSelectedCanteen("All")}
        >
          <span className="canteen-toggle-icon">
            <HiShoppingBag />
          </span>

          <span className="canteen-toggle-info">
            <b>All</b>
            <small>All canteens</small>
          </span>
        </button>


        {vendorList.map((canteen) => (
          <button
            key={canteen.id}
            className={`canteen-toggle-btn ${
              selectedCanteen === canteen.name ? "active" : ""
            }`}
            onClick={() => setSelectedCanteen(canteen.name)}
          >

            <span className={`canteen-toggle-icon ${canteen.color}`}>
              {canteen.name === "Udupi" && <HiHome />}
              {canteen.name === "Tango" && <HiFire />}
              {canteen.name === "Munch" && <HiShoppingBag />}
              {canteen.name === "Nescafe" && <HiBolt />}
            </span>

            <span className="canteen-toggle-info">
              <b>{canteen.name}</b>
              <small>{canteen.subtitle}</small>
            </span>

            <span className="canteen-toggle-status">
              <i className={canteen.color}></i>
              {canteen.eta}
            </span>

          </button>
        ))}

      </div>


      {/* =====================================================
          ACTIVE CANTEEN INFORMATION
      ===================================================== */}

      {selectedCanteen !== "All" && (
        <div className="active-canteen-banner">

          <div className="active-canteen-left">

            <span className="active-canteen-icon">
              <HiShoppingBag />
            </span>

            <div>
              <span className="section-kicker">
                SELECTED CANTEEN
              </span>

              <h3>
                {selectedCanteen}
              </h3>

              <p>
                {
                  vendorList.find(
                    (canteen) =>
                      canteen.name === selectedCanteen
                  )?.subtitle
                }
              </p>
            </div>

          </div>


          <div className="active-canteen-right">

            <span>
              <i></i>

              {
                vendorList.find(
                  (canteen) =>
                    canteen.name === selectedCanteen
                )?.status
              }
            </span>

            {!isCanteenOpenNow(vendorList.find((canteen) => canteen.name === selectedCanteen)) && (
              <span className="listing-tag" style={{ fontWeight: 800 }}>Closed now</span>
            )}

            <b>
              {
                vendorList.find(
                  (canteen) =>
                    canteen.name === selectedCanteen
                )?.eta
              }
            </b>

          </div>

        </div>
      )}


      {/* =====================================================
          SEARCH
      ===================================================== */}

      <div className="searchbar compact wide-search">

        <HiMagnifyingGlass />

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search dosa, biryani, Maggi, coffee..."
        />

        {q && (
          <button
            className="search-clear"
            onClick={() => setQ("")}
          >
            <HiXMark />
          </button>
        )}

      </div>


      {/* =====================================================
          DIETARY FILTERS
      ===================================================== */}

      <div className="socialize-filter-row" style={{ marginTop: 12 }}>
        {dietaryOptions.map((tag) => (
          <button
            key={tag}
            className={dietFilters.has(tag) ? "chip active" : "chip"}
            onClick={() => toggleDietFilter(tag)}
          >
            {tag}
          </button>
        ))}
      </div>


      {/* =====================================================
          MENU TITLE
      ===================================================== */}

      <div className="food-menu-heading">

        <div>
          <span className="section-kicker">
            {selectedCanteen === "All"
              ? "CAMPUS MENU"
              : `${selectedCanteen.toUpperCase()} MENU`}
          </span>

          <h2>
            {selectedCanteen === "All"
              ? "Today's Menu"
              : `${selectedCanteen} Menu`}
          </h2>

          <p>
            {filtered.length} items available
          </p>
        </div>

        <div className="food-menu-count">
          {filtered.length}
          <small>items</small>
        </div>

      </div>


      {/* =====================================================
          MENU
      ===================================================== */}

      <div className="product-grid food-product-grid">

        {filtered.length === 0 && (
          <EmptyState
            title="No items match"
            text={q ? `Nothing matched "${q}" in ${selectedCanteen === "All" ? "any canteen" : selectedCanteen}.` : "This canteen has nothing available right now."}
          />
        )}

        {filtered.map((item) => (
          <FoodCard
            key={item.id}
            item={item}
            add={addFood}
          />
        ))}

      </div>


      {/* =====================================================
          EMPTY RESULT
      ===================================================== */}

      {filtered.length === 0 && (
        <div className="empty-food-results">

          <HiMagnifyingGlassCircle />

          <h3>No food found</h3>

          <p>
            Try another dish or switch to a different canteen.
          </p>

          <button
            className="ghost"
            onClick={() => {
              setSelectedCanteen("All");
              setQ("");
            }}
          >
            Show all food
          </button>

        </div>
      )}


      {/* =====================================================
          FLOATING CART
      ===================================================== */}

      {cart.length > 0 && (

        <div className="floating-cart">

          <div>

            <HiShoppingCart />

            <b>
              {cart.length} items
            </b>

            <span>
              ₹{total}
            </span>

          </div>

          <button
            onClick={() => openModal("food-cart")}
          >
            Checkout
            <HiArrowRight />
          </button>

        </div>

      )}

    </section>
  );
}


/* =========================================================
   TRADITIONAL FOOD MENU ITEM
========================================================= */

function TraditionalFoodItem({ item, add }) {

  return (

    <article className="traditional-food-item">

      {/* SMALL FOOD IMAGE */}

      <div className="traditional-food-image">

        <img
          src={item.image}
          alt={item.name}
          loading="lazy"
        />

      </div>


      {/* FOOD INFORMATION */}

      <div className="traditional-food-info">

        <div className="traditional-food-title-row">

          <div className="traditional-food-name">

            <span
              className={`veg-indicator ${
                item.veg ? "veg" : "non-veg"
              }`}
            />

            <h3>
              {item.name}
            </h3>

          </div>

          <span className="traditional-food-price">
            ₹{item.price}
          </span>

        </div>


        <p>
          {item.description ||
            `${item.category} from ${item.vendor}`}
        </p>


        <div className="traditional-food-meta">

          <span>
            {item.category}
          </span>

          <button
            onClick={() => add(item)}
            className="traditional-add-button"
          >
            <HiPlus />
            Add
          </button>

        </div>

      </div>

    </article>

  );
}
/* =========================================================
   FOOD CARD
========================================================= */

// Variants (a single price-affecting choice, e.g. Half/Full) use the same
// inline <select> pattern StoreProductCard already established. Add-ons
// (grouped, multi-select modifiers, e.g. "Toppings"/"Spice level") get an
// expandable inline panel instead -- there can be several groups with their
// own min/max, which doesn't fit a single dropdown. Each card owns its own
// selection state so configuring one card never affects another.
function FoodCard({ item, add }) {
  const variants = item.variants || [];
  const hasVariants = variants.length > 0;
  const [variantId, setVariantId] = useState(hasVariants ? variants[0].id : null);
  const selectedVariant = hasVariants ? variants.find((v) => v.id === variantId) || variants[0] : null;

  const addonGroups = item.addonGroups || [];
  const hasAddons = addonGroups.length > 0;
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState(() => new Set());

  const toggleAddon = (group, optionId) => {
    setSelectedAddons((prev) => {
      const next = new Set(prev);
      const groupOptionIds = group.options.map((o) => o.id);
      if (group.maxSelect === 1) {
        // Radio-style: clear any other selection from this same group first.
        groupOptionIds.forEach((id) => next.delete(id));
        next.add(optionId);
        return next;
      }
      if (next.has(optionId)) {
        next.delete(optionId);
        return next;
      }
      const currentInGroup = groupOptionIds.filter((id) => next.has(id)).length;
      if (currentInGroup >= group.maxSelect) return prev; // at the cap, ignore
      next.add(optionId);
      return next;
    });
  };

  const addonIds = [...selectedAddons];
  const addonPriceTotal = addonGroups
    .flatMap((g) => g.options)
    .filter((o) => selectedAddons.has(o.id))
    .reduce((sum, o) => sum + o.priceDelta, 0);
  const unmetRequiredGroup = addonGroups.find(
    (g) => g.minSelect > 0 && g.options.filter((o) => selectedAddons.has(o.id)).length < g.minSelect
  );

  const availableNow = isFoodItemAvailableNow(item);
  const basePrice = selectedVariant ? selectedVariant.price : item.price;
  const totalPrice = basePrice + addonPriceTotal;
  const canAdd = availableNow && (!hasVariants || (selectedVariant && selectedVariant.available)) && !unmetRequiredGroup;

  const handleAdd = () => {
    const variantSuffix = hasVariants ? ` (${selectedVariant.name})` : "";
    const addonNames = addonGroups
      .flatMap((g) => g.options)
      .filter((o) => selectedAddons.has(o.id))
      .map((o) => o.name);
    add({
      id: item.id,
      name: `${item.name}${variantSuffix}`,
      price: totalPrice,
      category: item.category,
      canteenId: item.canteenId,
      vendor: item.vendor,
      variantId: hasVariants ? selectedVariant.id : undefined,
      addonOptionIds: addonIds.length ? addonIds : undefined,
      addonKey: addonSelectionKey(addonIds),
      addonSummary: addonNames.length ? addonNames.join(", ") : undefined,
    });
    setCustomizeOpen(false);
  };

  return (
    <article className="product-card food-card">

      <div className="food-image-wrap">
        <img
          src={item.image}
          alt={item.name}
          loading="lazy"
        />
      </div>

      <div className="food-card-content">

        <div className="food-card-category">
          {item.category}
          {!availableNow && <span className="listing-tag" style={{ marginLeft: 8 }}>Not served now</span>}
        </div>

        <h3>{item.name}</h3>

        <p>
          {item.description || "Freshly prepared on campus."}
        </p>

        {(item.dietaryTags?.length > 0 || item.spiceLevel || item.calories != null) && (
          <div className="food-card-dietary" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {item.dietaryTags.map((tag) => (
              <span key={tag} className="listing-tag">{tag}</span>
            ))}
            {item.spiceLevel && <span className="listing-tag">{item.spiceLevel} spice</span>}
            {item.calories != null && <span className="listing-tag">{item.calories} cal</span>}
          </div>
        )}
        {item.allergens?.length > 0 && (
          <small style={{ display: "block", marginBottom: 8, opacity: 0.75 }}>
            Contains: {item.allergens.join(", ")}
          </small>
        )}

        {hasVariants && (
          <select value={selectedVariant.id} onChange={(e) => setVariantId(e.target.value)} style={{ marginBottom: 8, width: "100%" }}>
            {variants.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.available}>
                {v.name} · ₹{v.price}{!v.available ? " · unavailable" : ""}
              </option>
            ))}
          </select>
        )}

        {hasAddons && (
          <div style={{ marginBottom: 8 }}>
            <button className="ghost" style={{ width: "100%" }} onClick={() => setCustomizeOpen((v) => !v)}>
              {customizeOpen ? "Hide customization" : "Customize"} {addonIds.length > 0 ? `(${addonIds.length} selected)` : ""}
            </button>
            {customizeOpen && (
              <div className="food-addon-panel" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                {addonGroups.map((group) => (
                  <div key={group.id}>
                    <small>
                      <b>{group.name}</b>
                      {" "}
                      {group.minSelect > 0 ? `(choose ${group.minSelect === group.maxSelect ? group.minSelect : `${group.minSelect}-${group.maxSelect}`})` : `(choose up to ${group.maxSelect})`}
                    </small>
                    {group.options.map((o) => (
                      <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                        <input
                          type={group.maxSelect === 1 ? "radio" : "checkbox"}
                          name={`addon-group-${group.id}`}
                          disabled={!o.available}
                          checked={selectedAddons.has(o.id)}
                          onChange={() => toggleAddon(group, o.id)}
                        />
                        {o.name}{o.priceDelta > 0 ? ` (+₹${o.priceDelta})` : ""}{!o.available ? " · unavailable" : ""}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="product-bottom">

          <b>₹{totalPrice}</b>

          <button
            disabled={!canAdd}
            onClick={handleAdd}
          >
            <HiPlus />
            {!availableNow ? "Not served now" : unmetRequiredGroup ? `Pick ${unmetRequiredGroup.name}` : "Add"}
          </button>

        </div>

      </div>

    </article>
  );
}

/* =========================================================
   STORE
========================================================= */

function Store({ items, loading, cart, addStore, openModal, orders = [] }) {
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(items.map((item) => item.category).filter(Boolean)))],
    [items]
  );

  const filtered = items.filter((item) => {
    if (categoryFilter !== "All" && item.category !== categoryFilter) return false;
    return `${item.name} ${item.category} ${item.storeName || ""}`.toLowerCase().includes(q.toLowerCase());
  });

  const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);
  const activeOrders = orders.filter((o) => !["COMPLETED", "CANCELLED"].includes(o.status));

  return (
    <section className="page-section">
      <PageHeader
        kicker="CAMPUS STORE"
        title="Stationery & Supplies"
        text="Everything you need for classes and projects."
        action={
          <button className="primary" onClick={() => openModal("store-cart")}>
            <HiShoppingCart /> Cart ({cart.length})
          </button>
        }
      />

      {activeOrders.length > 0 && (
        <div className="resource-list" style={{ marginBottom: 24 }}>
          {activeOrders.map((order) => (
            <article className="resource-row" key={order.id}>
              <div>
                <b>Order #{order.id.slice(0, 8)} · {order.status}</b>
                <small>
                  {order.stores?.name} · {order.store_order_items.map((i) => `${i.quantity}× ${i.item_name}`).join(", ")}
                </small>
              </div>
              <span className="listing-tag" style={{ fontWeight: 800 }}>Pickup code: {order.pickup_code}</span>
            </article>
          ))}
        </div>
      )}

      <div className="searchbar compact wide-search">
        <HiMagnifyingGlass />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stationery, books, records..."
        />
      </div>

      <div className="category-row">
        {categories.map((category) => (
          <button
            key={category}
            className={category === categoryFilter ? "active" : undefined}
            onClick={() => setCategoryFilter(category)}
          >
            {category}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading the campus store…" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<HiBookOpen />} title="Nothing here yet" text="No store items match your search." />
      ) : (
        <div className="product-grid">
          {filtered.map((item) => (
            <StoreProductCard key={item.id} item={item} addStore={addStore} />
          ))}
        </div>
      )}

      {cart.length > 0 && (
        <div className="floating-cart">
          <div>
            <HiShoppingCart />
            <b>{cart.length} items</b>
            <span>₹{total}</span>
          </div>
          <button onClick={() => openModal("store-cart")}>
            Checkout <HiArrowRight />
          </button>
        </div>
      )}

      <div className="store-banner">
        <div>
          <span className="section-kicker">QUICK PICKUP</span>
          <h2>Order before class. Collect between lectures.</h2>
          <p>Get a QR pickup code when your order is ready.</p>
        </div>
        <HiQrCode />
      </div>
    </section>
  );
}

// A store item may have zero or more product variants (size/colour/etc,
// supabase/migrations/20260815000900_..._variants_stock_analytics.sql).
// Each card owns its own selection state so choosing a variant on one
// product never affects any other card in the grid. Variant price/
// availability come from the selected variant row, not the parent item,
// once any variant exists.
function StoreProductCard({ item, addStore }) {
  const variants = useMemo(
    () => (item.store_item_variants || []).filter((v) => v.active).sort((a, b) => a.name.localeCompare(b.name)),
    [item.store_item_variants]
  );
  const hasVariants = variants.length > 0;
  const [variantId, setVariantId] = useState(hasVariants ? variants[0].id : null);
  const selectedVariant = hasVariants ? variants.find((v) => v.id === variantId) || variants[0] : null;
  const price = selectedVariant ? selectedVariant.price : item.price;
  const canAdd = !hasVariants || (selectedVariant && selectedVariant.available);

  return (
    <article className="product-card">
      <div className="product-placeholder">
        {item.image_url ? <img src={item.image_url} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <HiBookOpen />}
      </div>
      <span className="event-club">{item.category}</span>
      <h3>{item.name}</h3>
      <p>{item.storeName}</p>

      {hasVariants && (
        <select value={selectedVariant.id} onChange={(e) => setVariantId(e.target.value)} style={{ marginBottom: 8, width: "100%" }}>
          {variants.map((v) => (
            <option key={v.id} value={v.id} disabled={!v.available}>
              {v.name} · ₹{v.price}{!v.available ? " · out of stock" : ""}
            </option>
          ))}
        </select>
      )}

      <div className="product-bottom">
        <b>₹{price}</b>
        <button
          disabled={!canAdd}
          onClick={() => addStore({
            id: item.id,
            name: hasVariants ? `${item.name} (${selectedVariant.name})` : item.name,
            price,
            category: item.category,
            storeId: item.storeId,
            storeName: item.storeName,
            vendor: item.storeName,
            variantId: hasVariants ? selectedVariant.id : undefined,
          })}
        >
          <HiPlus /> {canAdd ? "Add" : "Out of stock"}
        </button>
      </div>
    </article>
  );
}

// A real, reachable email + phone -- needed for password recovery
// (USN+password accounts have no real inbox on auth.users.email, see
// mvpService.js's usnToEmail()) and for the Email/SMS notification channel
// toggles in Notifications settings, which stay disabled until these are
// filled in (see NotificationChannelPanel). profiles.phone already existed
// (added for event-registration contact details) but was never surfaced
// here directly.
function ContactRecoveryPanel({ profile, onProfileUpdated, notify }) {
  const [email, setEmail] = useState(profile?.contact_email || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [sendingVerify, setSendingVerify] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);

  useEffect(() => { setEmail(profile?.contact_email || ""); }, [profile?.contact_email]);
  useEffect(() => { setPhone(profile?.phone || ""); }, [profile?.phone]);

  if (!profile) return null;

  const isVerified = !!profile.contact_email_verified_at;
  const isPending = !!profile.contact_email && !isVerified;

  const handleSendVerification = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) { notify("Enter a valid email address"); return; }
    try {
      setSendingVerify(true);
      await requestContactEmailVerification(cleanEmail);
      onProfileUpdated({ ...profile, contact_email: cleanEmail, contact_email_verified_at: null });
      notify("Verification email sent -- check your inbox");
    } catch (error) {
      notify(error.message || "Could not send verification email");
    } finally {
      setSendingVerify(false);
    }
  };

  const handleSavePhone = async () => {
    const trimmed = phone.trim();
    if (trimmed === (profile?.phone || "")) return;
    if (trimmed && !/^\+?[0-9\s-]{7,15}$/.test(trimmed)) { notify("Enter a valid phone number"); return; }
    try {
      setSavingPhone(true);
      const next = await updateProfile(profile.id, { phone: trimmed || null });
      onProfileUpdated(next);
    } catch (error) {
      notify(error.message || "Could not save phone number");
    } finally {
      setSavingPhone(false);
    }
  };

  return (
    <div className="profile-box profile-wide-box">
      <span className="section-kicker">CONTACT &amp; RECOVERY</span>
      <p>
        A verified email unlocks password recovery and email notifications;
        a phone number unlocks SMS notifications (and always receives
        emergency alerts, regardless of your SMS setting).
      </p>

      <label>
        Contact email
        <div className="contact-recovery-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          {isVerified && email.trim().toLowerCase() === (profile.contact_email || "").toLowerCase() ? (
            <span className="chip active">Verified</span>
          ) : (
            <button className="ghost" disabled={sendingVerify} onClick={handleSendVerification}>
              {sendingVerify ? "Sending…" : isPending ? "Resend" : "Verify"}
            </button>
          )}
        </div>
        {isPending && email.trim().toLowerCase() === (profile.contact_email || "").toLowerCase() && (
          <small>Check your inbox for a verification link.</small>
        )}
      </label>

      <label>
        Phone number
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={handleSavePhone}
          placeholder="+91XXXXXXXXXX"
          disabled={savingPhone}
        />
      </label>
    </div>
  );
}

/* =========================================================
   LINKEDIN-STYLE PROFILE
========================================================= */

function Profile({ user, onLogin, onLogout, notify, openModal, profile, onProfileUpdated, stats = {}, verification, onVerificationChanged, campusId, go }) {
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [emergencyContactsModalOpen, setEmergencyContactsModalOpen] = useState(false);
  // My Activity (doc §14 student analytics) -- real data via
  // student_activity_summary()/student_spending_series(), replacing the
  // permanently-hardcoded `clubs: 0` this page shipped with. Declared above
  // the early `if (!user)` return since hooks can't be conditional; the
  // effect itself no-ops when signed out.
  const [activitySummary, setActivitySummary] = useState(null);
  const [spendingSeries, setSpendingSeries] = useState([]);
  useEffect(() => {
    if (!user) { setActivitySummary(null); setSpendingSeries([]); return; }
    let cancelled = false;
    Promise.all([getStudentActivitySummary(), getStudentSpendingSeries(30)])
      .then(([summary, series]) => {
        if (cancelled) return;
        setActivitySummary(summary);
        setSpendingSeries(series);
      })
      .catch((error) => console.error("My Activity loading failed:", error));
    return () => { cancelled = true; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Account deletion request (doc "Student" checklist item) -- a real
  // request/review flow, not an immediate delete (see the migration's own
  // comment for why: almost every table in this schema references
  // profiles.id, several with on delete cascade, so an admin reviews before
  // anything actually happens).
  const [deletionRequest, setDeletionRequest] = useState(null);
  const reloadDeletionRequest = () => {
    if (!profile?.id) { setDeletionRequest(null); return; }
    getMyAccountDeletionRequest(profile.id).then(setDeletionRequest).catch((error) => console.error("Deletion request status loading failed", error));
  };
  useEffect(() => { reloadDeletionRequest(); }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRequestDeletion = async () => {
    const reason = window.prompt("Why do you want to delete your account? (optional)");
    if (reason === null) return;
    if (!window.confirm("This submits a request for a campus admin to review. Your account stays active until they act on it. Continue?")) return;
    try {
      await requestAccountDeletion(reason);
      notify("Deletion request submitted — an admin will review it");
      reloadDeletionRequest();
    } catch (error) {
      notify(error.message || "Could not submit deletion request");
    }
  };

  const handleCancelDeletion = async () => {
    if (!deletionRequest?.id) return;
    try {
      await cancelAccountDeletionRequest(deletionRequest.id);
      notify("Deletion request cancelled");
      reloadDeletionRequest();
    } catch (error) {
      notify(error.message || "Could not cancel deletion request");
    }
  };

  if (!user) {
    return (
      <section className="page-section profile-page">
        <div className="empty-profile">
          <div className="profile-logo">C</div>
          <span className="section-kicker">YOUR CAMPUS ID</span>
          <h1>Build your campus identity.</h1>
          <p>
            Sign in to access your profile, skills, clubs, achievements and
            personalized campus activity.
          </p>
          <button className="primary" onClick={onLogin}>
            Sign in with college email
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section profile-page linkedin-profile">
      <div className="linkedin-cover">
        <div className="linkedin-pattern" />
      </div>

      <div className="linkedin-main-card">
        <div className="linkedin-avatar">{user.name[0]}</div>

        <div className="linkedin-intro">
          <div>
            {verification?.status === "verified" ? (
              <span className="verified-pill">
                <HiShieldCheck /> VERIFIED STUDENT
              </span>
            ) : (
              <button className="verified-pill unverified" onClick={() => setVerifyModalOpen(true)}>
                <HiShieldCheck />
                {verification?.status === "pending" ? "VERIFICATION PENDING" : "GET VERIFIED"}
              </button>
            )}
            <h1>{user.name}</h1>
            <p>
              {user.course} · {user.year} · New Horizon College of Engineering
            </p>
            <small>
              Bengaluru, Karnataka · <b>500+ connections</b>
            </small>
          </div>

          <button
            className="ghost"
            onClick={() => openModal("edit-profile")}
          >
            Edit profile
          </button>
        </div>

        {/* Always visible on the profile's landing view, not just inside
            Edit profile -- a connected account is a clickable pill, an
            unconnected one is a one-click "Connect" prompt right here. */}
        <div className="linkedin-social-links">
          {profile?.linkedin_url ? (
            // A pasted link, OAuth-verified or not -- the checkmark just
            // adds "and it's confirmed to really be them" on top of it.
            <a href={profile.linkedin_url} target="_blank" rel="noreferrer">
              <FaLinkedin /> LinkedIn
              {profile?.linkedin_verified_at && <HiShieldCheck title="Verified via LinkedIn sign-in" />}
            </a>
          ) : profile?.linkedin_verified_at ? (
            // Verified via OAuth, but LinkedIn's sign-in doesn't hand back
            // a profile URL -- still need it pasted in to link anywhere.
            <>
              <span className="verified-chip">
                <FaLinkedin /> <HiShieldCheck /> LinkedIn verified
              </span>
              <button className="ghost" onClick={() => openModal("edit-profile")}>
                <HiPlus /> Add profile link
              </button>
            </>
          ) : (
            <button
              className="ghost"
              onClick={async () => {
                try {
                  await connectLinkedin(); // redirects the browser away on success
                } catch (error) {
                  console.error("Connect LinkedIn:", error);
                  notify(error.message || "Unable to connect LinkedIn");
                }
              }}
            >
              <FaLinkedin /> Connect LinkedIn
            </button>
          )}
          {profile?.github_url ? (
            <a href={profile.github_url} target="_blank" rel="noreferrer">
              <FaGithub /> GitHub
            </a>
          ) : (
            <button
              className="ghost"
              onClick={async () => {
                try {
                  await connectGithub(); // redirects the browser away on success
                } catch (error) {
                  console.error("Connect GitHub:", error);
                  notify(error.message || "Unable to connect GitHub");
                }
              }}
            >
              <FaGithub /> Connect GitHub
            </button>
          )}
        </div>

        <div className="linkedin-actions">
          <button className="primary" onClick={() => { navigator.clipboard?.writeText(window.location.href); notify("Profile link copied"); }}>
            <HiArrowUpTray /> Share profile
          </button>
          <button
            className="ghost"
            onClick={async () => {
              try { const next = await updateProfile(profile.id, { ...profile, open_to_projects: !profile.open_to_projects }); onProfileUpdated(next); notify(next.open_to_projects ? "Open to projects" : "Availability hidden"); }
              catch (error) { notify(error.message || "Could not update availability"); }
            }}
          >
            <HiUserPlus /> Open to projects
          </button>
        </div>
        <button className="logout-btn" onClick={onLogout}>
        <HiArrowLeftOnRectangle /> Logout
        </button>
        {go && (
          <button className="link-btn" style={{ marginTop: 10 }} onClick={() => go("legal")}>
            Privacy Policy &amp; Terms of Service
          </button>
        )}
        {deletionRequest ? (
          <div style={{ marginTop: 10, textAlign: "center" }}>
            <small>Account deletion requested — pending admin review.</small>
            <button className="link-btn" onClick={handleCancelDeletion}>Cancel deletion request</button>
          </div>
        ) : (
          <button className="link-btn" style={{ marginTop: 10 }} onClick={handleRequestDeletion}>
            Delete my account
          </button>
        )}
      </div>

      <div className="profile-grid linkedin-grid">
        <div className="profile-box">
          <span className="section-kicker">ABOUT</span>
          <h3>Student builder focused on AI + hardware.</h3>
          <p>
            {profile?.bio || "Add a short bio so fellow students can understand your interests and project goals."}
          </p>
        </div>

        <div className="profile-box">
          <span className="section-kicker">ACTIVITY</span>
          <h3>Campus contribution</h3>
          <div className="stats">
            <b>{stats.posts || 0}<span>Posts</span></b>
            <b>{stats.events || 0}<span>Events</span></b>
            <b>{activitySummary?.clubs_joined_count ?? 0}<span>Clubs</span></b>
            <b>{profile?.open_to_projects ? "Open" : "Closed"}<span>Projects</span></b>
          </div>
        </div>
      </div>

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">MY ACTIVITY</span>
        <div className="activity-box-head">
          <h3>Spending, orders &amp; campus activity</h3>
          {go && (
            <button className="ghost" onClick={() => go("activity")}>
              View all activity <HiArrowRight />
            </button>
          )}
        </div>
        {activitySummary && (
          <>
            <div className="analytics-grid">
              <StatTile
                label="Total spent"
                value={`₹${Number(activitySummary.total_spent || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                sub={`${activitySummary.food_orders_count || 0} food · ${activitySummary.store_orders_count || 0} store orders`}
              />
              <StatTile
                label="Events"
                value={activitySummary.events_registered_count || 0}
                sub={`${activitySummary.events_attended_count || 0} already happened`}
              />
              <StatTile
                label="Marketplace"
                value={activitySummary.marketplace_listings_count || 0}
                sub={`${activitySummary.marketplace_sold_count || 0} sold`}
              />
              <StatTile
                label="Opportunities"
                value={activitySummary.opportunities_applied_count || 0}
                sub={`${activitySummary.mentor_requests_count || 0} mentor requests`}
              />
            </div>
            <TrendChart
              title="Spending, last 30 days"
              points={spendingSeries.map((d) => ({ x: d.day, y: d.total_spent }))}
              valueFormatter={(v) => `₹${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              emptyText="No orders in the last 30 days"
            />
          </>
        )}
      </div>

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">STUDENT VERIFICATION</span>
        {verification?.status === "verified" && (
          <p><HiShieldCheck /> Verified — approved {new Date(verification.verified_at).toLocaleDateString()}.</p>
        )}
        {verification?.status === "pending" && (
          <p>Your student ID is under review. This usually takes a day or two.</p>
        )}
        {verification?.status === "rejected" && (
          <>
            <p>Your last submission was rejected{verification.rejection_reason ? `: ${verification.rejection_reason}` : "."}</p>
            <button className="primary" onClick={() => setVerifyModalOpen(true)}>Resubmit ID</button>
          </>
        )}
        {!verification && (
          <>
            <p>Upload a photo of your college ID card so classmates and staff know you&apos;re a real, verified student.</p>
            <button className="primary" onClick={() => setVerifyModalOpen(true)}>Verify my student ID</button>
          </>
        )}
      </div>

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">EMERGENCY CONTACTS</span>
        <p>
          Add next-of-kin or guardian contacts a campus responder can reach
          on your behalf during a real emergency. A campus admin verifies
          each number before responders trust it.
        </p>
        <button className="primary" onClick={() => setEmergencyContactsModalOpen(true)}>
          <HiPhone /> Manage emergency contacts
        </button>
      </div>

      <ContactRecoveryPanel profile={profile} onProfileUpdated={onProfileUpdated} notify={notify} />

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">PERSONALIZATION</span>
        <div className="push-toggle-row">
          <div>
            <b>Recommended for you</b>
            <small>
              {profile?.personalization_enabled !== false
                ? "Food, events, clubs and opportunities are ranked using your skills, clubs and activity. You can dismiss any recommendation with the × on its card."
                : "Off -- your dashboard shows popular campus picks instead of anything based on your activity."}
            </small>
          </div>
          <button
            className={profile?.personalization_enabled !== false ? "chip active" : "chip"}
            onClick={async () => {
              try {
                const next = await updateProfile(profile.id, { personalization_enabled: !(profile?.personalization_enabled !== false) });
                onProfileUpdated(next);
                notify(next.personalization_enabled ? "Personalized recommendations on" : "Personalized recommendations off");
              } catch (error) {
                notify(error.message || "Could not update personalization setting");
              }
            }}
          >
            {profile?.personalization_enabled !== false ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">SELLER AVAILABILITY</span>
        <div className="push-toggle-row">
          <div>
            <b>Marketplace availability</b>
            <small>
              {profile?.availability_status === "away"
                ? "Buyers messaging you about a listing will see you're away."
                : "Buyers messaging you about a listing will see you're active and likely to reply soon."}
            </small>
          </div>
          <button
            className={profile?.availability_status === "away" ? "chip" : "chip active"}
            onClick={async () => {
              try {
                const nextStatus = profile?.availability_status === "away" ? "available" : "away";
                const next = await updateProfile(profile.id, { availability_status: nextStatus });
                onProfileUpdated(next);
                notify(nextStatus === "away" ? "Set to Away" : "Set to Active");
              } catch (error) {
                notify(error.message || "Could not update availability");
              }
            }}
          >
            {profile?.availability_status === "away" ? "Away" : "Active"}
          </button>
        </div>
        {profile?.availability_status === "away" && (
          <label style={{ marginTop: 10, display: "block" }}>
            Away message (optional)
            <input
              defaultValue={profile?.availability_message || ""}
              placeholder="e.g. Back on Monday"
              onBlur={async (e) => {
                const value = e.target.value.trim();
                if (value === (profile?.availability_message || "")) return;
                try {
                  const next = await updateProfile(profile.id, { availability_message: value || null });
                  onProfileUpdated(next);
                } catch (error) {
                  notify(error.message || "Could not update away message");
                }
              }}
            />
          </label>
        )}
      </div>

      {profile?.role === "student" && (
        <div className="profile-box profile-wide-box">
          <span className="section-kicker">RUN A CAMPUS BUSINESS</span>
          <p>Run a canteen, print counter or campus store? Apply for a vendor account.</p>
          <button className="primary" onClick={() => setVendorModalOpen(true)}>Apply to become a vendor</button>
        </div>
      )}

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">FEATURED PROJECT</span>
        <div className="featured-project">
          <div className="featured-project-icon">
            <HiCpuChip />
          </div>
          <div>
            <h3>Campus OS</h3>
            <p>
              A unified student ecosystem combining community, services,
              transactions, campus intelligence and future hardware.
            </p>
            <div className="skill-list">
              <span>React</span>
              <span>AI/ML</span>
              <span>IoT</span>
              <span>Product</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-grid linkedin-grid">
        <div className="profile-box">
          <span className="section-kicker">EXPERIENCE</span>
          <h3>Campus OS — Product Builder</h3>
          <p>2026 · Present</p>
          <p>
            Designing the digital operating layer for student communities,
            campus commerce and autonomous infrastructure.
          </p>
        </div>

        <div className="profile-box">
          <span className="section-kicker">ACHIEVEMENTS</span>
          <h3>Campus Passport</h3>
          {profile?.achievements?.length > 0 ? (
            profile.achievements.map((achievement) => (
              <p key={achievement}><HiTrophy /> {achievement}</p>
            ))
          ) : (
            <p>
              Add hackathon wins, certifications or other achievements so
              classmates can find and celebrate them on{" "}
              <b>Connect</b>.{" "}
              <button className="link-btn" onClick={() => openModal("edit-profile")}>
                Add one now
              </button>
            </p>
          )}
        </div>
      </div>

      {verifyModalOpen && (
        <VerifyIdModal
          profile={profile}
          campusId={campusId}
          onClose={() => setVerifyModalOpen(false)}
          onSubmitted={() => { setVerifyModalOpen(false); onVerificationChanged(); notify("ID submitted for review"); }}
          notify={notify}
        />
      )}

      {vendorModalOpen && (
        <OrgRequestModal
          requestType="vendor"
          authUser={profile}
          campusId={campusId}
          onClose={() => setVendorModalOpen(false)}
          notify={notify}
        />
      )}

      {emergencyContactsModalOpen && (
        <EmergencyContactsModal
          onClose={() => setEmergencyContactsModalOpen(false)}
          notify={notify}
        />
      )}
    </section>
  );
}

const EMERGENCY_RELATIONSHIPS = [
  ["parent", "Parent"], ["guardian", "Guardian"], ["sibling", "Sibling"],
  ["spouse", "Spouse"], ["relative", "Relative"], ["friend", "Friend"], ["other", "Other"],
];

/* =========================================================
   YOUR ACTIVITY -- unified history hub (doc: "Your activity" tree --
   Food orders / Event registrations / Club activity / Marketplace /
   Service requests / Bookings / Print jobs / Applications /
   Notifications / Payments). Food orders, applications, event
   registrations, club activity and payments have no other read-only
   history view anywhere else in the app -- this is the only place a
   student can see them. The other five (services/bookings/print/
   marketplace/notifications) already have a live, actionable page
   elsewhere; rows here are read-only summaries that deep-link out to
   that page via `go()` rather than duplicating its interactions.
========================================================= */

function activityStatusTone(status) {
  const s = (status || "").toString().toLowerCase();
  if (/(completed|delivered|paid|captured|confirmed|approved|accepted|sold|resolved|active)/.test(s)) return "good";
  if (/(cancel|reject|fail|declin|remov|expired|refund)/.test(s)) return "bad";
  if (/(pending|submitted|created|preparing|ready|reviewed|shortlisted|out_for_delivery|received|processing)/.test(s)) return "warn";
  return "neutral";
}

function formatStatusLabel(status) {
  if (!status) return "";
  return status.toString().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function activityMoney(value) {
  return `₹${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function ActivityRow({ icon, title, subtitle, meta, status, onClick, action }) {
  return (
    <div
      className={`activity-row${onClick ? " clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <span className="activity-row-icon">{icon}</span>
      <div className="activity-row-body">
        <b>{title}</b>
        {subtitle && <small>{subtitle}</small>}
      </div>
      <div className="activity-row-end">
        {status && <span className={`activity-status tone-${activityStatusTone(status)}`}>{formatStatusLabel(status)}</span>}
        {meta && <small className="activity-row-meta">{meta}</small>}
        {action}
      </div>
    </div>
  );
}

const ACTIVITY_CATEGORIES = [
  { key: "food", label: "Food orders", icon: <HiShoppingCart /> },
  { key: "events", label: "Event registrations", icon: <HiCalendarDays /> },
  { key: "clubs", label: "Club activity", icon: <HiUserGroup /> },
  { key: "marketplace", label: "Marketplace", icon: <HiShoppingBag /> },
  { key: "services", label: "Service requests", icon: <HiWrenchScrewdriver /> },
  { key: "bookings", label: "Bookings", icon: <HiBuildingOffice2 /> },
  { key: "print", label: "Print jobs", icon: <HiPrinter /> },
  { key: "applications", label: "Applications", icon: <HiBriefcase /> },
  { key: "notifications", label: "Notifications", icon: <HiBell /> },
  { key: "payments", label: "Payments", icon: <HiCreditCard /> },
];

function YourActivity({
  profile,
  authUser,
  notify,
  go,
  orders = [],
  printJobs = [],
  serviceRequests = [],
  bookings = [],
  notifications = [],
}) {
  const userId = profile?.id || authUser?.id;
  const [tab, setTab] = useState("food");
  const [loading, setLoading] = useState(true);
  const [eventRegs, setEventRegs] = useState([]);
  const [clubActivity, setClubActivity] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [applications, setApplications] = useState([]);
  const [mentorRequests, setMentorRequests] = useState([]);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getMyEventRegistrations(userId),
      getMyClubs(userId),
      getMyMarketplaceListings(userId),
      getMyApplicationsDetailed(userId),
      getMyMentorRequests(userId),
      getMyPayments(userId),
    ])
      .then(([regs, clubMemberships, listings, apps, mentorReqs, pays]) => {
        if (cancelled) return;
        setEventRegs(regs);
        setClubActivity(clubMemberships);
        setMyListings(listings);
        setApplications(apps);
        setMentorRequests(mentorReqs);
        setPayments(pays);
      })
      .catch((error) => {
        console.error("Your Activity loading failed:", error);
        notify?.(error.message || "Could not load your activity");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!userId) {
    return (
      <ErrorState
        title="Sign in to view your activity"
        text="Your food orders, bookings, applications, payments and more all live here once you're signed in."
      />
    );
  }

  const counts = {
    food: orders.length,
    events: eventRegs.length,
    clubs: clubActivity.length,
    marketplace: myListings.length,
    services: serviceRequests.length,
    bookings: bookings.length,
    print: printJobs.length,
    applications: applications.length + mentorRequests.length,
    notifications: notifications.length,
    payments: payments.length,
  };

  return (
    <section className="page-section activity-page">
      <PageHeader
        kicker="YOUR HISTORY"
        title="Your activity"
        text="Everything you've ordered, booked, joined and applied to on CampusOS, in one place."
      />

      <div className="activity-layout">
        <nav className="activity-nav">
          {ACTIVITY_CATEGORIES.map((c) => (
            <button
              key={c.key}
              className={`activity-nav-item${tab === c.key ? " active" : ""}`}
              onClick={() => setTab(c.key)}
            >
              <span className="activity-nav-icon">{c.icon}</span>
              <span className="activity-nav-label">{c.label}</span>
              <span className="activity-nav-count">{counts[c.key]}</span>
            </button>
          ))}
        </nav>

        <div className="activity-content">
          {loading ? (
            <LoadingState label="Loading your activity…" />
          ) : (
            <>
              {tab === "food" && <ActivityFoodOrders orders={orders} go={go} />}
              {tab === "events" && <ActivityEventRegistrations items={eventRegs} go={go} />}
              {tab === "clubs" && <ActivityClubs items={clubActivity} go={go} />}
              {tab === "marketplace" && <ActivityMarketplace items={myListings} go={go} />}
              {tab === "services" && <ActivityServiceRequests items={serviceRequests} go={go} />}
              {tab === "bookings" && <ActivityBookings items={bookings} go={go} />}
              {tab === "print" && <ActivityPrintJobs items={printJobs} go={go} />}
              {tab === "applications" && (
                <ActivityApplications applications={applications} mentorRequests={mentorRequests} go={go} />
              )}
              {tab === "notifications" && <ActivityNotifications items={notifications} go={go} />}
              {tab === "payments" && <ActivityPayments items={payments} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ActivityFoodOrders({ orders, go }) {
  const [receiptOrder, setReceiptOrder] = useState(null);

  if (!orders.length) {
    return (
      <EmptyState
        icon={<HiShoppingCart />}
        title="No food orders yet"
        text="Order from a campus canteen and it'll show up here."
        action={<button className="ghost" onClick={() => go("food")}>Browse food</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {orders.map((order) => (
        <ActivityRow
          key={order.id}
          icon={<HiShoppingCart />}
          title={order.canteens?.name || "Canteen order"}
          subtitle={`${(order.order_items || []).length} item${(order.order_items || []).length === 1 ? "" : "s"} · ${order.created_at ? new Date(order.created_at).toLocaleString() : ""}${order.pickup_code ? ` · Pickup ${order.pickup_code}` : ""}`}
          meta={activityMoney(order.total)}
          status={order.status}
          action={
            ["paid", "refund_pending", "refunded"].includes(order.payment_status) ? (
              <button className="ghost" onClick={(e) => { e.stopPropagation(); setReceiptOrder(order); }}>
                Receipt
              </button>
            ) : undefined
          }
        />
      ))}

      {receiptOrder && <FoodReceiptModal order={receiptOrder} onClose={() => setReceiptOrder(null)} />}
    </div>
  );
}

// GST invoice / receipt (doc Phase 3 "Invoice generation"). Generated
// on-demand via generate_order_invoice() -- idempotent server-side, so
// opening this more than once for the same order never creates duplicates.
function FoodReceiptModal({ order, onClose }) {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    getOrCreateOrderInvoice(order.id)
      .then((data) => { if (mounted) setInvoice(data); })
      .catch((err) => { if (mounted) setError(err.message || "Could not load the receipt"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [order.id]);

  return (
    <ModalShell kicker="RECEIPT" title={order.canteens?.name || "Order receipt"} onClose={onClose}>
      {loading && <LoadingState label="Loading receipt…" />}
      {error && <ErrorState title="Couldn't load the receipt" text={error} />}
      {invoice && (
        <div className="receipt-body">
          <div className="resource-row">
            <div>
              <b>{invoice.invoice_number}</b>
              <small>{new Date(invoice.issued_at).toLocaleString()}</small>
            </div>
          </div>

          <div className="price-preview"><span>Subtotal</span><b>₹{invoice.subtotal}</b></div>
          {Number(invoice.cgst_amount) > 0 || Number(invoice.sgst_amount) > 0 ? (
            <>
              <div className="price-preview"><span>CGST</span><b>₹{invoice.cgst_amount}</b></div>
              <div className="price-preview"><span>SGST</span><b>₹{invoice.sgst_amount}</b></div>
              {invoice.gst_number && <small>GSTIN: {invoice.gst_number}</small>}
            </>
          ) : (
            <div className="price-preview"><span>Tax</span><b>₹{invoice.tax_amount}</b></div>
          )}
          {Number(invoice.platform_fee) > 0 && <div className="price-preview"><span>Platform fee</span><b>₹{invoice.platform_fee}</b></div>}
          {Number(invoice.delivery_fee) > 0 && <div className="price-preview"><span>Delivery fee</span><b>₹{invoice.delivery_fee}</b></div>}
          {Number(invoice.discount_amount) > 0 && <div className="price-preview"><span>Discount</span><b>−₹{invoice.discount_amount}</b></div>}
          <div className="price-preview"><span>Total</span><b>₹{invoice.total}</b></div>

          <button className="ghost wide" style={{ marginTop: 16 }} onClick={() => window.print()}>Print / save as PDF</button>
        </div>
      )}
    </ModalShell>
  );
}

function ActivityEventRegistrations({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiCalendarDays />}
        title="No event registrations yet"
        text="Register for a campus event and it'll show up here."
        action={<button className="ghost" onClick={() => go("events")}>Browse events</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((reg) => (
        <ActivityRow
          key={reg.event_id}
          icon={<HiCalendarDays />}
          title={reg.events?.title || "Campus event"}
          subtitle={`${reg.events?.category || "Event"}${reg.events?.place ? ` · ${reg.events.place}` : ""}${reg.events?.event_date ? ` · ${new Date(reg.events.event_date).toLocaleString()}` : ""}`}
          meta={reg.registered_at ? `Registered ${new Date(reg.registered_at).toLocaleDateString()}` : undefined}
          onClick={() => go("events")}
        />
      ))}
    </div>
  );
}

function ActivityClubs({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiUserGroup />}
        title="No club activity yet"
        text="Join a club and your membership will show up here."
        action={<button className="ghost" onClick={() => go("clubs")}>Browse clubs</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((membership) => (
        <ActivityRow
          key={membership.club_id}
          icon={<HiUserGroup />}
          title={membership.clubs?.name || "Campus club"}
          subtitle={`${membership.clubs?.category || "Club"}${membership.joined_at ? ` · Joined ${new Date(membership.joined_at).toLocaleDateString()}` : ""}`}
          meta={membership.role ? formatStatusLabel(membership.role) : undefined}
          onClick={() => go("clubs")}
        />
      ))}
    </div>
  );
}

function ActivityMarketplace({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiShoppingBag />}
        title="No marketplace listings yet"
        text="List something to sell and it'll show up here."
        action={<button className="ghost" onClick={() => go("market")}>Open Marketplace</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((listing) => (
        <ActivityRow
          key={listing.id}
          icon={<HiShoppingBag />}
          title={listing.title}
          subtitle={`${listing.category || "Other"} · ${listing.condition || "Used"}${listing.created_at ? ` · Listed ${new Date(listing.created_at).toLocaleDateString()}` : ""}`}
          meta={activityMoney(listing.price)}
          status={listing.status}
          onClick={() => go("market")}
        />
      ))}
    </div>
  );
}

function ActivityServiceRequests({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiWrenchScrewdriver />}
        title="No service requests yet"
        text="Report a maintenance issue and it'll show up here."
        action={<button className="ghost" onClick={() => go("issues")}>Report an issue</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((request) => (
        <ActivityRow
          key={request.id}
          icon={<HiWrenchScrewdriver />}
          title={request.title || request.services?.name || "Service request"}
          subtitle={`${request.services?.name || "Campus service"}${request.locations?.building ? ` · ${request.locations.building}` : ""}${request.created_at ? ` · ${new Date(request.created_at).toLocaleDateString()}` : ""}`}
          status={request.status}
          onClick={() => go("issues")}
        />
      ))}
    </div>
  );
}

function ActivityBookings({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiBuildingOffice2 />}
        title="No bookings yet"
        text="Book a hall, lab or piece of equipment and it'll show up here."
        action={<button className="ghost" onClick={() => go("booking")}>Book a resource</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((booking) => (
        <ActivityRow
          key={booking.id}
          icon={<HiBuildingOffice2 />}
          title={booking.resources?.name || "Resource booking"}
          subtitle={`${booking.resources?.resource_type || "Resource"} · ${booking.start_time ? new Date(booking.start_time).toLocaleString() : ""}${booking.end_time ? ` – ${new Date(booking.end_time).toLocaleTimeString()}` : ""}`}
          status={booking.status}
          onClick={() => go("booking")}
        />
      ))}
    </div>
  );
}

function ActivityPrintJobs({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiPrinter />}
        title="No print jobs yet"
        text="Upload a document to print and it'll show up here."
        action={<button className="ghost" onClick={() => go("print")}>Print a document</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((job) => (
        <ActivityRow
          key={job.id}
          icon={<HiPrinter />}
          title={job.file_name || "Print job"}
          subtitle={`${job.copies || 1} copy${(job.copies || 1) === 1 ? "" : "ies"} · ${job.pages || 1} page${(job.pages || 1) === 1 ? "" : "s"} · ${job.color_mode === "colour" ? "Color" : "Black & white"}${job.created_at ? ` · ${new Date(job.created_at).toLocaleDateString()}` : ""}`}
          meta={job.price != null ? activityMoney(job.price) : undefined}
          status={job.status}
          onClick={() => go("print")}
        />
      ))}
    </div>
  );
}

function ActivityApplications({ applications, mentorRequests, go }) {
  if (!applications.length && !mentorRequests.length) {
    return (
      <EmptyState
        icon={<HiBriefcase />}
        title="No applications yet"
        text="Apply to an opportunity or request a mentor and it'll show up here."
        action={<button className="ghost" onClick={() => go("events")}>Browse opportunities</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {applications.map((app) => (
        <ActivityRow
          key={`app-${app.id}`}
          icon={<HiBriefcase />}
          title={app.opportunities ? `${app.opportunities.role} @ ${app.opportunities.company}` : "Opportunity application"}
          subtitle={`${app.opportunities?.type || "Opportunity"}${app.created_at ? ` · Applied ${new Date(app.created_at).toLocaleDateString()}` : ""}`}
          status={app.status}
          onClick={() => go("events")}
        />
      ))}
      {mentorRequests.map((req) => (
        <ActivityRow
          key={`mentor-${req.id}`}
          icon={<HiAcademicCap />}
          title={req.mentors ? `Mentorship · ${req.mentors.name}` : "Mentor request"}
          subtitle={`${req.mentors?.role || "Mentor"}${req.created_at ? ` · Requested ${new Date(req.created_at).toLocaleDateString()}` : ""}`}
          status={req.status}
          onClick={() => go("events")}
        />
      ))}
    </div>
  );
}

function ActivityNotifications({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiBell />}
        title="No notifications yet"
        text="Campus updates, order alerts and service updates will show up here."
      />
    );
  }
  return (
    <div className="activity-list">
      {items.slice(0, 20).map((n) => (
        <ActivityRow
          key={n.id}
          icon={<HiBell />}
          title={n.title}
          subtitle={n.time || (n.created_at ? new Date(n.created_at).toLocaleString() : "")}
          meta={n.unread ? "Unread" : undefined}
          onClick={() => go("notifications")}
        />
      ))}
      {items.length > 20 && (
        <button className="ghost wide" onClick={() => go("notifications")}>
          View all {items.length} notifications
        </button>
      )}
    </div>
  );
}

function ActivityPayments({ items }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiCreditCard />}
        title="No payments yet"
        text="Payments for food orders show up here once you've placed one."
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((payment) => (
        <ActivityRow
          key={payment.id}
          icon={<HiCreditCard />}
          title={payment.orders?.canteens?.name ? `Payment · ${payment.orders.canteens.name}` : "Payment"}
          subtitle={`${payment.gateway ? formatStatusLabel(payment.gateway) : "Gateway"}${payment.created_at ? ` · ${new Date(payment.created_at).toLocaleString()}` : ""}`}
          meta={activityMoney(payment.amount)}
          status={payment.status}
        />
      ))}
    </div>
  );
}

// Student self-service on the next-of-kin directory (doc §113). Contacts
// start unverified -- a facilities/admin reviewer confirms the number
// separately (Admin CMS -> Emergency Contacts) -- and editing an already
// verified contact resets it back to unverified server-side, since the
// point of verification is confirming *this exact* number is real.
function EmergencyContactsModal({ onClose, notify }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null = not editing, {} = new, {...} = existing
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setContacts(await listMyEmergencyContacts());
    } catch (err) {
      setError(err.message || "Could not load your emergency contacts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (contact) => {
    if (!window.confirm(`Remove ${contact.contact_name} as an emergency contact?`)) return;
    try {
      await deleteEmergencyContact(contact.id);
      notify("Emergency contact removed");
      await reload();
    } catch (err) {
      notify(err.message || "Could not remove this contact");
    }
  };

  const save = async (form) => {
    try {
      setSaving(true);
      await upsertEmergencyContact({
        id: editing?.id || null,
        contactName: form.contact_name,
        relationship: form.relationship,
        phone: form.phone,
        altPhone: form.alt_phone,
        email: form.email,
        isPrimary: form.is_primary,
      });
      notify(editing?.id ? "Emergency contact updated" : "Emergency contact added");
      setEditing(null);
      await reload();
    } catch (err) {
      notify(err.message || "Could not save this contact");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell kicker="EMERGENCY CONTACTS" title="Your next-of-kin contacts" onClose={onClose}>
      {editing ? (
        <EmergencyContactForm
          initial={editing}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : (
        <>
          {loading && <LoadingState label="Loading your contacts…" />}
          {!loading && error && <ErrorState text={error} onRetry={reload} />}
          {!loading && !error && contacts.length === 0 && (
            <EmptyState icon={<HiPhone />} title="No emergency contacts yet" text="Add at least one so a responder can reach someone on your behalf in a real emergency." />
          )}
          {!loading && !error && contacts.map((contact) => (
            <div key={contact.id} className="resource-row">
              <div>
                <b>
                  {contact.contact_name}{" "}
                  <small>({EMERGENCY_RELATIONSHIPS.find(([k]) => k === contact.relationship)?.[1] || contact.relationship})</small>
                  {contact.is_primary && <span className="social-type" style={{ marginLeft: 6 }}>PRIMARY</span>}
                </b>
                <small>
                  {contact.phone}{contact.alt_phone ? ` · alt ${contact.alt_phone}` : ""}
                  {" · "}
                  {contact.verified ? (
                    <span><HiShieldCheck /> Verified</span>
                  ) : (
                    "Pending verification"
                  )}
                </small>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setEditing(contact)}><HiPencilSquare /></button>
                <button onClick={() => remove(contact)}><HiTrash /></button>
              </div>
            </div>
          ))}
          {!loading && !error && contacts.length < 5 && (
            <button className="primary wide" onClick={() => setEditing({})}>
              <HiPlus /> Add emergency contact
            </button>
          )}
        </>
      )}
    </ModalShell>
  );
}

function EmergencyContactForm({ initial, saving, onCancel, onSave }) {
  const [form, setForm] = useState({
    contact_name: initial?.contact_name || "",
    relationship: initial?.relationship || "parent",
    phone: initial?.phone || "",
    alt_phone: initial?.alt_phone || "",
    email: initial?.email || "",
    is_primary: initial?.is_primary || false,
  });
  const change = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div>
      <label>
        Name
        <input value={form.contact_name} onChange={(e) => change("contact_name", e.target.value)} placeholder="Contact's full name" />
      </label>
      <label>
        Relationship
        <select value={form.relationship} onChange={(e) => change("relationship", e.target.value)}>
          {EMERGENCY_RELATIONSHIPS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label>
        Phone
        <input value={form.phone} onChange={(e) => change("phone", e.target.value)} placeholder="+91XXXXXXXXXX" />
      </label>
      <label>
        Alternate phone (optional)
        <input value={form.alt_phone} onChange={(e) => change("alt_phone", e.target.value)} placeholder="Optional" />
      </label>
      <label>
        Email (optional)
        <input value={form.email} onChange={(e) => change("email", e.target.value)} placeholder="Optional" />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" checked={form.is_primary} onChange={(e) => change("is_primary", e.target.checked)} style={{ width: "auto" }} />
        Make this my primary contact
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="primary wide" disabled={saving} onClick={() => onSave(form)}>
          {saving ? "Saving…" : "Save contact"}
        </button>
        <button disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function VerifyIdModal({ profile, campusId, onClose, onSubmitted, notify }) {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <ModalShell kicker="VERIFICATION" title="Verify your student ID" onClose={onClose}>
      <p>
        Upload a clear photo of your college ID card (front side, USN and name
        visible). A campus admin reviews it — this is never shown publicly.
      </p>
      <label>
        ID card photo
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <button
        className="primary wide"
        disabled={submitting || !file}
        onClick={async () => {
          try {
            setSubmitting(true);
            await submitStudentVerification({ userId: profile.id, campusId, usn: profile.usn, file });
            onSubmitted();
          } catch (error) {
            notify(error.message || "Could not submit for verification");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Uploading…" : "Submit for review"}
      </button>
    </ModalShell>
  );
}

/* =========================================================
   CONNECT (classmate directory — nee "Socialize")
========================================================= */

function Socialize({ notify, people = [], profile, campusId, authUser, openLogin, onOpenConversation }) {
  const [tab, setTab] = useState("directory"); // 'directory' | 'suggestions' | 'groups'
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [openOnly, setOpenOnly] = useState(false);

  const classmates = useMemo(
    () => people.filter((person) => person.id !== profile?.id),
    [people, profile?.id]
  );

  const courses = useMemo(() => {
    const set = new Set(classmates.map((person) => person.course).filter(Boolean));
    return Array.from(set).sort();
  }, [classmates]);

  const years = useMemo(() => {
    const set = new Set(classmates.map((person) => person.year).filter(Boolean));
    return Array.from(set).sort();
  }, [classmates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classmates.filter((person) => {
      if (courseFilter !== "All" && person.course !== courseFilter) return false;
      if (yearFilter !== "All" && person.year !== yearFilter) return false;
      if (openOnly && !person.open_to_projects) return false;
      if (!q) return true;
      const haystack = [
        person.name,
        person.course,
        ...(person.skills || []),
        ...(person.achievements || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [classmates, courseFilter, yearFilter, openOnly, query]);

  const sameBranchCount = profile?.course
    ? classmates.filter((person) => person.course === profile.course).length
    : 0;

  return (
    <section className="page-section socialize-page">
      <PageHeader
        kicker="YOUR CAMPUS COHORT"
        title="Connect"
        text="Find classmates, browse by branch and year, and see the achievements they've chosen to share."
        action={
          profile?.course ? (
            <button
              className="primary"
              onClick={() => {
                setCourseFilter(profile.course);
                notify(`Showing your ${profile.course} classmates`);
              }}
            >
              <HiUserGroup /> My branch
            </button>
          ) : null
        }
      />

      <div className="chips" style={{ marginBottom: 20 }}>
        <button className={tab === "directory" ? "chip active" : "chip"} onClick={() => setTab("directory")}>
          Directory
        </button>
        <button className={tab === "suggestions" ? "chip active" : "chip"} onClick={() => setTab("suggestions")}>
          <HiSparkles /> Suggested for you
        </button>
        <button className={tab === "groups" ? "chip active" : "chip"} onClick={() => setTab("groups")}>
          <HiUserGroup /> Groups
        </button>
      </div>

      {tab === "suggestions" && <SuggestedForYou notify={notify} authUser={authUser} openLogin={openLogin} onOpenConversation={onOpenConversation} />}
      {tab === "groups" && <CohortGroups notify={notify} campusId={campusId} profile={profile} />}

      {tab === "directory" && (
      <>
      <div className="socialize-hero">
        <div>
          <span className="section-kicker">CLASSMATE DIRECTORY</span>
          <h2>Know your campus, one classmate at a time.</h2>
          <p>
            Everyone here is a verified student on your campus. Add your own
            achievements from your profile so others can find them too.
          </p>
        </div>

        <div className="socialize-stats">
          <div><b>{classmates.length}</b><small>students on campus</small></div>
          <div><b>{courses.length}</b><small>branches</small></div>
          <div><b>{sameBranchCount}</b><small>in your branch</small></div>
        </div>
      </div>

      <div className="searchbar compact wide-search">
        <HiMagnifyingGlass />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search classmates, skills or achievements..."
        />
      </div>

      <div className="socialize-filter-row">
        <button
          className={courseFilter === "All" ? "chip active" : "chip"}
          onClick={() => setCourseFilter("All")}
        >
          All branches
        </button>
        {courses.map((course) => (
          <button
            key={course}
            className={courseFilter === course ? "chip active" : "chip"}
            onClick={() => setCourseFilter(course)}
          >
            {course}
          </button>
        ))}
      </div>

      <div className="socialize-filter-row">
        <button
          className={yearFilter === "All" ? "chip active" : "chip"}
          onClick={() => setYearFilter("All")}
        >
          All years
        </button>
        {years.map((year) => (
          <button
            key={year}
            className={yearFilter === year ? "chip active" : "chip"}
            onClick={() => setYearFilter(year)}
          >
            {year}
          </button>
        ))}
        <button
          className={openOnly ? "chip active" : "chip"}
          onClick={() => setOpenOnly((current) => !current)}
        >
          Open to projects
        </button>
      </div>

      <div className="socialize-layout">
        <div className="socialize-feed people-grid">
          {filtered.length === 0 && (
            <EmptyState
              icon={<HiUserGroup />}
              title="No classmates match yet"
              text="Try a different branch, year or search term."
            />
          )}
          {filtered.map((person) => (
            <ClassmateCard key={person.id} person={person} notify={notify} authUser={authUser} openLogin={openLogin} onOpenConversation={onOpenConversation} />
          ))}
        </div>

        <aside className="socialize-sidebar">
          <span className="section-kicker">BROWSE BY BRANCH</span>
          {courses.map((course) => (
            <button key={course} onClick={() => setCourseFilter(course)}>
              <span>{classmates.filter((person) => person.course === course).length}</span>
              <div>
                <b>{course}</b>
                <small>
                  {classmates.filter((person) => person.course === course).length} students
                </small>
              </div>
              <HiChevronRight />
            </button>
          ))}

          <div className="socialize-note">
            <HiUserGroup />
            <b>Your campus network</b>
            <small>
              Only verified students on your own campus show up here — no
              outside colleges, no spoofed activity.
            </small>
          </div>
        </aside>
      </div>
      </>
      )}
    </section>
  );
}

/* =========================================================
   PEOPLE YOU MAY KNOW
========================================================= */

function SuggestedForYou({ notify, authUser, openLogin, onOpenConversation }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setSuggestions(await getPeopleYouMayKnow({ limit: 12 }));
    } catch (err) {
      setError(err.message || "Could not load suggestions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Finding people you may know…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;
  if (suggestions.length === 0) {
    return (
      <EmptyState
        icon={<HiSparkles />}
        title="No suggestions yet"
        text="Join a club, post something, or fill in your branch and year — the more the campus knows about you, the better these get."
      />
    );
  }

  return (
    <div className="socialize-feed people-grid">
      {suggestions.map((person) => (
        <SuggestedPersonCard key={person.id} person={person} notify={notify} authUser={authUser} openLogin={openLogin} onOpenConversation={onOpenConversation} />
      ))}
    </div>
  );
}

function SuggestedPersonCard({ person, notify, authUser, openLogin, onOpenConversation }) {
  const [messaging, setMessaging] = useState(false);
  const reasons = [];
  if (person.course) reasons.push(`Same branch (${person.course})`);
  if (person.year) reasons.push(person.year);
  if (person.shared_clubs > 0) reasons.push(`${person.shared_clubs} club${person.shared_clubs > 1 ? "s" : ""} in common`);
  if (person.shared_tags > 0) reasons.push(`${person.shared_tags} shared interest${person.shared_tags > 1 ? "s" : ""}`);

  return (
    <article className="person-card">
      <div className="person-top">
        <div className="big-avatar small">{person.name?.[0] || "?"}</div>
        <div>
          <h3>{person.name}</h3>
          <p>{person.course} · {person.year}</p>
        </div>
        <span className="match">{person.score}%</span>
      </div>

      {reasons.length > 0 && (
        <p className="classmate-bio">{reasons.join(" · ")}</p>
      )}

      {person.skills?.length > 0 && (
        <div className="skill-list">
          {person.skills.map((skill) => <span key={skill}>{skill}</span>)}
        </div>
      )}

      <div className="person-actions">
        <button onClick={() => notify(`Connection request sent to ${person.name}`)}>
          <HiUserPlus /> Connect
        </button>
        <button
          className="ghost"
          disabled={messaging}
          onClick={async () => {
            if (!authUser) { openLogin?.(); notify("Sign in to send a message"); return; }
            try {
              setMessaging(true);
              const conversationId = await startConversation(person.id);
              onOpenConversation?.(conversationId);
            } catch (error) {
              notify(error.message || "Could not start a conversation");
            } finally {
              setMessaging(false);
            }
          }}
        >
          <HiChatBubbleLeftRight /> {messaging ? "Starting…" : "Message"}
        </button>
      </div>
    </article>
  );
}

/* =========================================================
   AUTO COHORT GROUPS
========================================================= */

function CohortGroups({ notify, campusId, profile }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState([]);
  const [openGroup, setOpenGroup] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setGroups(await getCohortGroups(campusId));
    } catch (err) {
      setError(err.message || "Could not load groups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Forming cohort groups…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;
  if (groups.length === 0) {
    return <EmptyState icon={<HiUserGroup />} title="No groups yet" text="Groups form automatically once at least two students share a branch and year." />;
  }

  return (
    <div>
      <p className="modal-subtext" style={{ marginBottom: 16 }}>
        Formed automatically from branch + year — no one has to create or join these.
      </p>
      <div className="resource-list">
        {groups.map((group) => (
          <article className="resource-row" key={`${group.course}-${group.year}`}>
            <div className="resource-icon"><HiUserGroup /></div>
            <div>
              <b>{group.course} · {group.year}</b>
              <small>
                {group.member_count} students
                {profile?.course === group.course && profile?.year === group.year ? " · this is your cohort" : ""}
              </small>
            </div>
            <button onClick={() => setOpenGroup(group)}>
              View members <HiArrowRight />
            </button>
          </article>
        ))}
      </div>

      {openGroup && (
        <CohortMembersModal
          group={openGroup}
          campusId={campusId}
          onClose={() => setOpenGroup(null)}
          notify={notify}
        />
      )}
    </div>
  );
}

function CohortMembersModal({ group, campusId, onClose, notify }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getCohortGroupMembers({ campusId, course: group.course, year: group.year })
      .then(setMembers)
      .catch((err) => setError(err.message || "Could not load members"));
  }, [campusId, group.course, group.year]);

  return (
    <ModalShell kicker="COHORT GROUP" title={`${group.course} · ${group.year}`} onClose={onClose}>
      {error && <ErrorState text={error} />}
      {!error && !members && <LoadingState label="Loading members…" />}
      {members && members.length === 0 && <EmptyState title="No members visible" />}
      {members && members.map((m) => (
        <div key={m.id} className="resource-row">
          <div className="resource-icon">{m.name?.[0] || "?"}</div>
          <div>
            <b>{m.name}</b>
            <small>{m.department || m.course}{m.open_to_projects ? " · Open to projects" : ""}</small>
          </div>
          <button onClick={() => notify(`Connection request sent to ${m.name}`)}>
            <HiUserPlus />
          </button>
        </div>
      ))}
    </ModalShell>
  );
}

function ClassmateCard({ person, notify, authUser, openLogin, onOpenConversation }) {
  const [messaging, setMessaging] = useState(false);

  const messagePerson = async () => {
    if (!authUser) { openLogin?.(); notify("Sign in to send a message"); return; }
    try {
      setMessaging(true);
      const conversationId = await startConversation(person.id);
      onOpenConversation?.(conversationId);
    } catch (error) {
      notify(error.message || "Could not start a conversation");
    } finally {
      setMessaging(false);
    }
  };

  return (
    <article className="person-card">
      <div className="person-top">
        <div className="big-avatar small">{person.name?.[0] || "?"}</div>

        <div>
          <h3>{person.name}</h3>
          <p>
            {person.course} · {person.year}
          </p>
        </div>

        {person.open_to_projects && <span className="match">Open</span>}
      </div>

      {person.bio && <p className="classmate-bio">{person.bio}</p>}

      {person.achievements?.length > 0 && (
        <div className="skill-list achievements-list">
          {person.achievements.map((achievement) => (
            <span key={achievement}>
              <HiTrophy /> {achievement}
            </span>
          ))}
        </div>
      )}

      {person.skills?.length > 0 && (
        <div className="skill-list">
          {person.skills.map((skill) => (
            <span key={skill}>{skill}</span>
          ))}
        </div>
      )}

      <div className="person-actions">
        <button onClick={() => notify(`Connection request sent to ${person.name}`)}>
          <HiUserPlus /> Connect
        </button>
        <button className="ghost" disabled={messaging} onClick={messagePerson}>
          <HiChatBubbleLeftRight /> {messaging ? "Starting…" : "Message"}
        </button>
        {person.linkedin_url && (
          <a className="ghost" href={person.linkedin_url} target="_blank" rel="noreferrer">
            <FaLinkedin /> LinkedIn
          </a>
        )}
        {person.github_url && (
          <a className="ghost" href={person.github_url} target="_blank" rel="noreferrer">
            <FaGithub /> GitHub
          </a>
        )}
      </div>
    </article>
  );
}

/* =========================================================
   SERVICE DETAIL PAGES
========================================================= */

const serviceDetailData = {
  print: {
    kicker: "PRINT HUB",
    title: "Print & Documents",
    text: "Upload, configure, pay and collect without waiting in line.",
    icon: <HiPrinter />,
  },
  issues: {
    kicker: "FACILITIES",
    title: "Report an Issue",
    text: "Send a campus issue to the right team and track resolution.",
    icon: <HiWrenchScrewdriver />,
  },
  booking: {
    kicker: "RESOURCE BOOKING",
    title: "Book Campus Resources",
    text: "Reserve halls, labs, equipment and sports facilities.",
    icon: <HiBuildingOffice2 />,
  },
  lost: {
    kicker: "LOST & FOUND",
    title: "Campus Lost & Found",
    text: "Report, search and claim items around campus.",
    icon: <HiMagnifyingGlassCircle />,
  },
  market: {
    kicker: "MARKETPLACE",
    title: "Campus Marketplace",
    text: "Buy and sell permitted items inside the verified campus network.",
    icon: <HiShoppingCart />,
  },
  pass: {
    kicker: "DIGITAL CAMPUS PASS",
    title: "Campus Pass",
    text: "One QR companion for events, workshops and pickups.",
    icon: <HiTicket />,
  },
  hostel: {
    kicker: "HOSTEL",
    title: "Hostel Services",
    text: "Mess, laundry, maintenance and room workflows.",
    icon: <HiHomeModern />,
  },
  delivery: {
    kicker: "CAMPUS DELIVERY",
    title: "Campus Delivery",
    text: "Move food, documents and packages across campus.",
    icon: <HiTruck />,
  },
  academics: {
    kicker: "ACADEMICS",
    title: "Academic Announcements",
    text: "Department/faculty announcements, assignments, timetable and academic calendar.",
    icon: <HiAcademicCap />,
  },
};

const PRINT_CANCELLABLE_STATUSES = new Set(["AWAITING_PAYMENT", "UPLOADED", "PROCESSING", "QUEUED", "FAILED"]);
// Once a job has a real pickup code worth showing as a QR, it's been paid for.
const PRINT_QR_STATUSES = new Set(["UPLOADED", "PROCESSING", "QUEUED", "PRINTING", "READY"]);

function PrintJobRow({ job, notify, onChange }) {
  const [qrUrl, setQrUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!PRINT_QR_STATUSES.has(job.status) || !job.pickup_code) { setQrUrl(""); return; }
    let cancelled = false;
    QRCode.toDataURL(job.pickup_code, { width: 140, margin: 1, color: { dark: "#17151f", light: "#ffffff" } })
      .then((url) => { if (!cancelled) setQrUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job.status, job.pickup_code]);

  const cancel = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const result = await cancelPrintJob(job.id, "Cancelled by student");
      if (result?.refund_id) {
        try {
          await startPrintJobRefund(result.refund_id);
          notify("Print job cancelled — refund processed.");
        } catch (refundError) {
          console.error("Print refund:", refundError);
          notify("Print job cancelled — refund is processing, check My Activity shortly.");
        }
      } else {
        notify("Print job cancelled.");
      }
      onChange?.();
    } catch (error) {
      notify(error.message || "Could not cancel this job");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="resource-row">
      <div className="resource-icon"><HiPrinter /></div>
      <div>
        <b>{job.file_name}</b>
        <small>
          {job.pages} pages · {job.copies} {job.copies === 1 ? "copy" : "copies"} · {job.color_mode === "colour" ? "Colour" : "B&W"} ·{" "}
          {job.paper_size}{job.duplex ? " · Duplex" : ""}{job.binding && job.binding !== "none" ? ` · ${job.binding}` : ""}
          {job.price != null ? ` · ₹${job.price}` : ""}
        </small>
        {job.status === "CANCELLED" && job.cancel_reason && <small>Reason: {job.cancel_reason}</small>}
      </div>
      <strong>{job.status.replace(/_/g, " ")}</strong>
      {qrUrl && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <img src={qrUrl} alt={`Pickup QR for code ${job.pickup_code}`} width={64} height={64} />
          <small>{job.pickup_code}</small>
        </div>
      )}
      {PRINT_CANCELLABLE_STATUSES.has(job.status) && (
        <button className="ghost" disabled={busy} onClick={cancel}>
          {busy ? "Cancelling…" : "Cancel"}
        </button>
      )}
    </article>
  );
}

function PrintJobsPanel({ jobs, notify, onChange }) {
  if (!jobs?.length) {
    return <EmptyState icon={<HiPrinter />} title="No print jobs yet" text="Upload a document above to get started." />;
  }
  return (
    <div className="resource-list">
      {jobs.map((job) => <PrintJobRow key={job.id} job={job} notify={notify} onChange={onChange} />)}
    </div>
  );
}

function ServiceDetail({ serviceId, notify, go, openModal, openLogin, authUser, user, profile, campusId, resources, bookings, serviceRequests, printJobs, lostItems, lostItemsLoaded, marketListings, onBookingsChange, onRequestsChange, onLostItemsChange, onMarketListingsChange, onPrintJobsChange, onOpenConversation }) {
  const data = serviceDetailData[serviceId];

  return (
    <section className="page-section service-detail-page">
      <PageHeader
        kicker={data.kicker}
        title={data.title}
        text={data.text}
        action={
          <button className="ghost" onClick={() => go("services")}>
            Back to services
          </button>
        }
      />

      <div className="service-detail-hero">
        <div className="service-detail-icon">{data.icon}</div>
        <div>
          <span className="section-kicker">CAMPUS WORKFLOW</span>
          <h2>{data.title}</h2>
          <p>{data.text}</p>
        </div>
      </div>

      {serviceId === "print" && (
        <>
          <div className="service-detail-grid">
            <WorkflowCard
              icon={<HiDocumentArrowUp />}
              title="1. Upload document"
              text="PDF only, up to 25MB."
              button="Upload"
              onClick={() => openModal("print")}
            />
            <WorkflowCard
              icon={<HiCreditCard />}
              title="2. Configure & pay"
              text="Colour, copies, binding, duplex and paper size."
              button="Configure"
              onClick={() => openModal("print")}
            />
            <WorkflowCard
              icon={<HiQrCode />}
              title="3. QR pickup"
              text="Collect when the shop marks it ready."
              button="View my jobs"
              onClick={() => document.getElementById("print-jobs-panel")?.scrollIntoView({ behavior: "smooth" })}
            />
          </div>
          <div id="print-jobs-panel">
            <PrintJobsPanel
              jobs={printJobs}
              notify={notify}
              onChange={() => authUser && getMyPrintJobs(authUser.id).then(onPrintJobsChange).catch(() => {})}
            />
          </div>
        </>
      )}

      {serviceId === "issues" && (
        <IssueService notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} requests={serviceRequests} onChange={onRequestsChange} />
      )}

      {serviceId === "booking" && (
        <BookingService notify={notify} authUser={authUser} openLogin={openLogin} resources={resources} bookings={bookings} onChange={onBookingsChange} />
      )}

      {serviceId === "lost" && (
        <LostService notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} items={lostItems} loaded={lostItemsLoaded} onChange={onLostItemsChange} />
      )}

      {serviceId === "market" && (
        <Marketplace notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} listings={marketListings} onChange={onMarketListingsChange} onOpenConversation={onOpenConversation} />
      )}

      {serviceId === "pass" && (
        <PassService notify={notify} user={user} authUser={authUser} openLogin={openLogin} />
      )}

      {serviceId === "hostel" && (
        <HostelService notify={notify} go={go} />
      )}

      {serviceId === "delivery" && (
        <DeliveryService notify={notify} />
      )}

      {serviceId === "academics" && (
        <AcademicHub profile={profile} notify={notify} />
      )}
    </section>
  );
}

function WorkflowCard({ icon, title, text, button, onClick }) {
  return (
    <article className="workflow-card">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button onClick={onClick}>
        {button} <HiArrowRight />
      </button>
    </article>
  );
}

function IssueService({ notify, authUser, openLogin, campusId, requests = [], onChange }) {
  /* eslint-disable react/jsx-key -- [title, icon] tuples; the key is
     supplied at the categories.map() call site below. */
  const categories = [
    ["Wi-Fi", <HiWifi />],
    ["Electrical", <HiLightBulb />],
    ["AC", <HiBoltSlash />],
    ["Furniture", <HiBuildingOffice2 />],
    ["Lab Equipment", <HiComputerDesktop />],
    ["Other", <HiExclamationTriangle />],
  ];
  /* eslint-enable react/jsx-key */

  return (
    <div className="service-detail-grid">
      {categories.map(([title, icon]) => (
        <WorkflowCard
          key={title}
          icon={icon}
          title={title}
          text={`Report a ${title.toLowerCase()} issue.`}
          button="Report"
          onClick={async () => {
            if (!authUser) {
              openLogin?.();
              notify("Sign in to report an issue");
              return;
            }
            try { const request = await createCampusServiceRequest({ userId: authUser.id, campusId, serviceName: "Report an Issue", title: `${title} issue`, details: { category: title } }); onChange?.((items) => [request, ...items]); notify(`Ticket created · ${request.id.slice(0, 8)}`); }
            catch (error) { notify(error.message || "Could not create ticket"); }
          }}
        />
      ))}
      {requests.map((request) => <article className="resource-row" key={request.id}><div className="resource-icon"><HiWrenchScrewdriver /></div><div><b>{request.title}</b><small>Ticket {request.id.slice(0, 8)}</small></div><strong>{request.status}</strong></article>)}
    </div>
  );
}

function BookingService({ notify, authUser, openLogin, resources: dbResources = [], bookings = [], onChange }) {
  const [selected, setSelected] = useState(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const resources = dbResources.length ? dbResources.map((item) => [item.name, "Available", item.locations?.name || item.resource_type, item.id]) : [
    ["Innovation Lab", "Available", "2nd Floor"],
    ["Seminar Hall 2", "Available", "Main Block"],
    ["Robotics Lab", "Available", "Block D"],
    ["Sports Court", "Booked", "Ground"],
  ];

  return (
    <div className="resource-list">
      {resources.map(([name, status, location, resourceId]) => (
        <article className="resource-row" key={resourceId || name}>
          <div className="resource-icon"><HiBuildingOffice2 /></div>
          <div>
            <b>{name}</b>
            <small>{location} · {status}</small>
          </div>
          <button
            onClick={() => resourceId ? setSelected({ id: resourceId, name }) : notify("No bookable resources are configured")}
          >
            Book <HiArrowRight />
          </button>
        </article>
      ))}
      {selected && <ModalShell kicker="RESOURCE BOOKING" title={selected.name} onClose={() => setSelected(null)}><label>Start<input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label><label>End<input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label><button className="primary wide" onClick={async () => { if (!authUser) { openLogin?.(); notify("Sign in to book a resource"); return; } try { const booking = await createResourceBooking({ userId: authUser.id, resourceId: selected.id, startTime, endTime }); onChange?.((items) => [...items, booking]); setSelected(null); notify("Booking requested"); } catch (error) { notify(error.message || "Could not create booking"); } }}>Request booking</button></ModalShell>}
      {bookings.map((booking) => <article className="resource-row" key={booking.id}><div className="resource-icon"><HiCalendarDays /></div><div><b>{booking.resources?.name}</b><small>{new Date(booking.start_time).toLocaleString()}</small></div><strong>{booking.status}</strong></article>)}
    </div>
  );
}

const LOST_FOUND_CATEGORIES = ["Electronics", "ID card", "Bag", "Documents", "Keys", "Clothing", "Other"];

function LostService({ notify, authUser, openLogin, campusId, items: dbItems = [], loaded = true, onChange }) {
  const [reporting, setReporting] = useState(false);
  const [itemType, setItemType] = useState("lost");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Other");
  const [location, setLocation] = useState("");

  const resetForm = () => {
    setItemType("lost");
    setTitle("");
    setDescription("");
    setCategory("Other");
    setLocation("");
  };

  if (loaded && dbItems.length === 0 && !reporting) {
    return (
      <div className="resource-list">
        <EmptyState
          icon={<HiMagnifyingGlassCircle />}
          title="No open reports right now"
          text="Nobody has reported a lost or found item yet. Be the first."
        />
        <button className="primary" onClick={() => setReporting(true)}>
          <HiPlus /> Report an item
        </button>
      </div>
    );
  }

  return (
    <div className="resource-list">
      {!loaded && <LoadingState label="Loading lost & found reports…" />}
      {loaded && dbItems.map((item) => (
        <article className="resource-row" key={item.id}>
          <div className="resource-icon"><HiMagnifyingGlassCircle /></div>
          <div>
            <b>{item.title}</b>
            <small>
              {item.item_type === "found" ? "Found" : "Lost"} · {item.category} · {item.location}
              {item.status === "claim_pending" ? " · Claim pending staff verification" : ""}
            </small>
          </div>
          {item.status === "claim_pending" ? (
            <strong>Pending</strong>
          ) : (
            <button onClick={async () => {
              if (!authUser) { openLogin?.(); notify("Sign in to claim an item"); return; }
              const proof = window.prompt("Describe how you can prove this item is yours (e.g. a unique mark, what's inside, receipt details). Staff will verify before handover.");
              if (!proof?.trim()) return;
              try {
                await claimLostFoundItem({ itemId: item.id, userId: authUser.id, proof });
                onChange?.((items) => items.map((i) => (i.id === item.id ? { ...i, status: "claim_pending" } : i)));
                notify("Claim submitted — staff will verify and contact you");
              } catch (error) {
                notify(error.message || "Could not claim item");
              }
            }}>
              Claim
            </button>
          )}
        </article>
      ))}
      <button className="primary" onClick={() => setReporting(true)}>
        <HiPlus /> Report an item
      </button>
      {reporting && (
        <ModalShell kicker="LOST & FOUND" title="Report an item" onClose={() => { setReporting(false); resetForm(); }}>
          <div className="segmented-toggle">
            <button type="button" className={itemType === "lost" ? "active" : ""} onClick={() => setItemType("lost")}>I lost something</button>
            <button type="button" className={itemType === "found" ? "active" : ""} onClick={() => setItemType("found")}>I found something</button>
          </div>
          <label>Item title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Black backpack" /></label>
          <label>Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {LOST_FOUND_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>{itemType === "found" ? "Where you found it" : "Last seen location"}<input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <label>Description (optional)<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Distinguishing details help the other person prove ownership" /></label>
          <button className="primary wide" onClick={async () => {
            if (!authUser) { openLogin?.(); notify("Sign in to report an item"); return; }
            try {
              const item = await createLostFoundItem({ userId: authUser.id, campusId, itemType, title, description, category, location });
              onChange?.((items) => [item, ...items]);
              setReporting(false);
              resetForm();
              notify(itemType === "found" ? "Found item reported — thanks for helping out" : "Lost item reported");
            } catch (error) {
              notify(error.message || "Could not report item");
            }
          }}>
            Submit report
          </button>
        </ModalShell>
      )}
    </div>
  );
}

// Real signed, short-lived pass -- mint_campus_pass()/verify_campus_pass()
// (supabase/migrations/20260814004400_digital_campus_pass.sql) HMAC-sign a
// ~90s token entirely in Postgres. This used to be a static <HiQrCode/>
// icon with a hardcoded fallback name/USN and a "Download" button that only
// fired a toast -- nothing here was real. Now the QR is a real token that
// visibly rotates while the modal is open, so a screenshot of it is
// worthless a minute later.
function PassService({ notify, user, authUser, openLogin }) {
  const [showPassModal, setShowPassModal] = useState(false);
  const [pass, setPass] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mintingRef = useRef(false);
  const tickTimer = useRef(null);

  const refreshPass = async () => {
    if (mintingRef.current) return;
    mintingRef.current = true;
    try {
      setLoading(true);
      setError("");
      const row = await mintCampusPass();
      setPass(row);
    } catch (err) {
      setError(err.message || "Could not generate your pass");
    } finally {
      setLoading(false);
      mintingRef.current = false;
    }
  };

  useEffect(() => {
    if (!showPassModal) return;
    refreshPass();
    return () => clearInterval(tickTimer.current);
  }, [showPassModal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pass?.token) { setQrDataUrl(""); return; }
    let cancelled = false;
    QRCode.toDataURL(pass.token, { width: 240, margin: 1, color: { dark: "#17151f", light: "#ffffff" } })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pass?.token]);

  useEffect(() => {
    if (!pass?.expires_at) return;
    clearInterval(tickTimer.current);
    const tick = () => {
      const secs = Math.max(0, Math.round((new Date(pass.expires_at).getTime() - Date.now()) / 1000));
      setSecondsLeft(secs);
      if (secs <= 4) refreshPass();
    };
    tick();
    tickTimer.current = setInterval(tick, 1000);
    return () => clearInterval(tickTimer.current);
  }, [pass?.expires_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayName = pass?.holder_name || user?.name || "";
  const displayUsn = pass?.holder_usn || user?.usn || "";

  return (
    <div className="digital-pass-card">
      <div className="qr-placeholder">
        <HiQrCode />
      </div>
      <div>
        <span className="section-kicker">STUDENT PASS</span>
        <h2>NHCE{displayName ? ` · ${displayName.toUpperCase()}` : ""}</h2>
        <p>A signed pass that refreshes every few seconds -- valid for events, workshops, pickups and facilities check-ins.</p>
        <button
          className="primary"
          onClick={() => {
            if (!authUser) { openLogin?.(); notify("Sign in to get your campus pass"); return; }
            setShowPassModal(true);
          }}
        >
          Display QR <HiQrCode />
        </button>
      </div>

      {showPassModal && (
        <ModalShell kicker="VERIFIED CAMPUS PASS" title="Digital Identity Pass" onClose={() => setShowPassModal(false)}>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            {loading && !pass && <p style={{ color: "var(--muted)" }}>Generating your pass…</p>}
            {error && !pass && <p style={{ color: "#c23a3a" }}>{error}</p>}
            {qrDataUrl && (
              <div style={{ width: "180px", height: "180px", margin: "0 auto 16px", background: "#fff", borderRadius: "16px", display: "grid", placeItems: "center", border: "2px solid #6e48ed", padding: "10px" }}>
                <img src={qrDataUrl} alt="Campus pass QR code" style={{ width: "100%", height: "100%" }} />
              </div>
            )}
            <h3 style={{ margin: "4px 0", font: "800 20px Manrope" }}>{displayName}</h3>
            <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: "13px" }}>
              {displayUsn ? `USN: ${displayUsn} · ` : ""}NHCE
            </p>
            <span style={{ background: "#e4f7ef", color: "#13845b", padding: "6px 14px", borderRadius: "999px", fontSize: "11px", fontWeight: "800" }}>
              ACTIVE · VERIFIED
            </span>
            {pass && (
              <p style={{ marginTop: "14px", fontSize: "11px", color: "var(--muted)" }}>
                <HiArrowPath style={{ verticalAlign: "-2px" }} /> Refreshes in {secondsLeft}s -- this code changes automatically, a screenshot won&apos;t work for long.
              </p>
            )}
          </div>
          <button className="primary wide" disabled={loading} onClick={refreshPass}>
            {loading ? "Refreshing…" : "Refresh now"} <HiArrowPath />
          </button>
        </ModalShell>
      )}
    </div>
  );
}

function HostelService({ notify, go }) {
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [showLaundryModal, setShowLaundryModal] = useState(false);
  const [laundrySlot, setLaundrySlot] = useState("4:00 PM - 5:00 PM");

  return (
    <div className="hostel-grid">
      <WorkflowCard icon={<HiHomeModern />} title="Room" text="B-204 · Occupied" button="Open" onClick={() => setShowRoomModal(true)} />
      <WorkflowCard icon={<HiShoppingBag />} title="Mess" text="Today's menu available." button="View menu" onClick={() => go?.("food")} />
      <WorkflowCard icon={<HiWrenchScrewdriver />} title="Maintenance" text="2 open requests." button="Track" onClick={() => go?.("issues")} />
      <WorkflowCard icon={<HiArrowPath />} title="Laundry" text="12 slots available." button="Book" onClick={() => setShowLaundryModal(true)} />

      {showRoomModal && (
        <ModalShell kicker="HOSTEL ROOM" title="Room B-204 Details" onClose={() => setShowRoomModal(false)}>
          <div style={{ padding: "12px 0" }}>
            <p><strong>Block:</strong> Boys Hostel Block B (2nd Floor)</p>
            <p><strong>Roommate:</strong> Rahul Sharma (CSE 3rd Year)</p>
            <p><strong>Wi-Fi:</strong> Hostel_5G_Zone (Connected)</p>
            <p><strong>Status:</strong> All fees cleared for current semester</p>
          </div>
          <button className="primary wide" onClick={() => setShowRoomModal(false)}>Close</button>
        </ModalShell>
      )}

      {showLaundryModal && (
        <ModalShell kicker="LAUNDRY BOOKING" title="Reserve Laundry Machine" onClose={() => setShowLaundryModal(false)}>
          <label>Select Time Slot
            <select value={laundrySlot} onChange={(e) => setLaundrySlot(e.target.value)} style={{ width: "100%", padding: "10px", marginTop: "6px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              <option>2:00 PM - 3:00 PM</option>
              <option>4:00 PM - 5:00 PM</option>
              <option>5:00 PM - 6:00 PM</option>
              <option>7:00 PM - 8:00 PM</option>
            </select>
          </label>
          <button className="primary wide" style={{ marginTop: "16px" }} onClick={() => { notify(`Laundry reserved for ${laundrySlot}`); setShowLaundryModal(false); }}>
            Confirm Booking <HiArrowRight />
          </button>
        </ModalShell>
      )}
    </div>
  );
}

function DeliveryService({ notify }) {
  const [activeDelivery, setActiveDelivery] = useState(null);

  return (
    <div className="delivery-panel">
      <div className="delivery-route">
        <div><span>FROM</span><b>Udupi Canteen</b></div>
        <div className="route-line"><i /></div>
        <div><span>TO</span><b>Block C · 302</b></div>
      </div>
      <div className="route-stats">
        <span><HiClock /> 7 min</span>
        <span><HiTruck /> Robot available</span>
        <span><HiBolt /> Low traffic</span>
      </div>
      {activeDelivery ? (
        <div style={{ background: "#eee9ff", color: "#6241db", padding: "14px", borderRadius: "14px", margin: "16px 0", textAlign: "center" }}>
          <b>Delivery En Route!</b>
          <p style={{ margin: "4px 0", fontSize: "12px" }}>ETA: 6 minutes · Code: {activeDelivery.code}</p>
        </div>
      ) : null}
      <button className="primary" onClick={() => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        setActiveDelivery({ code });
        notify(`Delivery order dispatched · Code ${code}`);
      }}>
        Request delivery <HiTruck />
      </button>
    </div>
  );
}

/* =========================================================
   MAP
========================================================= */

/* =========================================================
   PRIVACY POLICY & TERMS OF SERVICE (doc §102)
   Written specifically for what CampusOS actually collects/does today, not
   generic boilerplate -- but this is a starting draft, not legal advice.
   Have your institution's counsel review it before relying on it for real.
========================================================= */

function LegalContent() {
  return (
    <div className="legal-content">
      <h2>Privacy Policy</h2>
      <p><em>Last updated 14 August 2026.</em></p>

      <h3>What we collect</h3>
      <p>
        Account info (name, USN, course, year, college email), anything you
        add to your profile (bio, skills, achievements, LinkedIn/GitHub
        links), and activity you generate using CampusOS: food orders,
        event registrations, club memberships, marketplace listings, lost
        &amp; found reports, facilities tickets, resource bookings, print
        jobs, and posts/comments/likes. If you submit your student ID for
        verification, that photo is stored privately and reviewed by campus
        admin staff only.
      </p>

      <h3>How it&apos;s used</h3>
      <p>
        To run the features you use — placing orders, registering for
        events, connecting you with classmates in your branch/year, routing
        tickets to facilities staff, and processing payments through
        Razorpay for anything you pay for. Your name/branch/year/skills are
        visible to other verified students on this campus (see Connect);
        your email and phone number are never shown to other students.
      </p>

      <h3>Who it&apos;s shared with</h3>
      <p>
        Never sold. Vendors (canteens, the print shop) see the order/job
        details needed to fulfill what you ordered. Campus admins and
        facilities staff can see what&apos;s needed to moderate content, review
        reports, and resolve tickets — every privileged action is logged.
        Payments are processed by Razorpay; we don&apos;t store your card
        details.
      </p>

      <h3>Your choices</h3>
      <p>
        You can edit or remove most profile info yourself at any time. You
        can set your profile to be hidden from the classmate directory in
        Edit Profile. To request a copy of your data or ask us to delete
        your account, contact your campus admin.
      </p>

      <h2>Terms of Service</h2>

      <h3>Your account</h3>
      <p>
        One account per student, tied to a valid USN or college email.
        You&apos;re responsible for what happens under your account — don&apos;t
        share your password. Accounts can be suspended for violating these
        terms (spam, harassment, fraudulent orders/listings, impersonation,
        or abuse of any campus service); a suspended account cannot place
        orders, post, register for events, book resources, or use any
        other feature until reactivated by a campus admin.
      </p>

      <h3>Payments &amp; orders</h3>
      <p>
        Prices shown at checkout are final at the time of payment. Refunds
        for cancelled or failed orders are processed back to your original
        payment method — contact the vendor or a campus admin if a refund
        doesn&apos;t appear within a reasonable time. Vendors are responsible
        for the accuracy of their own menu/pricing.
      </p>

      <h3>Marketplace &amp; lost &amp; found</h3>
      <p>
        Listings and reports must be accurate. CampusOS is a venue
        connecting students directly — we aren&apos;t a party to any sale and
        don&apos;t guarantee the condition or existence of listed items.
      </p>

      <h3>Content you post</h3>
      <p>
        Don&apos;t post anything illegal, harassing, or that violates someone
        else&apos;s privacy or rights. Reported content is reviewed by campus
        moderators, who can hide or remove it and take action on the
        account that posted it.
      </p>

      <h3>Changes</h3>
      <p>
        We may update these terms as CampusOS adds features; continuing to
        use the app after a change means you accept the update.
      </p>
    </div>
  );
}

function LegalPage({ go }) {
  return (
    <section className="page-section">
      <PageHeader kicker="LEGAL" title="Privacy & Terms" text="How CampusOS handles your data, and what's expected of you." />
      <div className="profile-box profile-wide-box">
        <LegalContent />
      </div>
      {go && (
        <button className="ghost" style={{ marginTop: 16 }} onClick={() => go("profile")}>
          <HiArrowLeft /> Back to profile
        </button>
      )}
    </section>
  );
}

// Landed on directly from an emailed link (?token=...) -- no session
// assumed, works signed in or out, same as LegalPage above. Query strings
// survive pathToKey()'s pathname-only routing untouched, so the token is
// still readable off window.location.search here.
function VerifyEmailPage({ go }) {
  const [status, setStatus] = useState("verifying"); // verifying | done | error
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("error");
      setError("No verification token in this link.");
      return;
    }
    confirmContactEmailVerification(token)
      .then(() => setStatus("done"))
      .catch((err) => {
        setStatus("error");
        setError(err.message || "This verification link is invalid or has expired.");
      });
  }, []);

  return (
    <section className="page-section">
      <PageHeader kicker="ACCOUNT" title="Verify email" text="Confirming your contact email." />
      <div className="profile-box profile-wide-box">
        {status === "verifying" && <LoadingState label="Verifying…" />}
        {status === "done" && (
          <EmptyState icon={<HiCheckCircle />} title="Email verified" text="Password recovery and email notifications are now available on this account." />
        )}
        {status === "error" && (
          <EmptyState icon={<HiXMark />} title="Couldn't verify" text={error} />
        )}
        {go && (
          <button className="ghost" style={{ marginTop: 16 }} onClick={() => go("home")}>
            <HiArrowLeft /> Back to CampusOS
          </button>
        )}
      </div>
    </section>
  );
}

// Landed on directly from an emailed password-reset link. Deliberately
// doesn't check whether anyone is signed in -- "forgot my password" only
// makes sense signed out, and this token IS the authorization (see
// confirm-password-reset, which validates it server-side and never trusts
// auth.uid()).
function ResetPasswordPage({ go, notify }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const token = new URLSearchParams(window.location.search).get("token");

  const handleSubmit = async () => {
    if (!token) { notify("This reset link is missing its token."); return; }
    if (!password || password.length < 8) { notify("Password must be at least 8 characters"); return; }
    if (password !== confirmPassword) { notify("Passwords don't match"); return; }
    try {
      setLoading(true);
      await confirmPasswordReset(token, password);
      setDone(true);
      notify("Password reset -- sign in with your new password");
    } catch (error) {
      notify(error.message || "Unable to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="page-section">
      <PageHeader kicker="ACCOUNT" title="Reset password" text="Choose a new password for your account." />
      <div className="profile-box profile-wide-box">
        {!token && <EmptyState icon={<HiXMark />} title="Invalid link" text="This reset link is missing its token." />}
        {token && done && (
          <EmptyState icon={<HiCheckCircle />} title="Password reset" text="Sign in with your new password." />
        )}
        {token && !done && (
          <>
            <label>
              New password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoFocus />
            </label>
            <label>
              Confirm password
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
            </label>
            <button className="primary wide" disabled={loading} onClick={handleSubmit}>
              {loading ? "Resetting…" : "Reset password"}
            </button>
          </>
        )}
        {go && (
          <button className="ghost" style={{ marginTop: 16 }} onClick={() => go("home")}>
            <HiArrowLeft /> Back to CampusOS
          </button>
        )}
      </div>
    </section>
  );
}

function CampusMap({ notify, openModal }) {
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState("");

  const results = mapLocations.filter((location) =>
    location.name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <section className="page-section map-page">
      <PageHeader
        kicker="SMART CAMPUS"
        title="Campus Map"
        text="Find buildings, rooms, services and future autonomous routes."
        action={
          <button
            className="primary"
            onClick={() => openModal("navigation")}
          >
            <HiMapPin /> Navigate
          </button>
        }
      />

      <div className="map-search-row">
        <div className="searchbar compact">
          <HiMagnifyingGlass />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Lab 302, canteen, auditorium..."
          />
        </div>

        <div className="map-quick">
          {["Lab 302", "Innovation Lab", "Canteen 4", "Main Auditorium"].map(
            (item) => (
              <button
                key={item}
                onClick={() => {
                  setQ(item);
                  notify(`${item} selected`);
                }}
              >
                {item}
              </button>
            )
          )}
        </div>
      </div>

      <div className="map-layout">
        <div className="campus-map">
          <div className="map-roads" />

          {mapLocations.map((location) => (
            <button
              key={location.id}
              className={`map-marker ${
                selected?.id === location.id ? "selected" : ""
              }`}
              style={{
                left: `${location.x}%`,
                top: `${location.y}%`,
              }}
              onClick={() => setSelected(location)}
            >
              <span>
                {location.type === "Food" ? (
                  <HiShoppingBag />
                ) : location.type === "Events" ? (
                  <HiCalendarDays />
                ) : location.type === "Laboratory" ? (
                  <HiCpuChip />
                ) : (
                  <HiBuildingOffice2 />
                )}
              </span>
              <b>{location.name}</b>
            </button>
          ))}

          <div className="you-marker">
            <span />
            <small>You are here</small>
          </div>
        </div>

        <aside className="map-panel">
          <span className="section-kicker">LOCATIONS</span>

          {results.map((location) => (
            <button
              className={selected?.id === location.id ? "selected" : ""}
              key={location.id}
              onClick={() => setSelected(location)}
            >
              <span>{location.name}</span>
              <small>{location.type}</small>
              <HiChevronRight />
            </button>
          ))}

          {selected && (
            <div className="location-detail">
              <span className="section-kicker">{selected.type}</span>
              <h3>{selected.name}</h3>
              <p>{selected.rooms} rooms / facilities</p>
              <button
                onClick={() => openModal("navigation")}
                className="primary"
              >
                Get Directions <HiArrowRight />
              </button>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

/* =========================================================
   CAMPUS AI
========================================================= */

// doc §16 "AI Action System" -- one executor per propose_* action type. Each
// of these is the *exact* function/RPC the manual UI already calls for that
// action (registerEvent/createCampusServiceRequest/createResourceBooking/
// createReminder/addFood) -- the AI layer never gets its own write path or
// elevated privilege, it only ever gets to trigger one of these, and only
// after the student clicks Confirm. Every one of these already re-validates
// server-side (RLS + the RPC's own checks) regardless of what the model
// proposed, so a hallucinated/stale action id just fails cleanly here.
const AI_ACTION_EXECUTORS = {
  add_to_food_cart: async (action, ctx) => {
    const item = {
      id: action.foodItemId,
      name: action.name,
      price: action.price,
      canteenId: action.canteenId,
      vendor: action.canteenName,
      category: "Food",
      image: "",
      description: "",
      veg: false,
      vegetarian: false,
      available: true,
    };
    const qty = Math.max(1, Number(action.quantity) || 1);
    for (let i = 0; i < qty; i++) ctx.addFood(item);
    return `Added ${qty}x ${action.name} to your food cart.`;
  },
  register_event: async (action, ctx) => {
    if (!isValidPhone(ctx.phone)) throw new Error("Enter a valid phone number to register.");
    const result = await registerEvent({
      eventId: action.eventId,
      userId: ctx.authUser.id,
      contactPhone: ctx.phone,
      contactName: ctx.profile?.name || ctx.authUser.email || "Student",
      rollNumber: ctx.profile?.roll_number,
      department: ctx.profile?.department,
    });
    return result?.status === "waitlisted"
      ? `You're on the waitlist for "${action.eventTitle}".`
      : `You're registered for "${action.eventTitle}"!`;
  },
  service_request: async (action, ctx) => {
    await createCampusServiceRequest({
      userId: ctx.authUser.id,
      campusId: ctx.campusId,
      serviceName: action.serviceName,
      title: action.title,
      details: action.description ? { description: action.description } : {},
    });
    return `Submitted your "${action.serviceName}" request.`;
  },
  booking: async (action, ctx) => {
    await createResourceBooking({
      userId: ctx.authUser.id,
      resourceId: action.resourceId,
      startTime: action.startTime,
      endTime: action.endTime,
      notes: action.notes || "",
    });
    return `Booked "${action.resourceName}".`;
  },
  reminder: async (action) => {
    await createReminder({ title: action.title, remindAt: action.remindAt, notes: action.notes || "", source: "ai" });
    return `Reminder set: "${action.title}".`;
  },
  apply_to_team: async (action) => {
    await applyToTeam(action.teamId, action.message || null);
    return `Applied to join "${action.teamTitle}".`;
  },
};

function ActionCard({ action, onConfirm, onCancel, phone, onPhoneChange }) {
  const needsPhone = action.type === "register_event" && !phone;
  const busy = action.status === "confirming";
  const done = action.status === "confirmed" || action.status === "cancelled" || action.status === "error";

  return (
    <div className={`ai-action-card ${action.status || "pending"}`}>
      <div className="ai-action-card-head">
        <HiSparkles />
        <b>{action.label}</b>
      </div>

      {action.status === "confirmed" && <p className="ai-action-result success"><HiCheckCircle /> {action.resultText}</p>}
      {action.status === "cancelled" && <p className="ai-action-result">Cancelled -- nothing was changed.</p>}
      {action.status === "error" && <p className="ai-action-result error"><HiExclamationTriangle /> {action.resultText}</p>}

      {!done && (
        <>
          {action.type === "register_event" && (
            <label className="ai-action-phone">
              Contact phone
              <input
                value={phone}
                onChange={(e) => onPhoneChange(e.target.value)}
                placeholder="Required to register"
                disabled={busy}
              />
            </label>
          )}
          <div className="ai-action-buttons">
            <button className="primary" disabled={busy || needsPhone} onClick={onConfirm}>
              {busy ? "Working…" : "Confirm"}
            </button>
            <button className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function CampusAI({ notify, go, authUser, profile, campusId, addFood, openLogin }) {
  const [message, setMessage] = useState("");
  const [asking, setAsking] = useState(false);

  const [conversation, setConversation] = useState([
    {
      role: "ai",
      text:
        "Hi! I'm a real assistant with live access to CampusOS — ask me about the food menu, upcoming events, open opportunities, mentors, teams looking for teammates, the store, or your own orders and registrations. I can also draft real actions for you (add food to your cart, register for an event, submit a service request, book a resource, set a reminder, apply to join a team) -- you'll always get a chance to confirm before anything actually happens.",
    },
  ]);
  const [phoneDrafts, setPhoneDrafts] = useState({}); // messageIndex -> phone string, for register_event cards

  const suggestions = [
    "What's on the food menu right now?",
    "What events are coming up?",
    "Remind me to pay hostel fees this Friday at 6pm",
    "Any internships or research openings?",
    "Find me a hackathon team that needs a React developer",
    "What are my recent orders?",
  ];

  const ask = async (value = message) => {
    if (!value.trim() || asking) return;

    if (!authUser) {
      openLogin?.();
      notify("Sign in to chat with the campus assistant");
      return;
    }

    const nextConversation = [...conversation, { role: "user", text: value }];
    setConversation(nextConversation);
    setMessage("");
    setAsking(true);

    try {
      const { reply, pendingAction, navigateTo, sources } = await askCampusAssistant(
        nextConversation.map((m) => ({ role: m.role, content: m.text }))
      );
      setConversation((current) => [
        ...current,
        { role: "ai", text: reply, sources, action: pendingAction ? { ...pendingAction, status: "pending" } : undefined },
      ]);
      if (pendingAction?.type === "register_event" && profile?.phone) {
        setPhoneDrafts((current) => ({ ...current, [nextConversation.length]: profile.phone }));
      }
      if (navigateTo) {
        notify(`Taking you to ${navigateTo}…`);
        go(navigateTo);
      }
    } catch (error) {
      setConversation((current) => [
        ...current,
        { role: "ai", text: error.message || "Something went wrong — try again in a moment." },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const updateAction = (index, patch) => {
    setConversation((current) => current.map((item, i) => (i === index ? { ...item, action: { ...item.action, ...patch } } : item)));
  };

  const confirmAction = async (index) => {
    const action = conversation[index]?.action;
    if (!action) return;
    const executor = AI_ACTION_EXECUTORS[action.type];
    if (!executor) return;

    updateAction(index, { status: "confirming" });
    try {
      const resultText = await executor(action, { authUser, profile, campusId, addFood, phone: phoneDrafts[index] || "" });
      updateAction(index, { status: "confirmed", resultText });
      notify(resultText);
      logAiAction(action.type, action, "confirmed", resultText);
    } catch (error) {
      const resultText = error.message || "Could not complete that action";
      updateAction(index, { status: "error", resultText });
      logAiAction(action.type, action, "error", resultText);
    }
  };

  const cancelAction = (index) => {
    const action = conversation[index]?.action;
    updateAction(index, { status: "cancelled" });
    if (action) logAiAction(action.type, action, "cancelled");
  };

  // Feedback loop (doc "AI" checklist): thumbs up/down, "report wrong
  // answer" prompts for a short reason on down-votes only (same
  // window.prompt-for-a-reason convention this file already uses for
  // suspend/reject actions elsewhere) -- up-votes need no extra detail.
  const sendFeedback = async (index, rating) => {
    const item = conversation[index];
    if (!item || item.feedback?.rating) return;
    let reportReason = null;
    if (rating === "down") {
      reportReason = window.prompt("What was wrong with this answer? (optional)") || null;
    }
    setConversation((current) => current.map((it, i) => (i === index ? { ...it, feedback: { rating, sending: true } } : it)));
    try {
      await submitAiFeedback(item.text, rating, reportReason);
      setConversation((current) => current.map((it, i) => (i === index ? { ...it, feedback: { rating, reported: !!reportReason, sending: false } } : it)));
      notify(rating === "up" ? "Thanks for the feedback!" : "Thanks -- flagged for review.");
    } catch (error) {
      setConversation((current) => current.map((it, i) => (i === index ? { ...it, feedback: null } : it)));
      notify(error.message || "Could not send feedback");
    }
  };

  return (
    <section className="page-section ai-page">
      <div className="ai-header">
        <span className="ai-large-icon">
          <HiSparkles />
        </span>
        <div>
          <span className="section-kicker">CAMPUS INTELLIGENCE</span>
          <h1>Campus AI</h1>
          <p>Natural language access to your campus -- and real actions, with your confirmation.</p>
        </div>
      </div>

      <div className="ai-shell">
        <div className="ai-chat">
          {conversation.map((item, index) => (
            <div
              className={`ai-message ${item.role}`}
              key={index}
            >
              <span>
                {item.role === "ai" ? <HiSparkles /> : <HiUserCircle />}
              </span>
              <div>
                <p>{item.text}</p>
                {item.role === "ai" && item.sources?.length > 0 && (
                  <p className="ai-sources">Sourced from: {item.sources.join(", ")}</p>
                )}
                {item.action && (
                  <ActionCard
                    action={item.action}
                    phone={phoneDrafts[index] || ""}
                    onPhoneChange={(value) => setPhoneDrafts((current) => ({ ...current, [index]: value }))}
                    onConfirm={() => confirmAction(index)}
                    onCancel={() => cancelAction(index)}
                  />
                )}
                {item.role === "ai" && index > 0 && (
                  <div className="ai-feedback-row">
                    <button
                      className={item.feedback?.rating === "up" ? "ai-feedback-btn active" : "ai-feedback-btn"}
                      disabled={!!item.feedback?.rating}
                      onClick={() => sendFeedback(index, "up")}
                      title="Good answer"
                    >
                      <HiHandThumbUp />
                    </button>
                    <button
                      className={item.feedback?.rating === "down" ? "ai-feedback-btn active" : "ai-feedback-btn"}
                      disabled={!!item.feedback?.rating}
                      onClick={() => sendFeedback(index, "down")}
                      title="Report wrong answer"
                    >
                      <HiHandThumbDown />
                    </button>
                    {item.feedback?.rating === "down" && item.feedback?.reported && (
                      <span className="ai-feedback-reported"><HiFlag /> Reported</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {asking && (
            <div className="ai-message ai">
              <span><HiSparkles /></span>
              <p style={{ color: "var(--muted)" }}>Thinking…</p>
            </div>
          )}

          <div className="ai-suggestions">
            {suggestions.map((suggestion) => (
              <button key={suggestion} disabled={asking} onClick={() => ask(suggestion)}>
                {suggestion}
                <HiArrowRight />
              </button>
            ))}
          </div>
        </div>

        <div className="ai-input">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder={authUser ? "Ask Campus AI..." : "Sign in to ask Campus AI..."}
            disabled={asking}
          />
          <button disabled={asking || !message.trim()} onClick={() => ask()}>
            <HiPaperAirplane />
          </button>
        </div>
      </div>

      <div className="ai-capabilities">
        <Capability icon={<HiUserGroup />} title="People" text="Find teammates and mentors" />
        <Capability icon={<HiMap />} title="Places" text="Search campus locations" />
        <Capability icon={<HiWrenchScrewdriver />} title="Services" text="Start campus workflows" />
        <Capability icon={<HiCpuChip />} title="Hardware" text="Monitor connected devices" />
      </div>

      <div className="opportunity">
        <div>
          <span className="section-kicker">NOW LIVE</span>
          <h2>AI that can act, not just answer.</h2>
          <p>
            Ask it to add food to your cart, register you for an event, file
            a service request, book a resource, or set a reminder -- it
            drafts the action and always waits for your Confirm before
            anything real happens.
          </p>
        </div>

        <button onClick={() => go("autonomous")}>
          Explore Autonomous Campus <HiArrowRight />
        </button>
      </div>
    </section>
  );
}

function Capability({ icon, title, text }) {
  return (
    <div className="capability">
      <span>{icon}</span>
      <b>{title}</b>
      <small>{text}</small>
    </div>
  );
}

/* =========================================================
   AUTONOMOUS CAMPUS
========================================================= */

function AutonomousCampus({ notify, devices }) {
  return (
    <section className="page-section autonomous-page">
      <PageHeader
        kicker="FUTURE INFRASTRUCTURE"
        title="Autonomous Campus"
        text="A digital control layer for robots, drones, IoT and AI systems."
        action={
          <button
            className="primary"
            onClick={() => notify("Device provisioning opened")}
          >
            <HiPlus /> Add device
          </button>
        }
      />

      <div className="autonomous-hero">
        <div>
          <span className="section-kicker">CAMPUS DIGITAL TWIN</span>
          <h2>People, services and machines in one system.</h2>
          <p>
            Future hardware can plug into the same campus identity, location,
            permissions and event infrastructure.
          </p>
        </div>

        <div className="system-pulse">
          <span />
          <b>System operational</b>
          <small>99.8% simulated uptime</small>
        </div>
      </div>

      <div className="device-grid">
        {devices.map((device) => (
          <DeviceCard key={device.id} device={device} notify={notify} />
        ))}
      </div>

      <div className="hardware-flow">
        <div>
          <span className="section-kicker">REFERENCE ARCHITECTURE</span>
          <h2>Hardware → Campus OS → AI → Action</h2>
        </div>

        <div className="flow-row">
          <Flow icon={<HiSignal />} title="Telemetry" />
          <HiArrowRight />
          <Flow icon={<HiCpuChip />} title="Campus OS" />
          <HiArrowRight />
          <Flow icon={<HiSparkles />} title="AI" />
          <HiArrowRight />
          <Flow icon={<HiRocketLaunch />} title="Action" />
        </div>
      </div>

      <div className="autonomous-grid">
        <StatCard label="IoT devices" value="48" icon={<HiSignal />} />
        <StatCard label="Robots" value="3" icon={<HiTruck />} />
        <StatCard label="Drones" value="1" icon={<HiPaperAirplane />} />
        <StatCard label="Automation events" value="284" icon={<HiBolt />} />
      </div>
    </section>
  );
}

function DeviceCard({ device, notify }) {
  return (
    <article className="device-card">
      <div className="device-head">
        <span>{device.icon}</span>
        <div>
          <span className="event-club">{device.type}</span>
          <h3>{device.name}</h3>
        </div>
        <span className="online-dot" />
      </div>

      <div className="device-data">
        <div>
          <small>Status</small>
          <b>{device.status}</b>
        </div>
        <div>
          <small>Battery</small>
          <b>{device.battery}%</b>
        </div>
        <div>
          <small>Location</small>
          <b>{device.location}</b>
        </div>
      </div>

      <div className="battery-bar">
        <i style={{ width: `${device.battery}%` }} />
      </div>

      <button onClick={() => notify(`${device.name} control panel opened`)}>
        Open control panel <HiArrowRight />
      </button>
    </article>
  );
}

function Flow({ icon, title }) {
  return (
    <div className="flow-item">
      <span>{icon}</span>
      <b>{title}</b>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

/* =========================================================
   CALENDAR
========================================================= */

function MyCalendar({ notify, events }) {
  const eventDays = new Set(events.map((event) => Number(event.date)).filter(Boolean));
  const monthName = events[0]?.month ? `${events[0].month[0]}${events[0].month.slice(1).toLowerCase()}` : "August";
  return (
    <section className="page-section">
      <PageHeader
        kicker="PERSONAL SCHEDULE"
        title="My Calendar"
        text="Your campus events, registrations and reminders."
      />

      <div className="calendar-layout">
        <div className="calendar-box">
          <div className="calendar-header">
            <h3>{monthName} 2026</h3>
            <button onClick={() => notify("Calendar synced")}>
              <HiArrowPath />
            </button>
          </div>

          <div className="weekdays">
            {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
              <span key={`${day}-${index}`}>{day}</span>
            ))}
          </div>

          <div className="calendar-days">
            {Array.from({ length: 31 }, (_, index) => {
              const day = index + 1;
              const hasEvent = eventDays.has(day);
              return (
                <button
                  key={day}
                  className={`${day === 10 ? "today " : ""}${
                    hasEvent ? "has-event" : ""
                  }`}
                  onClick={() =>
                    notify(
                      hasEvent
                        ? `August ${day}: event scheduled`
                        : `August ${day} selected`
                    )
                  }
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="calendar-agenda">
          <span className="section-kicker">UPCOMING</span>
          {events.map((event) => (
            <div className="agenda-item" key={event.id}>
              <b>{event.date}</b>
              <div>
                <strong>{event.title}</strong>
                <small>{event.time} · {event.place}</small>
              </div>
              <HiChevronRight />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   NOTIFICATIONS
========================================================= */

// The real delivery channel behind push_subscriptions/notification_preferences
// .channel_push -- both existed since the 0010 migration with nothing ever
// writing a subscription row. See src/services/pushService.js.
function PushToggle({ authUser, notify }) {
  const [status, setStatus] = useState("checking"); // checking | unsupported | denied | subscribed | not-subscribed
  const [busy, setBusy] = useState(false);

  const refreshStatus = () => {
    getPushSubscriptionStatus().then(setStatus).catch(() => setStatus("unsupported"));
  };

  useEffect(() => { refreshStatus(); }, []);

  if (!isPushSupported()) return null;

  const toggle = async () => {
    if (!authUser) { notify("Sign in to enable push notifications"); return; }
    try {
      setBusy(true);
      if (status === "subscribed") {
        await unsubscribeFromPush(authUser.id);
        notify("Push notifications turned off");
      } else {
        await subscribeToPush(authUser.id);
        notify("Push notifications enabled");
      }
      refreshStatus();
    } catch (error) {
      notify(error.message || "Could not update push notification settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="push-toggle-row">
      <div>
        <b>Push notifications</b>
        <small>
          {status === "denied"
            ? "Blocked in your browser settings -- enable notifications for this site to turn this on."
            : status === "subscribed"
            ? "You'll get a push on this device for new messages, orders and announcements."
            : "Get a push on this device for new messages, order updates and announcements."}
        </small>
      </div>
      <button className={status === "subscribed" ? "chip active" : "chip"} disabled={busy || status === "denied" || status === "checking"} onClick={toggle}>
        {busy ? "…" : status === "subscribed" ? "On" : "Off"}
      </button>
    </div>
  );
}

const NOTIFICATION_CATEGORIES = [
  ["messages", "Messages", "New DMs and marketplace conversations"],
  ["events", "Events", "Registrations, reminders and updates"],
  ["clubs", "Clubs", "Club announcements and membership updates"],
  ["marketplace", "Marketplace", "Activity on your listings and offers"],
  ["food", "Food & orders", "Order status updates"],
  ["services", "Services", "Booking and service-request updates"],
  ["community", "Community", "Replies and activity on your posts"],
  ["announcements", "Announcements", "Official campus announcements"],
];

// Every category here has been individually enforced server-side since
// 20260814004600 (create_notification()'s own v_col gate) -- this panel is
// what was actually missing: nothing anywhere in the app ever read or wrote
// notification_preferences, so a student had no way to turn any of these
// off short of disabling push entirely.
function NotificationPreferencesPanel({ authUser, notify }) {
  const [prefs, setPrefs] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  useEffect(() => {
    if (!authUser?.id) return;
    getNotificationCategoryPreferences(authUser.id).then(setPrefs).catch(() => {});
  }, [authUser?.id]);

  if (!authUser?.id || !prefs) return null;

  const toggle = async (key) => {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    setBusyKey(key);
    try {
      await setNotificationCategoryPreference(authUser.id, key, next);
    } catch (err) {
      setPrefs((p) => ({ ...p, [key]: !next }));
      notify(err.message || "Could not update this preference");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="notification-prefs">
      <span className="section-kicker">NOTIFY ME ABOUT</span>
      {NOTIFICATION_CATEGORIES.map(([key, label, hint]) => (
        <label key={key} className="notification-pref-row">
          <div>
            <b>{label}</b>
            <small>{hint}</small>
          </div>
          <input type="checkbox" checked={!!prefs[key]} disabled={busyKey === key} onChange={() => toggle(key)} />
        </label>
      ))}
    </div>
  );
}

// Channel delivery (push already had its own toggle above this panel;
// email is real as of 20260817001600 -- default off, opt-in here) and
// quiet hours (20260817001300 -- suppresses push/email/sms, never the
// in-app notification itself, and emergency alerts always bypass it).
function NotificationChannelPanel({ authUser, profile, notify }) {
  const [chan, setChan] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!authUser?.id) return;
    getNotificationChannelPreferences(authUser.id).then(setChan).catch(() => {});
  }, [authUser?.id]);

  if (!authUser?.id || !chan) return null;

  const canEmail = !!profile?.contact_email_verified_at || (!!authUser?.email && !authUser.email.endsWith("@usn.campusos.internal"));
  const canSms = !!profile?.phone;

  const toggleEmail = async () => {
    if (!canEmail) { notify("Add and verify a contact email in your Profile first"); return; }
    const next = !chan.channel_email;
    setChan((c) => ({ ...c, channel_email: next }));
    setBusy("email");
    try {
      await setNotificationChannelPreference(authUser.id, "channel_email", next);
      notify(next ? "Email notifications enabled" : "Email notifications turned off");
    } catch (err) {
      setChan((c) => ({ ...c, channel_email: !next }));
      notify(err.message || "Could not update this preference");
    } finally {
      setBusy(null);
    }
  };

  const toggleSms = async () => {
    if (!canSms) { notify("Add a phone number in your Profile first"); return; }
    const next = !chan.channel_sms;
    setChan((c) => ({ ...c, channel_sms: next }));
    setBusy("sms");
    try {
      await setNotificationChannelPreference(authUser.id, "channel_sms", next);
      notify(next ? "SMS notifications enabled" : "SMS notifications turned off");
    } catch (err) {
      setChan((c) => ({ ...c, channel_sms: !next }));
      notify(err.message || "Could not update this preference");
    } finally {
      setBusy(null);
    }
  };

  const toggleQuietHours = async () => {
    const next = !chan.quiet_hours_enabled;
    setChan((c) => ({ ...c, quiet_hours_enabled: next }));
    setBusy("quiet");
    try {
      await setQuietHours(authUser.id, { enabled: next });
    } catch (err) {
      setChan((c) => ({ ...c, quiet_hours_enabled: !next }));
      notify(err.message || "Could not update quiet hours");
    } finally {
      setBusy(null);
    }
  };

  const changeQuietRange = async (field, value) => {
    const prevValue = chan[field];
    setChan((c) => ({ ...c, [field]: value + ":00" }));
    try {
      await setQuietHours(authUser.id, {
        enabled: chan.quiet_hours_enabled,
        start: field === "quiet_hours_start" ? value : undefined,
        end: field === "quiet_hours_end" ? value : undefined,
      });
    } catch (err) {
      setChan((c) => ({ ...c, [field]: prevValue }));
      notify(err.message || "Could not update quiet hours");
    }
  };

  return (
    <div className="notification-prefs">
      <span className="section-kicker">DELIVERY</span>
      <label className="notification-pref-row">
        <div>
          <b>Email</b>
          <small>
            {canEmail
              ? "Get an email for the things you're notified about above."
              : "Add and verify a contact email in your Profile to turn this on."}
          </small>
        </div>
        <input type="checkbox" checked={!!chan.channel_email} disabled={busy === "email" || !canEmail} onChange={toggleEmail} />
      </label>

      <label className="notification-pref-row">
        <div>
          <b>SMS</b>
          <small>
            {canSms
              ? "Get a text for the things you're notified about above. Emergency alerts always text you, even with this off."
              : "Add a phone number in your Profile to turn this on. Emergency alerts will still text you once you do."}
          </small>
        </div>
        <input type="checkbox" checked={!!chan.channel_sms} disabled={busy === "sms" || !canSms} onChange={toggleSms} />
      </label>

      <label className="notification-pref-row">
        <div>
          <b>Quiet hours</b>
          <small>Pause push/email/SMS overnight -- in-app notifications still land, just no buzz. Emergency alerts always go through.</small>
        </div>
        <input type="checkbox" checked={!!chan.quiet_hours_enabled} disabled={busy === "quiet"} onChange={toggleQuietHours} />
      </label>
      {chan.quiet_hours_enabled && (
        <div className="quiet-hours-range">
          <label>
            From
            <input
              type="time"
              value={(chan.quiet_hours_start || "22:00:00").slice(0, 5)}
              onChange={(e) => changeQuietRange("quiet_hours_start", e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="time"
              value={(chan.quiet_hours_end || "07:00:00").slice(0, 5)}
              onChange={(e) => changeQuietRange("quiet_hours_end", e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function NotificationsPage({ notifications, markRead, notify, onOpenConversation, authUser, profile }) {
  return (
    <section className="page-section">
      <PageHeader
        kicker="UPDATES"
        title="Notifications"
        text="Important campus updates, service alerts and community activity."
        action={
          <button
            className="ghost"
            onClick={() => {
              markRead();
              notify("All notifications marked as read");
            }}
          >
            Mark all read
          </button>
        }
      />

      <PushToggle authUser={authUser} notify={notify} />
      <NotificationChannelPanel authUser={authUser} profile={profile} notify={notify} />
      <NotificationPreferencesPanel authUser={authUser} notify={notify} />

      <div className="notification-list">
        {notifications.map((notification) => {
          const isMessage = notification.type === "message" && notification.actionType === "conversation" && notification.actionId;
          return (
            <article
              className={`notification-card ${
                notification.unread ? "unread" : ""
              } ${isMessage ? "clickable" : ""}`}
              key={notification.id}
              style={isMessage ? { cursor: "pointer" } : undefined}
              onClick={isMessage ? () => onOpenConversation?.(notification.actionId) : undefined}
            >
              <span>
                {notification.type === "event" ? (
                  <HiCalendarDays />
                ) : notification.type === "service" ? (
                  <HiWrenchScrewdriver />
                ) : notification.type === "official" ? (
                  <HiMegaphone />
                ) : notification.type === "message" ? (
                  <HiChatBubbleLeftRight />
                ) : (
                  <HiChatBubbleOvalLeft />
                )}
              </span>

              <div>
                <b>{notification.title}</b>
                <small>{notification.time}</small>
              </div>

              {notification.unread && <i />}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* =========================================================
   MESSAGES
========================================================= */

function MessageAttachmentImage({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let mounted = true;
    getMessageAttachmentUrl(path).then((u) => { if (mounted) setUrl(u); }).catch(() => {});
    return () => { mounted = false; };
  }, [path]);
  if (!url) return <div className="message-attachment-img loading" />;
  return <img className="message-attachment-img" src={url} alt="Attachment" onClick={() => window.open(url, "_blank")} />;
}

function BlockedUsersModal({ onClose, notify }) {
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    listBlockedUsers().then(setBlocked).catch((err) => notify(err.message || "Could not load blocked users")).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><HiXMark /></button>
        <span className="section-kicker">MESSAGES</span>
        <h2>Blocked users</h2>
        {loading && <LoadingState label="Loading…" />}
        {!loading && blocked.length === 0 && <EmptyState icon={<HiNoSymbol />} title="No one blocked" text="Users you block won't be able to message you." />}
        {!loading && blocked.map((b) => (
          <div key={b.user_id} className="blocked-user-row">
            <span>{b.name}</span>
            <button
              className="ghost"
              onClick={async () => {
                try {
                  await unblockUser(b.user_id);
                  notify(`Unblocked ${b.name}`);
                  reload();
                } catch (err) {
                  notify(err.message || "Could not unblock this user");
                }
              }}
            >
              Unblock
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Messages({ notify, authUser, openConversationId, onConversationOpened, onUnreadChange }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [blockedIds, setBlockedIds] = useState(new Set());
  const [managingBlocks, setManagingBlocks] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const threadEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const reloadConversations = async () => {
    try {
      const rows = await listConversations();
      setConversations(rows);
      const total = rows.reduce((sum, r) => sum + Number(r.unread_count || 0), 0);
      onUnreadChange?.(total);
    } catch (error) {
      notify(error.message || "Could not load conversations");
    } finally {
      setLoading(false);
    }
  };

  const reloadBlocked = () => {
    listBlockedUsers().then((rows) => setBlockedIds(new Set(rows.map((r) => r.user_id)))).catch(() => {});
  };

  useEffect(() => {
    reloadConversations();
    reloadBlocked();
    const unsub = subscribeToConversationList(() => reloadConversations());
    return () => unsub?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A "Message seller"/"Message" click or a tapped message notification
  // hands over a conversation id to jump straight into.
  useEffect(() => {
    if (openConversationId) {
      setActiveId(openConversationId);
      onConversationOpened?.();
    }
  }, [openConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openThread = async (conversationId) => {
    setActiveId(conversationId);
    try {
      await markConversationRead(conversationId);
      reloadConversations();
    } catch {
      // Non-fatal -- the thread still opens even if marking-read fails.
    }
  };

  useEffect(() => {
    if (!activeId) { setMsgs([]); return; }
    let mounted = true;

    getConversationMessages(activeId).then((rows) => { if (mounted) setMsgs(rows); }).catch(() => {});

    const unsub = subscribeToConversationMessages(activeId, () => {
      getConversationMessages(activeId).then((rows) => { if (mounted) setMsgs(rows); }).catch(() => {});
      markConversationRead(activeId).then(reloadConversations).catch(() => {});
    });

    return () => { mounted = false; unsub?.(); };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const activeConversation = conversations.find((c) => c.conversation_id === activeId);
  const activeIsBlocked = activeConversation && blockedIds.has(activeConversation.other_user_id);

  const filteredConversations = search.trim()
    ? conversations.filter((c) => {
        const q = search.trim().toLowerCase();
        return c.other_user_name?.toLowerCase().includes(q) || c.listing_title?.toLowerCase().includes(q);
      })
    : conversations;

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId) return;
    setSending(true);
    setDraft("");
    try {
      await sendMessage(activeId, body);
      const rows = await getConversationMessages(activeId);
      setMsgs(rows);
    } catch (error) {
      // Restore the draft on failure (offline, rate-limited, blocked mid-
      // typing, ...) -- clearing it optimistically above and never putting
      // it back on error used to silently discard whatever the user typed,
      // leaving only a toast and nothing to retry with.
      setDraft(body);
      notify(error.message || "Could not send message");
    } finally {
      setSending(false);
    }
  };

  const removeMessage = async (messageId) => {
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    try {
      await deleteMessage(messageId);
      const rows = await getConversationMessages(activeId);
      setMsgs(rows);
    } catch (error) {
      notify(error.message || "Could not delete this message");
    }
  };

  const sendAttachment = async (file) => {
    if (!file || !activeId) return;
    try {
      setAttaching(true);
      const path = await uploadMessageAttachment(activeId, file);
      await sendMessage(activeId, draft.trim(), path);
      setDraft("");
      const rows = await getConversationMessages(activeId);
      setMsgs(rows);
    } catch (error) {
      notify(error.message || "Could not send this photo");
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleBlock = async () => {
    if (!activeConversation) return;
    const { other_user_id: otherId, other_user_name: otherName } = activeConversation;
    if (activeIsBlocked) {
      try {
        await unblockUser(otherId);
        notify(`Unblocked ${otherName}`);
        reloadBlocked();
      } catch (err) {
        notify(err.message || "Could not unblock this user");
      }
      return;
    }
    if (!window.confirm(`Block ${otherName || "this user"}? They won't be able to message you anymore.`)) return;
    try {
      await blockUser(otherId);
      notify(`Blocked ${otherName}`);
      reloadBlocked();
    } catch (err) {
      notify(err.message || "Could not block this user");
    }
  };

  const reportConversation = async () => {
    if (!activeId) return;
    const reason = window.prompt("Why are you reporting this conversation? (harassment, spam, scam, etc.)");
    if (!reason?.trim()) return;
    try {
      await reportContent("conversation", activeId, reason.trim());
      notify("Reported to campus moderators");
    } catch (err) {
      notify(err.message || "Could not report this conversation");
    }
  };

  if (loading) return <LoadingState label="Loading your messages…" />;

  return (
    <section className="page-section">
      <PageHeader
        kicker="MESSAGES"
        title="Messages"
        text="Marketplace conversations and classmate DMs, in one place."
        action={<button className="ghost" onClick={() => setManagingBlocks(true)}><HiNoSymbol /> Blocked users</button>}
      />

      {conversations.length === 0 && !activeId && (
        <EmptyState
          icon={<HiChatBubbleLeftRight />}
          title="No conversations yet"
          text="Message a seller from Marketplace or a classmate from Connect to start one."
        />
      )}

      {(conversations.length > 0 || activeId) && (
        <div className="messages-layout">
          <div className="messages-list">
            {conversations.length > 3 && (
              <div className="messages-search">
                <HiMagnifyingGlass />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations…" />
              </div>
            )}
            {filteredConversations.length === 0 && <EmptyState title="No matches" text="Try a different name or listing." />}
            {filteredConversations.map((c) => (
              <button
                key={c.conversation_id}
                className={`message-thread-row ${c.conversation_id === activeId ? "active" : ""}`}
                onClick={() => openThread(c.conversation_id)}
              >
                <div className="big-avatar small">{c.other_user_name?.[0] || "?"}</div>
                <div>
                  <b>{c.other_user_name || "Campus member"}{blockedIds.has(c.other_user_id) && <span className="blocked-tag"> · Blocked</span>}</b>
                  {c.listing_title && <small className="listing-tag">Re: {c.listing_title}</small>}
                  <small>{c.last_message_body ? c.last_message_body.slice(0, 60) : "Say hello…"}</small>
                </div>
                {Number(c.unread_count) > 0 && <i>{c.unread_count}</i>}
              </button>
            ))}
          </div>

          <div className="messages-thread">
            {!activeId && <EmptyState icon={<HiChatBubbleLeftRight />} title="Select a conversation" text="Pick a thread on the left to read and reply." />}

            {activeId && (
              <>
                <div className="messages-thread-head">
                  <div>
                    <b>{activeConversation?.other_user_name || "Conversation"}</b>
                    {activeConversation?.listing_title && <small>About: {activeConversation.listing_title}</small>}
                    {activeConversation?.other_user_availability_status === "away" && (
                      <small className="availability-chip away">
                        Away{activeConversation.other_user_availability_message ? ` · ${activeConversation.other_user_availability_message}` : ""}
                      </small>
                    )}
                  </div>
                  <div className="messages-thread-actions">
                    <button className="ghost" onClick={toggleBlock}>{activeIsBlocked ? "Unblock" : "Block"}</button>
                    <button className="ghost" onClick={reportConversation}>Report</button>
                  </div>
                </div>

                <div className="messages-thread-body">
                  {msgs.map((m) => {
                    const mine = m.sender_id === authUser?.id;
                    return (
                      <div key={m.id} className={`message-bubble ${mine ? "mine" : "theirs"}`}>
                        {m.deleted_at ? (
                          <p className="message-deleted">
                            {m.deleted_by === m.sender_id ? "You deleted this message" : "This message was removed by a moderator"}
                          </p>
                        ) : (
                          <>
                            {m.attachment_path && <MessageAttachmentImage path={m.attachment_path} />}
                            {m.body && <p>{m.body}</p>}
                          </>
                        )}
                        <small>
                          {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {mine && !m.deleted_at && (
                            <button className="message-delete-btn" onClick={() => removeMessage(m.id)} aria-label="Delete message">
                              <HiTrash />
                            </button>
                          )}
                        </small>
                      </div>
                    );
                  })}
                  <div ref={threadEndRef} />
                </div>

                {activeIsBlocked ? (
                  <div className="messages-compose blocked">
                    <span>You&apos;ve blocked this person. Unblock them to send a message.</span>
                  </div>
                ) : (
                  <div className="messages-compose">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      ref={fileInputRef}
                      style={{ display: "none" }}
                      onChange={(e) => sendAttachment(e.target.files?.[0])}
                    />
                    <button className="attach-btn" disabled={sending || attaching} onClick={() => fileInputRef.current?.click()} aria-label="Attach photo">
                      <HiPhoto />
                    </button>
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                      placeholder={attaching ? "Sending photo…" : "Type a message…"}
                      disabled={sending || attaching}
                    />
                    <button className="primary" disabled={sending || attaching || !draft.trim()} onClick={send}>
                      <HiPaperAirplane />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {managingBlocks && <BlockedUsersModal notify={notify} onClose={() => { setManagingBlocks(false); reloadBlocked(); }} />}
    </section>
  );
}

/* =========================================================
   GLOBAL SEARCH
========================================================= */

const SEARCH_TYPE_ICON = {
  post: <HiChatBubbleOvalLeft />,
  event: <HiCalendarDays />,
  club: <HiUserGroup />,
  listing: <HiShoppingCart />,
  food_item: <HiShoppingBag />,
  service: <HiWrenchScrewdriver />,
  lost_found: <HiMagnifyingGlassCircle />,
  announcement: <HiMegaphone />,
  person: <HiUserCircle />,
  canteen: <HiOutlineBuildingLibrary />,
  store_vendor: <HiOutlineBuildingLibrary />,
  store_item: <HiShoppingBag />,
  opportunity: <HiBriefcase />,
  location: <HiMapPin />,
};

function GlobalSearchOverlay({ onClose, go, setSearch, authUser, openLogin, notify }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFilters, setActiveFilters] = useState([]); // SEARCH_FILTER_GROUPS keys; [] = all
  const [recent, setRecent] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Recent searches + trending suggestions power the empty-query state --
  // both are authenticated-only server-side, so a signed-out visitor just
  // sees the plain search box (no recent history to show them anyway).
  useEffect(() => {
    if (!authUser) return;
    getRecentSearches(8).then(setRecent).catch(() => {});
    getSearchSuggestions(6).then(setSuggestions).catch(() => {});
  }, [authUser]);

  const activeTypes = useMemo(() => {
    if (!activeFilters.length) return null;
    const groups = SEARCH_FILTER_GROUPS.filter((g) => activeFilters.includes(g.key));
    return groups.flatMap((g) => g.types);
  }, [activeFilters]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setError(""); return; }

    const handle = setTimeout(async () => {
      try {
        setLoading(true);
        setError("");
        setResults(await globalSearch(q, 8, activeTypes));
      } catch (err) {
        setError(err.message || "Search failed");
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [query, activeTypes]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const r of results) {
      const label = SEARCH_ENTITY_LABELS[r.entity_type] || r.entity_type;
      groups[label] = groups[label] || [];
      groups[label].push(r);
    }
    return groups;
  }, [results]);

  const toggleFilter = (key) => {
    setActiveFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const runSearch = (text) => setQuery(text);

  const openResult = (result) => {
    const dest = SEARCH_ENTITY_DESTINATIONS[result.entity_type];
    if (!dest) return;

    if (result.entity_type === "person") {
      if (!authUser) { openLogin?.(); notify("Sign in to view classmates"); onClose(); return; }
    }

    if (authUser) logSearch(query).catch(() => {});
    if (dest.prefill) setSearch(result.title);
    go(dest.tab);
    onClose();
  };

  const showEmptyState = authUser && query.trim().length < 2 && (recent.length > 0 || suggestions.length > 0);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="login-modal global-search-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><HiXMark /></button>
        <span className="section-kicker">SEARCH CAMPUSOS</span>
        <div className="searchbar" style={{ marginTop: 10, marginBottom: 4 }}>
          <HiMagnifyingGlass />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && authUser && query.trim().length >= 2) logSearch(query).catch(() => {}); }}
            placeholder="Search food, vendors, events, clubs, people, marketplace…"
          />
        </div>

        <div className="global-search-filters">
          {SEARCH_FILTER_GROUPS.map((g) => (
            <button
              key={g.key}
              className={activeFilters.includes(g.key) ? "chip active" : "chip"}
              onClick={() => toggleFilter(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>

        {loading && <p style={{ color: "var(--muted)", fontSize: 12, padding: "10px 2px" }}>Searching…</p>}
        {error && <p style={{ color: "#c23a3a", fontSize: 12, padding: "10px 2px" }}>{error}</p>}
        {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 12, padding: "10px 2px" }}>No results for &ldquo;{query}&rdquo;.</p>
        )}

        {showEmptyState && (
          <div className="global-search-suggestions">
            {recent.length > 0 && (
              <div className="global-search-group">
                <div className="global-search-group-head">
                  <small className="global-search-group-label">Recent searches</small>
                  <button
                    className="ghost"
                    onClick={async () => { try { await clearRecentSearches(); setRecent([]); } catch (err) { notify(err.message || "Could not clear recent searches"); } }}
                  >
                    Clear
                  </button>
                </div>
                <div className="global-search-chip-row">
                  {recent.map((r) => (
                    <button key={r.query} className="chip" onClick={() => runSearch(r.query)}>
                      <HiClock /> {r.query}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="global-search-group">
                <small className="global-search-group-label">Trending on campus</small>
                <div className="global-search-chip-row">
                  {suggestions.map((s) => (
                    <button key={s.query} className="chip" onClick={() => runSearch(s.query)}>
                      <HiFire /> {s.query}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="global-search-results">
          {Object.entries(grouped).map(([label, items]) => (
            <div key={label} className="global-search-group">
              <small className="global-search-group-label">{label}</small>
              {items.map((item) => (
                <button key={`${item.entity_type}-${item.entity_id}`} className="global-search-result" onClick={() => openResult(item)}>
                  <span>{SEARCH_TYPE_ICON[item.entity_type] || <HiSparkles />}</span>
                  <div>
                    <b>{item.title}</b>
                    <small>{item.subtitle}</small>
                  </div>
                  <HiChevronRight />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   MODALS
========================================================= */

function ModalShell({ title, kicker, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="feature-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>
          <HiXMark />
        </button>

        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2>{title}</h2>

        {children}
      </div>
    </div>
  );
}

// reject_if_suspended() (supabase/migrations/20260814003000) already blocks
// a suspended account from posting/ordering/booking/etc -- this is the one
// path back: submit_suspension_appeal()/get_my_suspension_appeal()
// (20260818000600_community_hardening.sql). Shown in place of the normal
// page content while profile.status === 'suspended' so a suspended student
// isn't just staring at a broken app with no explanation.
function SuspendedAccountScreen({ profile, notify }) {
  const [appeal, setAppeal] = useState(undefined); // undefined = loading, null = none yet
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getMySuspensionAppeal()
      .then(setAppeal)
      .catch(() => setAppeal(null));
  }, []);

  const submit = async () => {
    if (!reason.trim()) return;
    try {
      setSubmitting(true);
      const created = await submitSuspensionAppeal(reason.trim());
      setAppeal(created);
      notify("Appeal submitted — a campus admin will review it");
    } catch (err) {
      notify(err.message || "Could not submit your appeal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="page-section">
      <div className="section-head large">
        <div>
          <span className="section-kicker">ACCOUNT SUSPENDED</span>
          <h1>Your account has been suspended</h1>
          <p>
            {profile?.suspended_reason
              ? `Reason given: "${profile.suspended_reason}"`
              : "Contact a campus admin for details."}
          </p>
        </div>
      </div>

      {appeal === undefined && <LoadingState label="Checking appeal status…" />}

      {appeal === null && (
        <div className="side-card" style={{ maxWidth: 480 }}>
          <span className="section-kicker">SUBMIT AN APPEAL</span>
          <p>Explain why you believe this suspension should be reviewed.</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Your explanation..."
            rows={5}
            style={{ width: "100%", marginBottom: 12 }}
          />
          <button className="primary wide" disabled={!reason.trim() || submitting} onClick={submit}>
            {submitting ? "Submitting…" : "Submit appeal"}
          </button>
        </div>
      )}

      {appeal && appeal.status === "pending" && (
        <div className="side-card" style={{ maxWidth: 480 }}>
          <span className="section-kicker">APPEAL UNDER REVIEW</span>
          <p>&ldquo;{appeal.reason}&rdquo;</p>
          <small>Submitted {new Date(appeal.created_at).toLocaleString()} — a campus admin will review it.</small>
        </div>
      )}

      {appeal && appeal.status === "denied" && (
        <div className="side-card" style={{ maxWidth: 480 }}>
          <span className="section-kicker">APPEAL DENIED</span>
          {appeal.admin_note && <p>{appeal.admin_note}</p>}
          <p>You can submit another appeal below if you have new information.</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Your explanation..."
            rows={5}
            style={{ width: "100%", marginBottom: 12 }}
          />
          <button className="primary wide" disabled={!reason.trim() || submitting} onClick={submit}>
            {submitting ? "Submitting…" : "Submit another appeal"}
          </button>
        </div>
      )}
    </section>
  );
}

function PostComposer({ onClose, onCreate, user, authUser, notify }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("General");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState([]);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);

  const addTag = () => {
    const clean = tag.trim().toLowerCase();
    if (clean && !tags.includes(clean)) setTags((prev) => [...prev, clean]);
    setTag("");
  };

  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (images.length >= 4) {
      notify?.("You can attach up to 4 images per post");
      return;
    }
    if (!authUser?.id) {
      notify?.("Sign in to attach images");
      return;
    }
    try {
      setUploading(true);
      const url = await uploadPostImage(file, authUser.id);
      setImages((prev) => [...prev, url]);
    } catch (err) {
      notify?.(err.message || "Could not upload that image");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ModalShell
      kicker="CAMPUS COMMUNITY"
      title="Create a post"
      onClose={onClose}
    >
      <label>
        Post type
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option>General</option>
          <option>Hackathon</option>
          <option>Event</option>
          <option>Help Needed</option>
          <option>Achievement</option>
        </select>
      </label>

      <label>
        What do you want to say?
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Share something with your campus..."
        />
      </label>

      <label>
        Tags
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="e.g. robotics — press Enter to add"
          />
          <button type="button" onClick={addTag} disabled={!tag.trim()}>Add</button>
        </div>
      </label>
      {tags.length > 0 && (
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className="chip" onClick={() => setTags((prev) => prev.filter((x) => x !== t))} title="Remove tag">
              #{t} ×
            </button>
          ))}
        </div>
      )}

      <label>
        Photos ({images.length}/4)
        <input type="file" accept="image/*" onChange={handleImagePick} disabled={uploading || images.length >= 4} />
      </label>
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {images.map((url) => (
            <div key={url} style={{ position: "relative" }}>
              <img src={url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((x) => x !== url))}
                style={{ position: "absolute", top: -6, right: -6, borderRadius: "50%", width: 20, height: 20, lineHeight: "20px", padding: 0 }}
                title="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        className="primary wide"
        disabled={!title.trim() || uploading}
        onClick={() =>
          onCreate({
            type,
            title,
            author: user?.name || "Campus Student",
            accent: "violet",
            tags,
            images,
          })
        }
      >
        {uploading ? "Uploading…" : <>Publish <HiArrowUpTray /></>}
      </button>
    </ModalShell>
  );
}

function LoginModal({ onClose, notify }) {
  const [mode, setMode] = useState("magic-link"); // 'magic-link' | 'usn' | 'vendor'
  const [googleLoading, setGoogleLoading] = useState(false);

  return (
    <ModalShell
      kicker="COLLEGE ACCOUNT"
      title="Welcome to Campus OS"
      onClose={onClose}
    >
      <button
        className="ghost wide google-signin-button"
        disabled={googleLoading}
        onClick={async () => {
          try {
            setGoogleLoading(true);
            await signInWithGoogle(); // redirects the browser away on success
          } catch (error) {
            console.error("Google sign-in:", error);
            notify(error.message || "Unable to sign in with Google");
            setGoogleLoading(false);
          }
        }}
      >
        <FaGoogle /> {googleLoading ? "Redirecting…" : "Continue with Google"}
      </button>

      <div className="login-divider"><span>or</span></div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button
          className={mode === "magic-link" ? "chip active" : "chip"}
          onClick={() => setMode("magic-link")}
        >
          Email link
        </button>
        <button
          className={mode === "usn" ? "chip active" : "chip"}
          onClick={() => setMode("usn")}
        >
          USN &amp; password
        </button>
        <button
          className={mode === "vendor" ? "chip active" : "chip"}
          onClick={() => setMode("vendor")}
        >
          Vendor login
        </button>
      </div>

      {mode === "magic-link" && <MagicLinkLogin notify={notify} onClose={onClose} />}
      {mode === "usn" && <UsnPasswordLogin notify={notify} onClose={onClose} />}
      {mode === "vendor" && <VendorPasswordLogin notify={notify} onClose={onClose} />}
    </ModalShell>
  );
}

function VendorPasswordLogin({ onClose, notify }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) { notify("Enter your vendor email"); return; }
    if (!password) { notify("Enter your password"); return; }

    try {
      setLoading(true);
      await signInWithPassword(cleanEmail, password);
      notify("Signed in");
      onClose();
    } catch (error) {
      console.error("Vendor login:", error);
      notify(error.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p>For canteen and print shop vendor accounts.</p>
      <label>
        Vendor email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="udupi.canteen@nhce.edu.in"
          autoFocus
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </label>
      <button className="primary wide" disabled={loading} onClick={handleSubmit}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </>
  );
}

function MagicLinkLogin({ onClose, notify }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleLogin = async () => {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      notify("Enter your college email");
      return;
    }

    if (!cleanEmail.endsWith("@nhce.edu.in") && !cleanEmail.endsWith("@newhorizonindia.edu") && !cleanEmail.endsWith("@gmail.com")) {
      notify("Please use an allowed email domain (@nhce.edu.in, @gmail.com)");
      return;
    }

    try {
      setLoading(true);

      await sendMagicLink(email.trim());

      setSent(true);

      notify("Magic login link sent to your email");

    } catch (error) {
      console.error("Magic link error:", error);

      notify(
        error.message ||
        "Unable to send login link"
      );
    } finally {
      setLoading(false);
    }
  };

  return !sent ? (
    <>
      <p>
        Sign in using your official NHCE college email.
      </p>

      <label>
        College email

        <input
          type="email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
          placeholder="yourname@gmail.com"
          autoFocus
        />
      </label>

      <button
        className="primary wide"
        disabled={loading}
        onClick={handleLogin}
        data-testid="direct-login-button"
      >
        {loading ? "Processing..." : "Send login link"}

        {!loading && <HiArrowRight />}
      </button>
    </>
  ) : (
    <div className="empty-state">
      <HiCheckCircle />

      <h3>Check your email</h3>

      <p>
        We sent a secure login link to:
      </p>

      <b>{email}</b>

      <button
        className="ghost"
        onClick={onClose}
      >
        Done
      </button>
    </div>
  );
}

function UsnPasswordLogin({ onClose, notify }) {
  const [signingUp, setSigningUp] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [name, setName] = useState("");
  const [usn, setUsn] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showLegal, setShowLegal] = useState(false);

  const handleSubmit = async () => {
    const cleanUsn = usn.trim().toUpperCase();

    if (signingUp && !name.trim()) {
      notify("Enter your full name");
      return;
    }
    // Real NHCE USN structure (matches src/features/auth/usn.ts's
    // USN_PATTERN, and signup-with-usn's own server-side check) -- only
    // enforced when creating a NEW account. Login stays a loose non-empty
    // check so a pre-existing account whose USN predates this stricter
    // format never gets locked out (signInWithUsn() itself mirrors this).
    if (signingUp && !/^\dNH\d{2}[A-Za-z]{2}\d{3}$/i.test(cleanUsn)) {
      notify("Enter a valid NHCE USN, e.g. 1NH22CS201");
      return;
    }
    if (!signingUp && !cleanUsn) {
      notify("Enter your USN");
      return;
    }
    if (!password) {
      notify("Enter your password");
      return;
    }
    if (signingUp && password !== confirmPassword) {
      notify("Passwords don't match");
      return;
    }
    if (signingUp && !agreedToTerms) {
      notify("Please agree to the Privacy Policy and Terms of Service");
      return;
    }

    try {
      setLoading(true);

      if (signingUp) {
        await signUpWithUsn({ name, usn: cleanUsn, password });
        notify("Account created — welcome to CampusOS");
      } else {
        await signInWithUsn({ usn: cleanUsn, password });
        notify("Signed in");
      }

      onClose();
    } catch (error) {
      console.error("USN login:", error);
      notify(error.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  if (forgotPassword) {
    return <ForgotPasswordFlow notify={notify} onBack={() => setForgotPassword(false)} />;
  }

  return (
    <>
      <p>
        {signingUp
          ? "Create your account with your name, USN and a password."
          : "Sign in with your USN and password."}
      </p>

      {signingUp && (
        <label>
          Full name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sanjay Padmaraj"
            autoFocus={signingUp}
          />
        </label>
      )}

      <label>
        USN
        <input
          value={usn}
          onChange={(e) => setUsn(e.target.value.toUpperCase())}
          placeholder="1NH25CS265"
          maxLength={10}
          autoFocus={!signingUp}
        />
      </label>

      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </label>

      {signingUp && (
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>
      )}

      {signingUp && (
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)} />
            <span>
              I agree to the{" "}
              <button type="button" className="link-btn" onClick={() => setShowLegal((v) => !v)}>
                Privacy Policy &amp; Terms of Service
              </button>
            </span>
          </label>
          {showLegal && (
            <div className="legal-inline-preview">
              <LegalContent />
            </div>
          )}
        </>
      )}

      <button
        className="primary wide"
        disabled={loading || (signingUp && !agreedToTerms)}
        onClick={handleSubmit}
        data-testid="usn-login-button"
      >
        {loading ? "Processing..." : signingUp ? "Create account" : "Sign in"}
        {!loading && <HiArrowRight />}
      </button>

      <button
        className="ghost wide"
        style={{ marginTop: 8 }}
        onClick={() => setSigningUp((current) => !current)}
      >
        {signingUp ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>

      {!signingUp && (
        <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setForgotPassword(true)}>
          Forgot password?
        </button>
      )}
    </>
  );
}

// Only reachable for accounts with a verified contact email (or a real,
// non-synthetic auth.users.email) -- see request-password-reset's own
// recipient-resolution logic. The response is always the same generic
// message regardless of whether the USN exists or has a usable email on
// file, so this UI can't be used to probe which USNs are real accounts.
function ForgotPasswordFlow({ notify, onBack }) {
  const [usn, setUsn] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    const cleanUsn = usn.trim().toUpperCase();
    if (!/^[A-Za-z0-9]{10}$/.test(cleanUsn)) {
      notify("USN must be exactly 10 letters/numbers");
      return;
    }
    try {
      setLoading(true);
      await requestPasswordReset(cleanUsn);
      setSent(true);
    } catch (error) {
      notify(error.message || "Unable to request a password reset");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="empty-state">
        <HiCheckCircle />
        <h3>Check your email</h3>
        <p>
          If that account has a verified email on file, we&apos;ve sent a reset
          link to it. It expires in 1 hour.
        </p>
        <button className="ghost" onClick={onBack}>Back to sign in</button>
      </div>
    );
  }

  return (
    <>
      <p>Enter your USN and we&apos;ll email a reset link if the account has a verified contact email on file.</p>
      <label>
        USN
        <input
          value={usn}
          onChange={(e) => setUsn(e.target.value.toUpperCase())}
          placeholder="1NH25CS265"
          maxLength={10}
          autoFocus
        />
      </label>
      <button className="primary wide" disabled={loading} onClick={handleSubmit}>
        {loading ? "Sending…" : "Send reset link"}
      </button>
      <button type="button" className="ghost wide" style={{ marginTop: 8 }} onClick={onBack}>
        Back to sign in
      </button>
    </>
  );
}

const LINKEDIN_URL_PATTERN = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i;
const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/.+/i;

function EditProfileModal({ profile, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    name: profile.name || "",
    course: profile.course || "",
    year: profile.year || "",
    usn: profile.usn || "",
    roll_number: profile.roll_number || "",
    department: profile.department || "",
    bio: profile.bio || "",
    skills: (profile.skills || []).join(", "),
    achievements: (profile.achievements || []).join(", "),
    linkedin_url: profile.linkedin_url || "",
    github_url: profile.github_url || "",
    open_to_projects: Boolean(profile.open_to_projects),
  });
  const [saving, setSaving] = useState(false);
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <ModalShell kicker="PROFILE" title="Edit profile" onClose={onClose}>
    <div className="form-grid">
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>USN<input value={form.usn} onChange={(e) => change("usn", e.target.value)} /></label>
      <label>Course<input value={form.course} onChange={(e) => change("course", e.target.value)} /></label>
      <label>Year<input value={form.year} onChange={(e) => change("year", e.target.value)} /></label>
      <label>Roll number<input value={form.roll_number} onChange={(e) => change("roll_number", e.target.value)} placeholder="Optional" /></label>
      <label>Department<input value={form.department} onChange={(e) => change("department", e.target.value)} placeholder="e.g. Computer Science & Engineering" /></label>
    </div>
    <label>Bio<textarea value={form.bio} onChange={(e) => change("bio", e.target.value)} placeholder="What are you building or learning?" /></label>
    <label>Skills (comma separated)<input value={form.skills} onChange={(e) => change("skills", e.target.value)} placeholder="React, Python, Design" /></label>
    <label>Achievements (comma separated)<input value={form.achievements} onChange={(e) => change("achievements", e.target.value)} placeholder="Hackathon winner, Published paper, Club lead" /></label>
    <div className="form-grid">
      <label>LinkedIn URL<input value={form.linkedin_url} onChange={(e) => change("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/you" /></label>
      <label>GitHub URL<input value={form.github_url} onChange={(e) => change("github_url", e.target.value)} placeholder="https://github.com/you" /></label>
    </div>
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={form.open_to_projects} onChange={(e) => change("open_to_projects", e.target.checked)} /> Open to projects</label>
    <button className="primary wide" disabled={saving} onClick={async () => {
      const linkedin = form.linkedin_url.trim();
      const github = form.github_url.trim();
      if (linkedin && !LINKEDIN_URL_PATTERN.test(linkedin)) {
        notify("LinkedIn URL should look like https://linkedin.com/in/you");
        return;
      }
      if (github && !GITHUB_URL_PATTERN.test(github)) {
        notify("GitHub URL should look like https://github.com/you");
        return;
      }
      try {
        setSaving(true);
        const next = await updateProfile(profile.id, {
          ...form,
          skills: form.skills.split(",").map((skill) => skill.trim()).filter(Boolean),
          achievements: form.achievements.split(",").map((achievement) => achievement.trim()).filter(Boolean),
          linkedin_url: linkedin,
          github_url: github,
        });
        onSaved(next);
      }
      catch (error) { notify(error.message || "Could not update profile"); } finally { setSaving(false); }
    }}>{saving ? "Saving…" : "Save profile"}</button>
  </ModalShell>;
}

const PRINT_PAPER_SIZES = ["A4", "A3", "Letter"];
const PRINT_BINDING_OPTIONS = [
  { value: "none", label: "No binding" },
  { value: "staple", label: "Staple" },
  { value: "spiral", label: "Spiral" },
];

function PrintModal({ onClose, setPrintFile, notify, authUser, user, campusId }) {
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [pages, setPages] = useState(12);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState("black_white");
  const [paperSize, setPaperSize] = useState("A4");
  const [duplex, setDuplex] = useState(false);
  const [binding, setBinding] = useState("none");
  const [rateCard, setRateCard] = useState([]);
  const [bindingRates, setBindingRates] = useState(null);
  const [shopStatus, setShopStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!campusId) return;
    Promise.all([getPrintRateCard(campusId), getPrintBindingRates(campusId), getPrintShopStatus(campusId)])
      .then(([rates, binding_, status]) => {
        setRateCard(rates);
        setBindingRates(binding_);
        setShopStatus(status);
      })
      .catch(() => {});
  }, [campusId]);

  const pricePerPage = rateCard.find((r) => r.color_mode === color)?.price_per_page;
  const bindingFee = binding === "staple" ? bindingRates?.staple_fee : binding === "spiral" ? bindingRates?.spiral_fee : 0;
  let estimate = null;
  try {
    estimate = calculatePrintJobPrice({
      pages, copies, colorMode: color, binding: binding !== "none",
      pricePerPage, bindingFee,
    });
  } catch { /* invalid pages/copies while typing -- just hide the estimate */ }

  return (
    <ModalShell kicker="PRINT HUB" title="Upload & print" onClose={onClose}>
      {shopStatus && shopStatus.status !== "online" && (
        <div className="offline-banner" role="status" style={{ background: "#f4b73a22", color: "#a97313" }}>
          <HiExclamationTriangle /> The print shop is currently {shopStatus.status}
          {shopStatus.message ? ` — ${shopStatus.message}` : ""}. You can still place an order; it will be queued once the shop is back.
        </div>
      )}

      <label>
        Document (PDF only, max 25MB)
        <input
          type="file"
          accept="application/pdf"
          onChange={(event) => {
            const selected = event.target.files?.[0] || null;
            setFileError("");
            if (selected) {
              try {
                validatePrintFile(selected);
              } catch (err) {
                setFileError(err.message);
                setFile(null);
                setPrintFile(null);
                return;
              }
            }
            setFile(selected);
            setPrintFile(selected);
          }}
        />
      </label>

      {fileError && <p style={{ color: "#c23a3a", fontSize: 12 }}>{fileError}</p>}

      {file && (
        <div className="file-chip">
          <HiDocumentArrowUp />
          {file.name}
          <HiCheck />
        </div>
      )}

      <div className="form-grid">
        <label>
          Pages
          <input type="number" min="1" max="500" value={pages} onChange={(event) => setPages(event.target.value)} />
        </label>

        <label>
          Copies
          <input type="number" min="1" max="100" value={copies} onChange={(event) => setCopies(event.target.value)} />
        </label>

        <label>
          Print mode
          <select value={color} onChange={(event) => setColor(event.target.value)}>
            <option value="black_white">B&W</option>
            <option value="colour">Colour</option>
          </select>
        </label>

        <label>
          Paper size
          <select value={paperSize} onChange={(event) => setPaperSize(event.target.value)}>
            {PRINT_PAPER_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>

        <label>
          Binding
          <select value={binding} onChange={(event) => setBinding(event.target.value)}>
            {PRINT_BINDING_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={duplex} onChange={(event) => setDuplex(event.target.checked)} />
          Double-sided (duplex)
        </label>
      </div>

      <div className="price-preview">
        <span>Estimated total</span>
        <b>{estimate != null ? `₹${estimate}` : "—"}</b>
      </div>
      <p style={{ fontSize: 12, opacity: 0.7 }}>Final price is confirmed by the print shop&apos;s current rate card at checkout.</p>

      <button
        className="primary wide"
        disabled={submitting}
        onClick={async () => {
          try {
            if (!file) {
              notify("Choose a document first");
              return;
            }

            const currentUser = authUser || await getCurrentUser();
            if (!currentUser) {
              notify("Sign in before printing");
              return;
            }

            setSubmitting(true);

            const job = await uploadPrintJob({
              userId: currentUser.id,
              file,
              pages: Number(pages),
              copies: Number(copies),
              colorMode: color,
              paperSize,
              binding,
              duplex,
            });

            notify(`Print job created · ₹${job.price} — opening payment…`);

            try {
              const payment = await startPrintJobPayment(job.id);
              await openRazorpayCheckout({
                keyId: payment.key_id,
                gatewayOrderId: payment.gateway_order_id,
                amount: payment.amount,
                currency: payment.currency,
                description: `Print job · ${job.pickup_code}`,
                prefillEmail: currentUser.email,
                prefillName: user?.name,
                onDismiss: () => notify("Payment cancelled — you can pay again from My Activity"),
              });
              notify(`Once payment clears, pickup code ${job.pickup_code} will be shown in My Activity.`);
            } catch (paymentError) {
              console.error("Print payment start failed:", paymentError);
              notify(
                paymentError.message?.includes("GATEWAY_NOT_CONFIGURED") || paymentError.message?.includes("not configured")
                  ? "Job created, but payments aren't configured on this deployment yet."
                  : (paymentError.message || "Payment could not be started. Try again from My Activity.")
              );
            }

            onClose();
          } catch (error) {
            console.error("Print job:", error);
            notify(error.message || "Unable to create print job");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Working…" : "Continue to payment"} <HiCreditCard />
      </button>
    </ModalShell>
  );
}

function NavigationModal({ onClose, notify }) {
  const [destination, setDestination] = useState("Innovation Lab");

  return (
    <ModalShell kicker="CAMPUS MAP" title="Navigation & Route" onClose={onClose}>
      <label>
        Destination
        <select value={destination} onChange={(e) => setDestination(e.target.value)}>
          <option>Innovation Lab</option>
          <option>Food Court</option>
          <option>Main Auditorium</option>
          <option>Seminar Hall 2</option>
          <option>Library</option>
        </select>
      </label>

      <div className="route-stats" style={{ margin: "16px 0", display: "flex", gap: "12px" }}>
        <span><HiClock /> 4 min walk</span>
        <span><HiMapPin /> Block C, 2nd Floor</span>
      </div>

      <button
        className="primary wide"
        onClick={() => {
          notify(`Navigation started to ${destination}`);
          onClose();
        }}
      >
        Start Directions <HiArrowRight />
      </button>
    </ModalShell>
  );
}

function CartModal({ title,cart,onClose,notify,type,onCheckout,onUpdateQuantity,onRemove}) {
  const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);

  return (
    <ModalShell
      kicker={type === "food" ? "FOOD HUB" : "CAMPUS STORE"}
      title={title}
      onClose={onClose}
    >
      {cart.length === 0 ? (
        <div className="empty-state">
          <HiShoppingCart />
          <h3>Your cart is empty</h3>
          <p>Add something to continue.</p>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {cart.map((item, index) => (
              <div key={`${item.id}-${index}`}>
                <span style={{ gridColumn: 1, gridRow: 1 }}>{item.name}</span>
                <small style={{ gridColumn: 1, gridRow: 2, color: "var(--muted)" }}>
                  {item.vendor || item.category}
                  {item.addonSummary && ` · + ${item.addonSummary}`}
                </small>
                {onUpdateQuantity ? (
                  <span style={{ gridColumn: 2, gridRow: "1 / 3", display: "flex", alignItems: "center", gap: 6 }}>
                    <button className="ghost" onClick={() => onUpdateQuantity(index, Number(item.quantity || 1) - 1)}>−</button>
                    <b>{item.quantity || 1}</b>
                    <button className="ghost" onClick={() => onUpdateQuantity(index, Number(item.quantity || 1) + 1)}>+</button>
                  </span>
                ) : (
                  <small style={{ gridColumn: 2, gridRow: "1 / 3" }}>× {item.quantity || 1}</small>
                )}
                <b style={{ gridColumn: 3, gridRow: "1 / 3" }}>₹{Number(item.price) * Number(item.quantity || 1)}</b>
                {onRemove && (
                  <button
                    className="ghost"
                    style={{ gridColumn: 4, gridRow: "1 / 3" }}
                    aria-label={`Remove ${item.name}`}
                    onClick={() => onRemove(index)}
                  >
                    <HiXMark />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="price-preview">
            <span>Total</span>
            <b>₹{total}</b>
          </div>

          <button
            className="primary wide"
            onClick={async () => {
            if (onCheckout) {
              await onCheckout();
            } else {
              notify(
                "Checkout opened"
              );
              onClose();
            }
          }}
          >
            Continue to payment <HiCreditCard />
          </button>
        </>
      )}
    </ModalShell>
  );
}

const SOS_HOLD_MS = 1500;

function SOSModal({ onClose, notify, authUser, openLogin }) {
  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // { id, alertType, respondersNotified }
  const [cancelling, setCancelling] = useState(false);
  const holdTimer = useRef(null);

  const send = async (alertType) => {
    if (!authUser) {
      openLogin?.();
      notify("Sign in to send an SOS alert");
      return;
    }
    setHolding(false);
    setSending(true);
    try {
      // Best-effort: never let a denied/slow location permission block or
      // delay dispatch -- getBestEffortLocation() always resolves (null on
      // denial/timeout), it never rejects.
      const location = await getBestEffortLocation();
      const result = await triggerSosAlert({ alertType, location });
      setSent({ id: result.id, alertType, respondersNotified: result.responders_notified });
      notify(
        result.responders_notified > 0
          ? `Alert sent — ${result.responders_notified} responder${result.responders_notified === 1 ? "" : "s"} notified`
          : "Alert sent — no facilities staff are on record for your campus yet, but it's logged"
      );
    } catch (err) {
      notify(err.message || "Could not send the alert -- if this is a real emergency, call campus security directly");
    } finally {
      setSending(false);
    }
  };

  const startHold = () => {
    if (sending || sent) return;
    setHolding(true);
    holdTimer.current = setTimeout(() => send("general"), SOS_HOLD_MS);
  };
  const cancelHold = () => {
    clearTimeout(holdTimer.current);
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const cancelAlert = async () => {
    if (!sent) return;
    try {
      setCancelling(true);
      await cancelMySosAlert(sent.id);
      notify("Alert cancelled");
      setSent(null);
    } catch (err) {
      notify(err.message || "Could not cancel -- a responder may already be on it");
    } finally {
      setCancelling(false);
    }
  };

  if (sent) {
    return (
      <ModalShell kicker="EMERGENCY" title="Campus SOS" onClose={onClose}>
        <div className="sos-card sos-card-sent">
          <span><HiShieldCheck /></span>
          <b>Alert sent</b>
          <small>
            {sent.respondersNotified > 0
              ? `${sent.respondersNotified} campus responder${sent.respondersNotified === 1 ? "" : "s"} notified. Stay where you are if it's safe to.`
              : "Logged, but no facilities staff are on record for your campus yet."}
          </small>
          <button className="ghost" disabled={cancelling} onClick={cancelAlert}>
            {cancelling ? "Cancelling…" : "This was a false alarm — cancel"}
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell kicker="EMERGENCY" title="Campus SOS" onClose={onClose}>
      <div className="sos-card">
        <span><HiShieldCheck /></span>
        <b>Hold for emergency</b>
        <small>
          Real campus responders are notified with your location (if you allow it) the moment this reaches the hold threshold.
        </small>
        <button
          className={holding ? "sos-hold-btn holding" : "sos-hold-btn"}
          style={holding ? { "--sos-hold-ms": `${SOS_HOLD_MS}ms` } : undefined}
          disabled={sending}
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
        >
          <span className="sos-hold-fill" />
          <span className="sos-hold-label"><HiPhone /> {sending ? "Sending…" : "Hold to activate SOS"}</span>
        </button>
      </div>

      <div className="emergency-actions">
        <button disabled={sending} onClick={() => send("security")}>
          <HiPhone /> Security
        </button>
        <button disabled={sending} onClick={() => send("medical")}>
          <HiExclamationTriangle /> Medical
        </button>
        <button disabled={sending} onClick={() => send("help")}>
          <HiUserGroup /> Campus help
        </button>
      </div>
    </ModalShell>
  );
}

/* =========================================================
   HELPERS
========================================================= */

function PageHeader({ kicker, title, text, action }) {
  return (
    <div className="section-head large">
      <div>
        <span className="section-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}

function CommandCard({ icon, title, text, onClick }) {
  return (
    <button className="command-card" onClick={onClick}>
      <span>{icon}</span>
      <div>
        <b>{title}</b>
        <small>{text}</small>
      </div>
      <HiArrowRight />
    </button>
  );
}

function ActionTile({ icon, title, text, onClick }) {
  return (
    <button className="action-tile" onClick={onClick}>
      <span>{icon}</span>
      <b>{title}</b>
      <small>{text}</small>
      <HiArrowRight />
    </button>
  );
}

function DeviceMini({ icon, name, value }) {
  return (
    <div className="device-mini">
      <span>{icon}</span>
      <div>
        <b>{name}</b>
        <small>{value}</small>
      </div>
      <HiSignal />
    </div>
  );
}

function PulseCard({ icon, label, title, meta, onClick }) {
  return (
    <button className="pulse-card" onClick={onClick}>
      <span className="pulse-icon">{icon}</span>
      <span className="pulse-label">{label}</span>
      <strong>{title}</strong>
      <small>{meta}</small>
      <span className="arrow">
        <HiArrowRight />
      </span>
    </button>
  );
}

function Feature({ icon, title, text, onClick }) {
  return (
    <button className="feature" onClick={onClick}>
      <span>{icon}</span>
      <b>{title}</b>
      <small>{text}</small>
    </button>
  );
}

export default App;
