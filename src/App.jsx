import React, { useEffect, useMemo, useRef, useState } from "react";
import { mergeCartItem } from "./utils/mvpHelpers";
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
  createFoodOrder,
  startFoodOrderPayment,
  publishPost,
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
  createMarketplaceListing,
  markMarketplaceListingSold,
  reportContent,
  getMyVerification,
  submitStudentVerification,
  submitOrgRequest,
} from "./services/mvpService";
import { openRazorpayCheckout } from "./features/payments/razorpay";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { LoadingState, EmptyState, ErrorState, OfflineBanner } from "./components/ui/States";
import AdminCMS from "./features/admin/AdminCMS";
import VendorDashboard from "./features/vendor/VendorDashboard";

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
  ["profile", <HiUserCircle />, "Profile"],
];
/* eslint-enable react/jsx-key */

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

const opportunities = [
  {
    company: "Campus Innovation Lab",
    role: "AI Research Intern",
    type: "Research",
    tags: ["Python", "ML"],
    deadline: "18 Aug",
  },
  {
    company: "Tech Startup Hub",
    role: "React Developer",
    type: "Internship",
    tags: ["React", "Node"],
    deadline: "21 Aug",
  },
  {
    company: "Robotics Lab",
    role: "Embedded Systems Intern",
    type: "Research",
    tags: ["ESP32", "C++"],
    deadline: "25 Aug",
  },
];

const mentors = [
  {
    name: "Prof. Rahul Nair",
    role: "Robotics & Embedded Systems",
    skills: ["ESP32", "ROS", "CAD"],
  },
  {
    name: "Dr. Meera Thomas",
    role: "AI / Computer Vision",
    skills: ["Python", "CV", "LLMs"],
  },
  {
    name: "Arjun Menon",
    role: "Startup & Product",
    skills: ["React", "Product", "Pitching"],
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

const storeItems = [
  {
    id: 1,
    name: "Engineering Record",
    price: 45,
    stock: 34,
    category: "Records",
  },
  {
    id: 2,
    name: "A4 Sheets — 100",
    price: 30,
    stock: 120,
    category: "Paper",
  },
  {
    id: 3,
    name: "Scientific Calculator",
    price: 650,
    stock: 12,
    category: "Electronics",
  },
  {
    id: 4,
    name: "Black Gel Pen",
    price: 10,
    stock: 240,
    category: "Stationery",
  },
  {
    id: 5,
    name: "Drawing Sheets",
    price: 20,
    stock: 82,
    category: "Paper",
  },
  {
    id: 6,
    name: "Lab Coat",
    price: 420,
    stock: 18,
    category: "Academic",
  },
];

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
  const [active, setActive] = useState("home");
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
  const [printJobs, setPrintJobs] = useState([]);
  const [serviceRequests, setServiceRequests] = useState([]);
  const [resources, setResources] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [lostItems, setLostItems] = useState([]);
  const [marketListings, setMarketListings] = useState([]);
  const [verification, setVerification] = useState(null);

  const toastTimer = useRef(null);

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

    setActive("home");

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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        (postFilter === "All" || p.type === postFilter) &&
        (!q ||
          `${p.title} ${p.author} ${p.tags.join(" ")}`
            .toLowerCase()
            .includes(q))
    );
  }, [search, postFilter, posts]);

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
    setStoreCart((cart) => [...cart, item]);
    notify(`${item.name} added to store cart`);
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
        getLostFoundItems(campusId).then(setLostItems).catch((error) => console.error("Lost & found loading failed", error));
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
        getMyServiceRequests(authUser.id), getMyBookings(authUser.id), getMyOrders(authUser.id),
      ]).then(([registered, saved, jobs, requests, myBookings, myOrders]) => {
        setRegisteredEventIds(registered); setSavedEventIds(saved); setPrintJobs(jobs);
        setServiceRequests(requests); setBookings(myBookings); setOrders(myOrders);
      }).catch((error) => console.error("Personal workspace loading failed", error));
    }, [authUser?.id]);

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
        />
      );
    }

    if (active === "events") {
      return (
        <Events
          notify={notify}
          events={events.length ? events : eventsSeed}
          eventsLoading={eventsLoading}
          opportunities={opportunities}
          mentors={mentors}
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
      return <Socialize notify={notify} people={people} profile={profile} campusId={campusId} />;
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
        />
      );
    }

    if (active === "map") {
      return <CampusMap notify={notify} openModal={setModal} />;
    }

    if (active === "people") {
      return (
        <People notify={notify} people={people} openModal={setModal} />
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
          items={storeItems}
          cart={storeCart}
          addStore={addStore}
          openModal={setModal}
          orders={orders}
        />
      );
    }

    if (active === "ai") {
      return <CampusAI notify={notify} go={go} />;
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
          campusId={campusId}
          resources={resources}
          bookings={bookings}
          serviceRequests={serviceRequests}
          printJobs={printJobs}
          lostItems={lostItems}
          marketListings={marketListings}
          onBookingsChange={setBookings}
          onRequestsChange={setServiceRequests}
          onLostItemsChange={setLostItems}
          onMarketListingsChange={setMarketListings}
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
          onClick={() => go("home")}
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

      <main>{renderPage()}</main>

      <nav className="bottom-nav">
        {navItems.map(([key, icon, label]) => (
          <button
            key={key}
            className={active === key ? "active" : ""}
            onClick={() => go(key)}
            data-testid={`nav-${key}-button`}
          >
            <span>{icon}</span>
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
        {profile?.role === "vendor" && (
          <button
            className={active === "vendor" ? "active" : ""}
            onClick={() => go("vendor")}
            data-testid="nav-vendor-button"
          >
            <span><HiShoppingBag /></span>
            <small>Dashboard</small>
          </button>
        )}
      </nav>

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          notify={notify}
        />
      )}

      {modal === "post" && (
        <PostComposer
          onClose={() => setModal(null)}
          onCreate={createPost}
          user={user}
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
      />
      )}

      {modal === "store-cart" && (
        <CartModal
          title="Store cart"
          cart={storeCart}
          type="store"
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}

      {modal === "print" && (
        <PrintModal
          onClose={() => setModal(null)}
          setPrintFile={setPrintFile}
          notify={notify}
        />
      )}

      {modal === "sos" && (
        <SOSModal onClose={() => setModal(null)} notify={notify} />
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
            title="3 teams are looking for developers"
            meta="Flutter · React · ML"
            onClick={() => go("campus")}
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
}) {
  const filters = [
    "All",
    "Hackathon",
    "Event",
    "Help Needed",
    "Achievement",
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

function Post({ post, notify, authUser, setLoginOpen }) {
  const [likes, setLikes] = useState(post.likes || 0);
  const [liked, setLiked] = useState(post.liked || false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");

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
        <button onClick={() => notify("Post shared")}>
          <HiArrowUpTray /> Share
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

function People({ notify, people, openModal }) {
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
        text="Discover students based on skills, interests and projects."
        action={
          <button className="primary" onClick={() => openModal("post")}>
            <HiUserPlus /> Need a teammate
          </button>
        }
      />

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
          <PersonCard key={person.id} person={person} notify={notify} />
        ))}
      </div>

      <div className="opportunity">
        <div>
          <span className="section-kicker">SKILL MATCHING</span>
          <h2>Build your next team.</h2>
          <p>
            Tell Campus OS what you need and discover students with
            complementary skills.
          </p>
        </div>
        <button onClick={() => notify("Skill matching questionnaire opened")}>
          Find my team <HiArrowRight />
        </button>
      </div>
    </section>
  );
}

function PersonCard({ person, notify }) {
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
        <button
          className="ghost"
          onClick={() => notify(`Profile opened for ${person.name}`)}
        >
          View profile
        </button>
      </div>
    </article>
  );
}

function Clubs({ notify, clubs: clubList, authUser, setLoginOpen, campusId }) {
  const [selectedClub, setSelectedClub] = useState(null);
  const [joinedClubs, setJoinedClubs] = useState({});
  const [requestModalOpen, setRequestModalOpen] = useState(false);

  useEffect(() => {
    if (!authUser?.id) return;
    getMyClubs(authUser.id).then((myClubs) => {
      const map = {};
      (myClubs || []).forEach((item) => {
        map[item.club_id] = true;
      });
      setJoinedClubs(map);
    });
  }, [authUser?.id]);

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
      } else {
        await joinClub({ clubId: club.id, userId: authUser.id });
        setJoinedClubs((prev) => ({ ...prev, [club.id]: true }));
        notify(`Joined ${club.name}!`);
      }
    } catch (err) {
      console.error(err);
      notify("Club action failed");
    }
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

              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button
                  className="ghost"
                  onClick={() => setSelectedClub(club)}
                >
                  View club <HiArrowRight />
                </button>
                <button
                  className={isMember ? "ghost" : "primary"}
                  onClick={() => handleToggleJoin(club)}
                >
                  {isMember ? "Leave" : "Join"}
                </button>
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
          <button
            className="primary wide"
            onClick={() => {
              handleToggleJoin(selectedClub);
              setSelectedClub(null);
            }}
          >
            {joinedClubs[selectedClub.id] ? "Leave Club" : "Join Club"}
          </button>
        </ModalShell>
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
        {opps.map((item) => (
          <article className="opportunity-card" key={item.role}>
            <div className="company-avatar">
              <HiBriefcase />
            </div>
            <div>
              <h3>{item.role}</h3>
              <p>{item.company} · {item.type}</p>
            </div>
            <span className="deadline">{item.deadline}</span>
            <button onClick={() => notify(`${item.role} opened`)}>
              View <HiArrowRight />
            </button>
          </article>
        ))}
      </div>

      <div className="section-head inner-head">
        <div>
          <span className="section-kicker">MENTORS</span>
          <h2>People who can accelerate your project.</h2>
        </div>
      </div>

      <div className="mentor-grid">
        {mentorList.map((mentor) => (
          <article className="mentor-card" key={mentor.name}>
            <div className="big-avatar small">{mentor.name[0]}</div>
            <div>
              <h3>{mentor.name}</h3>
              <p>{mentor.role}</p>
              <small>{mentor.skills.join(" · ")}</small>
            </div>
            <button onClick={() => notify(`Mentor request sent to ${mentor.name}`)}>
              <HiChatBubbleLeftRight />
            </button>
          </article>
        ))}
      </div>

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

function Services({ go, notify, foodCart, storeCart, printFile }) {
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
          onClick={() => notify("Open Emergency from the service card")}
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

    return matchesCanteen && matchesSearch;
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

function FoodCard({ item, add }) {
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
        </div>

        <h3>{item.name}</h3>

        <p>
          {item.description || "Freshly prepared on campus."}
        </p>

        <div className="product-bottom">

          <b>₹{item.price}</b>

          <button
            onClick={() => add(item)}
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
   STORE
========================================================= */

function Store({ items, cart, addStore, openModal }) {
  const [q, setQ] = useState("");

  const filtered = items.filter((item) =>
    `${item.name} ${item.category}`.toLowerCase().includes(q.toLowerCase())
  );

  const total = cart.reduce((sum, item) => sum + item.price, 0);

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

      <div className="searchbar compact wide-search">
        <HiMagnifyingGlass />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stationery, books, records..."
        />
      </div>

      <div className="category-row">
        {["All", "Stationery", "Records", "Paper", "Electronics", "Academic"].map(
          (category) => (
            <button
              key={category}
              onClick={() =>
                setQ(category === "All" ? "" : category)
              }
            >
              {category}
            </button>
          )
        )}
      </div>

      <div className="product-grid">
        {filtered.map((item) => (
          <article className="product-card" key={item.id}>
            <div className="product-placeholder">
              <HiBookOpen />
            </div>
            <span className="event-club">{item.category}</span>
            <h3>{item.name}</h3>
            <p>{item.stock} in stock</p>

            <div className="product-bottom">
              <b>₹{item.price}</b>
              <button onClick={() => addStore(item)}>
                <HiPlus /> Add
              </button>
            </div>
          </article>
        ))}
      </div>

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

/* =========================================================
   LINKEDIN-STYLE PROFILE
========================================================= */

function Profile({ user, onLogin, onLogout, notify, openModal, profile, onProfileUpdated, stats = {}, verification, onVerificationChanged, campusId }) {
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
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
            <b>{stats.clubs || 0}<span>Clubs</span></b>
            <b>{profile?.open_to_projects ? "Open" : "Closed"}<span>Projects</span></b>
          </div>
        </div>
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
    </section>
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

function Socialize({ notify, people = [], profile, campusId }) {
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

      {tab === "suggestions" && <SuggestedForYou notify={notify} />}
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
            <ClassmateCard key={person.id} person={person} notify={notify} />
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

function SuggestedForYou({ notify }) {
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
        <SuggestedPersonCard key={person.id} person={person} notify={notify} />
      ))}
    </div>
  );
}

function SuggestedPersonCard({ person, notify }) {
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

function ClassmateCard({ person, notify }) {
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
};

function ServiceDetail({ serviceId, notify, go, openModal, openLogin, authUser, user, campusId, resources, bookings, serviceRequests, printJobs, lostItems, marketListings, onBookingsChange, onRequestsChange, onLostItemsChange, onMarketListingsChange }) {
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
        <><div className="service-detail-grid">
          <WorkflowCard
            icon={<HiDocumentArrowUp />}
            title="1. Upload document"
            text="PDF, DOCX and project reports."
            button="Upload"
            onClick={() => openModal("print")}
          />
          <WorkflowCard
            icon={<HiCreditCard />}
            title="2. Configure & pay"
            text="Colour, copies, binding and paper."
            button="Configure"
            onClick={() => openModal("print")}
          />
          <WorkflowCard
            icon={<HiQrCode />}
            title="3. QR pickup"
            text="Collect when the shop marks it ready."
            button="View queue"
            onClick={() => notify("Print queue: 3 orders ahead")}
          />
        </div>{printJobs?.length > 0 && <div className="resource-list">{printJobs.map((job) => <article className="resource-row" key={job.id}><div className="resource-icon"><HiPrinter /></div><div><b>{job.file_name}</b><small>{job.pages} pages · {job.copies} copies · Pickup {job.pickup_code}</small></div><strong>{job.status}</strong></article>)}</div>}</>
      )}

      {serviceId === "issues" && (
        <IssueService notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} requests={serviceRequests} onChange={onRequestsChange} />
      )}

      {serviceId === "booking" && (
        <BookingService notify={notify} authUser={authUser} openLogin={openLogin} resources={resources} bookings={bookings} onChange={onBookingsChange} />
      )}

      {serviceId === "lost" && (
        <LostService notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} items={lostItems} onChange={onLostItemsChange} />
      )}

      {serviceId === "market" && (
        <MarketplaceService notify={notify} authUser={authUser} openLogin={openLogin} campusId={campusId} listings={marketListings} onChange={onMarketListingsChange} />
      )}

      {serviceId === "pass" && (
        <PassService notify={notify} user={user} />
      )}

      {serviceId === "hostel" && (
        <HostelService notify={notify} go={go} />
      )}

      {serviceId === "delivery" && (
        <DeliveryService notify={notify} />
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

function LostService({ notify, authUser, openLogin, campusId, items: dbItems = [], onChange }) {
  const [reporting, setReporting] = useState(false);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const items = dbItems.length ? dbItems.map((item) => [item.title, `${item.item_type} · ${item.location}`, item.id]) : [
    ["Black backpack", "Found near Block B · 18 min ago"],
    ["Student ID card", "Found near Main Gate · 1 hr ago"],
    ["AirPods case", "Found near Library · Yesterday"],
  ];

  return (
    <div className="resource-list">
      {items.map(([name, location, itemId]) => (
        <article className="resource-row" key={itemId || name}>
          <div className="resource-icon"><HiMagnifyingGlassCircle /></div>
          <div>
            <b>{name}</b>
            <small>{location}</small>
          </div>
          <button onClick={async () => { if (!authUser) { openLogin?.(); notify("Sign in to claim an item"); return; } if (!itemId) return notify("Demo item — add the production SQL migration first"); const proof = window.prompt("Describe how you can prove this item is yours (e.g. a unique mark, what's inside, receipt details). Staff will verify before handover."); if (!proof?.trim()) return; try { await claimLostFoundItem({ itemId, userId: authUser.id, proof }); onChange?.((items) => items.filter((item) => item.id !== itemId)); notify("Claim submitted — staff will verify and contact you"); } catch (error) { notify(error.message || "Could not claim item"); } }}>
            Claim
          </button>
        </article>
      ))}
      <button className="primary" onClick={() => setReporting(true)}>
        <HiPlus /> Report lost item
      </button>
      {reporting && <ModalShell kicker="LOST & FOUND" title="Report lost item" onClose={() => setReporting(false)}><label>Item title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Last seen location<input value={location} onChange={(e) => setLocation(e.target.value)} /></label><button className="primary wide" onClick={async () => { if (!authUser) { openLogin?.(); notify("Sign in to report an item"); return; } try { const item = await createLostFoundItem({ userId: authUser.id, campusId, itemType: "lost", title, location }); onChange?.((items) => [item, ...items]); setReporting(false); notify("Lost item reported"); } catch (error) { notify(error.message || "Could not report item"); } }}>Submit report</button></ModalShell>}
    </div>
  );
}

function MarketplaceService({ notify, authUser, openLogin, campusId, listings: dbListings = [], onChange }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const listings = dbListings.length ? dbListings.map((item) => [item.title, `₹${item.price}`, item.profiles?.name || "Campus seller", item.id, item.seller_id]) : [
    ["MacBook sleeve", "₹450", "CSE 3rd Year"],
    ["Scientific calculator", "₹420", "ECE 2nd Year"],
    ["Arduino Uno", "₹500", "Robotics Club"],
  ];

  return (
    <div className="resource-list">
      {listings.map(([name, price, seller, listingId, sellerId]) => (
        <article className="resource-row" key={listingId || name}>
          <div className="resource-icon"><HiShoppingCart /></div>
          <div>
            <b>{name}</b>
            <small>{seller}</small>
          </div>
          <strong>{price}</strong>
          {sellerId === authUser?.id ? <button onClick={async () => { try { await markMarketplaceListingSold({ listingId, userId: authUser.id }); onChange?.((items) => items.filter((item) => item.id !== listingId)); notify("Listing marked sold"); } catch (error) { notify(error.message || "Could not update listing"); } }}>Mark sold</button> : <button onClick={() => notify("Contact details are shared after seller approval")}>Contact</button>}
        </article>
      ))}
      <button className="primary" onClick={() => setCreating(true)}><HiPlus /> Create listing</button>
      {creating && <ModalShell kicker="MARKETPLACE" title="Create listing" onClose={() => setCreating(false)}>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Price<input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
        <button className="primary wide" onClick={async () => {
          if (!authUser) { openLogin?.(); notify("Sign in to create a listing"); return; }
          try {
            const listing = await createMarketplaceListing({ userId: authUser.id, campusId, title, price });
            onChange?.((items) => [listing, ...items]);
            setCreating(false);
            notify("Listing published");
          } catch (error) { notify(error.message || "Could not publish listing"); }
        }}>Publish listing</button>
      </ModalShell>}
    </div>
  );
}

function PassService({ notify, user }) {
  const [showPassModal, setShowPassModal] = useState(false);
  const studentName = user?.name || "Sanjay Padmaraj";
  const studentUsn = user?.usn || "1NH22CS101";

  return (
    <div className="digital-pass-card">
      <div className="qr-placeholder">
        <HiQrCode />
      </div>
      <div>
        <span className="section-kicker">STUDENT PASS</span>
        <h2>NHCE · {studentName.toUpperCase()}</h2>
        <p>Valid for events, workshops, pickups and approved campus workflows.</p>
        <button className="primary" onClick={() => setShowPassModal(true)}>
          Display QR <HiQrCode />
        </button>
      </div>

      {showPassModal && (
        <ModalShell kicker="VERIFIED CAMPUS PASS" title="Digital Identity Pass" onClose={() => setShowPassModal(false)}>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ width: "160px", height: "160px", margin: "0 auto 16px", background: "#f0ecff", borderRadius: "16px", display: "grid", placeItems: "center", border: "2px dashed #6e48ed" }}>
              <HiQrCode style={{ fontSize: "110px", color: "#6e48ed" }} />
            </div>
            <h3 style={{ margin: "4px 0", font: "800 20px Manrope" }}>{studentName}</h3>
            <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: "13px" }}>USN: {studentUsn} · NHCE CSE</p>
            <span style={{ background: "#e4f7ef", color: "#13845b", padding: "6px 14px", borderRadius: "999px", fontSize: "11px", fontWeight: "800" }}>ACTIVE · VERIFIED</span>
          </div>
          <button className="primary wide" onClick={() => { notify("Pass image saved to downloads"); setShowPassModal(false); }}>
            Download Pass QR <HiArrowRight />
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

function CampusAI({ notify, go }) {
  const [message, setMessage] = useState("");

  const [conversation, setConversation] = useState([
    {
      role: "ai",
      text:
        "Hi. I can help you discover people, events, services, rooms and opportunities across Campus OS.",
    },
  ]);

  const suggestions = [
    "Find me a Flutter developer",
    "Where is Lab 302?",
    "What is happening tomorrow?",
    "Show print services",
    "Find a robotics mentor",
  ];

  const answer = (text) => {
    const value = text.toLowerCase();

    if (value.includes("flutter")) {
      return "Rahul has the strongest simulated match at 87%. He works with Flutter, Firebase, ML and UI/UX.";
    }

    if (value.includes("lab")) {
      return "Lab 302 is in Block C, 3rd Floor. It is currently occupied in this demo.";
    }

    if (value.includes("tomorrow")) {
      return "Tomorrow's highlights include the Campus Hackathon preparation session and the AI Club meetup.";
    }

    if (value.includes("print")) {
      return "I can route you to Print Hub. Upload your PDF, configure pages and generate a pickup QR.";
    }

    if (value.includes("mentor")) {
      return "I found two robotics mentors. Prof. Rahul Nair is the closest simulated match.";
    }

    return "I can help you discover campus people, events, services, rooms and opportunities. Try one of the suggestions below.";
  };

  const ask = (value = message) => {
    if (!value.trim()) return;

    const response = answer(value);

    setConversation((current) => [
      ...current,
      { role: "user", text: value },
      { role: "ai", text: response },
    ]);

    setMessage("");
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
          <p>Natural language access to your campus.</p>
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
              <p>{item.text}</p>
            </div>
          ))}

          <div className="ai-suggestions">
            {suggestions.map((suggestion) => (
              <button key={suggestion} onClick={() => ask(suggestion)}>
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
            placeholder="Ask Campus AI..."
          />
          <button onClick={() => ask()}>
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
          <span className="section-kicker">FUTURE</span>
          <h2>AI that can act, not just answer.</h2>
          <p>
            The next layer can use campus APIs to create orders, book
            resources and communicate with autonomous systems.
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

function NotificationsPage({ notifications, markRead, notify }) {
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

      <div className="notification-list">
        {notifications.map((notification) => (
          <article
            className={`notification-card ${
              notification.unread ? "unread" : ""
            }`}
            key={notification.id}
          >
            <span>
              {notification.type === "event" ? (
                <HiCalendarDays />
              ) : notification.type === "service" ? (
                <HiWrenchScrewdriver />
              ) : notification.type === "official" ? (
                <HiMegaphone />
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
        ))}
      </div>
    </section>
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

function PostComposer({ onClose, onCreate, user }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("General");
  const [tag, setTag] = useState("");

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
        Tag
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="e.g. robotics"
        />
      </label>

      <button
        className="primary wide"
        disabled={!title.trim()}
        onClick={() =>
          onCreate({
            type,
            title,
            author: user?.name || "Campus Student",
            accent: "violet",
            tags: tag ? [tag] : [],
          })
        }
      >
        Publish <HiArrowUpTray />
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
  const [name, setName] = useState("");
  const [usn, setUsn] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const cleanUsn = usn.trim().toUpperCase();

    if (signingUp && !name.trim()) {
      notify("Enter your full name");
      return;
    }
    if (!/^[A-Za-z0-9]{10}$/.test(cleanUsn)) {
      notify("USN must be exactly 10 letters/numbers");
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

      <button
        className="primary wide"
        disabled={loading}
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

function PrintModal({ onClose, setPrintFile, notify }) {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState(12);
  const [color, setColor] = useState("B&W");

  return (
    <ModalShell kicker="PRINT HUB" title="Upload & print" onClose={onClose}>
      <label>
        Document
        <input
          type="file"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            setFile(
              selected || null
            );

            setPrintFile(
              selected || null
            );
          }}
        />
      </label>

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
          <input
            type="number"
            min="1"
            value={pages}
            onChange={(event) => setPages(event.target.value)}
          />
        </label>

        <label>
          Print mode
          <select
            value={color}
            onChange={(event) => setColor(event.target.value)}
          >
            <option>B&W</option>
            <option>Colour</option>
          </select>
        </label>
      </div>

      <div className="price-preview">
        <span>Estimated total</span>
        <b>₹{Number(pages) * (color === "Colour" ? 5 : 2)}</b>
      </div>

      <button
        className="primary wide"
        onClick={async () => {

        try {

          if (!file) {
            notify(
              "Choose a document first"
            );

            return;
          }

          const currentUser =
            await getCurrentUser();

          if (!currentUser) {
            notify(
              "Sign in before printing"
            );

            return;
          }

          const job =
            await uploadPrintJob({
              userId:
                currentUser.id,

              file,

              pages:
                Number(pages),

              copies: 1,

              colorMode:
                color === "Colour"
                  ? "colour"
                  : "black_white",

              paperSize:
                "A4",

            });

          notify(
            `Print job created · ${job.pickup_code}`
          );

          onClose();

        } catch (error) {

          console.error(
            "Print job:",
            error
          );

          notify(
            error.message ||
            "Unable to create print job"
          );
        }
      }}
      >
        Place print order <HiCreditCard />
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

function CartModal({ title,cart,onClose,notify,type,onCheckout}) {
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
                <span>{item.name}</span>
                <small>{item.vendor || item.category}</small>
                <b>₹{item.price}</b>
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

function SOSModal({ onClose, notify }) {
  return (
    <ModalShell kicker="EMERGENCY" title="Campus SOS" onClose={onClose}>
      <div className="sos-card">
        <span><HiShieldCheck /></span>
        <b>Hold for emergency</b>
        <small>
          Campus security will receive your location in the production system.
        </small>
        <button
          onClick={() => {
            notify("SOS simulation activated");
            onClose();
          }}
        >
          <HiPhone /> Hold to activate SOS
        </button>
      </div>

      <div className="emergency-actions">
        <button onClick={() => notify("Campus security call simulated")}>
          <HiPhone /> Security
        </button>
        <button onClick={() => notify("Medical response requested")}>
          <HiExclamationTriangle /> Medical
        </button>
        <button onClick={() => notify("Campus help requested")}>
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
