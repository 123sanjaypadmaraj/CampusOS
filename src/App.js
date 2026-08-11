import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import {
  HiHome,
  HiSparkles,
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
  HiGlobeAlt,
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
} from "react-icons/hi2";

/* =========================================================
   NAVIGATION
========================================================= */

const navItems = [
  ["home", <HiHome />, "Home"],
  ["campus", <HiSparkles />, "Campus"],
  ["events", <HiCalendarDays />, "Events"],
  ["services", <HiWrenchScrewdriver />, "Services"],
  ["socialize", <HiGlobeAlt />, "Socialize"],
  ["profile", <HiUserCircle />, "Profile"],
];

/* =========================================================
   FREE DEMO FOOD IMAGES
   Unsplash images are linked remotely so the demo stays light.
========================================================= */

const FOOD_IMAGES = {
  dosa:
    "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=900&q=80",
  idli:
    "https://images.unsplash.com/photo-1630383249896-424eec5f8f6e?auto=format&fit=crop&w=900&q=80",
  biryani:
    "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=900&q=80",
  noodles:
    "https://images.unsplash.com/photo-1559314809-0d155014e29e?auto=format&fit=crop&w=900&q=80",
  pasta:
    "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=80",
  coffee:
    "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=900&q=80",
  sandwich:
    "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80",
  fries:
    "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80",
};

/* =========================================================
   COMMUNITY
========================================================= */

const postsSeed = [
  {
    id: 1,
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
    id: 2,
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
    id: 3,
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
    id: 4,
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
    id: 1,
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
    id: 2,
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
    id: 3,
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
  {
    id: 101,
    name: "Masala Dosa",
    vendor: "Udupi",
    price: 45,
    category: "South Indian",
    image: FOOD_IMAGES.dosa,
  },
  {
    id: 102,
    name: "Idli Vada",
    vendor: "Udupi",
    price: 35,
    category: "South Indian",
    image: FOOD_IMAGES.idli,
  },
  {
    id: 103,
    name: "Paneer Masala Dosa",
    vendor: "Udupi",
    price: 70,
    category: "South Indian",
    image: FOOD_IMAGES.dosa,
  },
  {
    id: 104,
    name: "Set Dosa",
    vendor: "Udupi",
    price: 55,
    category: "South Indian",
    image: FOOD_IMAGES.dosa,
  },

  {
    id: 201,
    name: "Chicken Roll",
    vendor: "Tango",
    price: 90,
    category: "Rolls",
    image: FOOD_IMAGES.sandwich,
  },
  {
    id: 202,
    name: "Veg Noodles",
    vendor: "Tango",
    price: 75,
    category: "Noodles",
    image: FOOD_IMAGES.noodles,
  },
  {
    id: 203,
    name: "Chicken Biryani",
    vendor: "Tango",
    price: 120,
    category: "Biryani",
    image: FOOD_IMAGES.biryani,
  },
  {
    id: 204,
    name: "Penne Pasta",
    vendor: "Tango",
    price: 95,
    category: "Pasta",
    image: FOOD_IMAGES.pasta,
  },
  {
    id: 205,
    name: "Grilled Sandwich",
    vendor: "Tango",
    price: 80,
    category: "Sandwich",
    image: FOOD_IMAGES.sandwich,
  },

  {
    id: 301,
    name: "Chicken Fried Rice",
    vendor: "Munch",
    price: 105,
    category: "Fried Rice",
    image: FOOD_IMAGES.biryani,
  },
  {
    id: 302,
    name: "Schezwan Fried Rice",
    vendor: "Munch",
    price: 90,
    category: "Fried Rice",
    image: FOOD_IMAGES.biryani,
  },
  {
    id: 303,
    name: "Schezwan Noodles",
    vendor: "Munch",
    price: 90,
    category: "Chinese",
    image: FOOD_IMAGES.noodles,
  },
  {
    id: 304,
    name: "Chilli Chicken",
    vendor: "Munch",
    price: 120,
    category: "Chinese",
    image: FOOD_IMAGES.biryani,
  },
  {
    id: 305,
    name: "Veg Manchurian",
    vendor: "Munch",
    price: 95,
    category: "Chinese",
    image: FOOD_IMAGES.noodles,
  },

  {
    id: 401,
    name: "Classic Coffee",
    vendor: "Nescafe",
    price: 25,
    category: "Coffee",
    image: FOOD_IMAGES.coffee,
  },
  {
    id: 402,
    name: "Cold Coffee",
    vendor: "Nescafe",
    price: 55,
    category: "Coffee",
    image: FOOD_IMAGES.coffee,
  },
  {
    id: 403,
    name: "Masala Maggi",
    vendor: "Nescafe",
    price: 45,
    category: "Maggi",
    image: FOOD_IMAGES.noodles,
  },
  {
    id: 404,
    name: "Chicken Maggi",
    vendor: "Nescafe",
    price: 80,
    category: "Maggi",
    image: FOOD_IMAGES.noodles,
  },
  {
    id: 405,
    name: "Chicken Nuggets",
    vendor: "Nescafe",
    price: 90,
    category: "Snacks",
    image: FOOD_IMAGES.fries,
  },
  {
    id: 406,
    name: "French Fries",
    vendor: "Nescafe",
    price: 70,
    category: "Snacks",
    image: FOOD_IMAGES.fries,
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
   SOCIALIZE — SPOOFED NEARBY COLLEGE DATA
========================================================= */

const socializePosts = [
  {
    id: 1,
    college: "PES University",
    location: "Banashankari",
    type: "Hackathon",
    title: "PES Open Innovation Challenge 2026",
    text: "Teams are building AI + sustainability solutions. Registration closes Friday.",
    author: "PES Innovation Cell",
    time: "18 min ago",
    likes: 184,
    comments: 32,
    tags: ["Hackathon", "AI", "Innovation"],
    verified: true,
  },
  {
    id: 2,
    college: "RV College of Engineering",
    location: "Mysore Road",
    type: "Event",
    title: "RVCE Robotics Open Lab",
    text: "Students from nearby colleges can attend the autonomous systems demo day.",
    author: "RVCE Robotics",
    time: "1 hr ago",
    likes: 126,
    comments: 19,
    tags: ["Robotics", "OpenLab"],
    verified: true,
  },
  {
    id: 3,
    college: "BMS College of Engineering",
    location: "Basavanagudi",
    type: "Opportunity",
    title: "Inter-college Product Design Sprint",
    text: "Designers, developers and product thinkers wanted for a 24-hour sprint.",
    author: "BMSCE E-Cell",
    time: "2 hrs ago",
    likes: 94,
    comments: 11,
    tags: ["Product", "Design", "Startup"],
    verified: true,
  },
  {
    id: 4,
    college: "Christ University",
    location: "Central Bengaluru",
    type: "Community",
    title: "Bengaluru College Tech Meetup",
    text: "Students from 6 colleges are joining a common AI builders meetup this weekend.",
    author: "Christ Tech Forum",
    time: "Today",
    likes: 211,
    comments: 47,
    tags: ["Meetup", "AI", "Networking"],
    verified: true,
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
  const [active, setActive] = useState("home");
  const [search, setSearch] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [user, setUser] = useState({
    name: "Sanjay Padmaraj",
    email: "sanjaypadmaraj@nhce.edu.in",
    usn: "1NH25CS123",
    course: "Computer Science & Engineering",
    year: "2nd Year",
  });
  const [toast, setToast] = useState("");
  const [postFilter, setPostFilter] = useState("All");
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("campus-theme") === "dark"
  );
  const [notifications, setNotifications] = useState(notificationsSeed);
  const [modal, setModal] = useState(null);
  const [posts, setPosts] = useState(postsSeed);
  const [foodCart, setFoodCart] = useState([]);
  const [storeCart, setStoreCart] = useState([]);
  const [printFile, setPrintFile] = useState(null);

  const notify = (message) => {
    setToast(message);
    window.clearTimeout(window.__campusToast);
    window.__campusToast = window.setTimeout(() => setToast(""), 2400);
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
    setFoodCart((cart) => [...cart, item]);
    notify(`${item.name} added to food cart`);
  };

  const addStore = (item) => {
    setStoreCart((cart) => [...cart, item]);
    notify(`${item.name} added to store cart`);
  };

  const createPost = (post) => {
    setPosts((current) => [
      {
        ...post,
        id: Date.now(),
        icon: <HiMegaphone />,
        time: "Just now",
        likes: 0,
        comments: 0,
        verified: true,
      },
      ...current,
    ]);
    setModal(null);
    notify("Post published to Campus Feed");
  };

  const markNotificationsRead = () => {
    setNotifications((items) =>
      items.map((item) => ({ ...item, unread: false }))
    );
  };

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
          people={peopleSeed}
          clubs={clubs}
          go={go}
        />
      );
    }

    if (active === "events") {
      return (
        <Events
          notify={notify}
          events={eventsSeed}
          opportunities={opportunities}
          mentors={mentors}
          go={go}
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
      return <Socialize notify={notify} go={go} />;
    }

    if (active === "profile") {
      return (
        <Profile
          user={user}
          onLogin={() => setLoginOpen(true)}
          notify={notify}
          openModal={setModal}
        />
      );
    }

    if (active === "map") {
      return <CampusMap notify={notify} openModal={setModal} />;
    }

    if (active === "people") {
      return (
        <People notify={notify} people={peopleSeed} openModal={setModal} />
      );
    }

    if (active === "clubs") {
      return <Clubs notify={notify} clubs={clubs} />;
    }

    if (active === "food") {
      return (
        <Food
          notify={notify}
          canteens={canteens}
          items={foodItems}
          cart={foodCart}
          addFood={addFood}
          openModal={setModal}
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
        />
      );
    }

    if (active === "ai") {
      return <CampusAI notify={notify} go={go} />;
    }

    if (active === "autonomous") {
      return <AutonomousCampus notify={notify} devices={autonomousDevices} />;
    }

    if (active === "calendar") {
      return <MyCalendar notify={notify} events={eventsSeed} />;
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
            <b>New Horizon Campus</b>
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
            <button className="login-btn" onClick={() => setLoginOpen(true)}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <main>{renderPage()}</main>

      <nav className="bottom-nav">
        {navItems.map(([key, icon, label]) => (
          <button
            key={key}
            className={active === key ? "active" : ""}
            onClick={() => go(key)}
          >
            <span>{icon}</span>
            <small>{label}</small>
          </button>
        ))}
      </nav>

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLogin={(u) => {
            setUser(u);
            setLoginOpen(false);
            notify(`Welcome, ${u.name.split(" ")[0]}!`);
          }}
        />
      )}

      {modal === "post" && (
        <PostComposer
          onClose={() => setModal(null)}
          onCreate={createPost}
        />
      )}

      {modal === "food-cart" && (
        <CartModal
          title="Food cart"
          cart={foodCart}
          type="food"
          onClose={() => setModal(null)}
          notify={notify}
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
                See what's happening <b><HiArrowRight /></b>
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
            <p>Here's what's happening around you.</p>
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
            icon={<HiGlobeAlt />}
            title="Socialize"
            text="Nearby colleges"
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
            icon={<HiGlobeAlt />}
            title="Socialize"
            text="Discover what's happening nearby"
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
              "Find me a Flutter developer." · "Where is Lab 204?" · "What is
              happening tomorrow?"
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
  openModal,
  go,
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
          icon={<HiGlobeAlt />}
          title="Socialize"
          text="Connect beyond campus"
          onClick={() => go("socialize")}
        />
      </div>

      <div className="feed-layout">
        <div className="feed">
          {posts.map((post) => (
            <Post key={post.id} post={post} notify={notify} />
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
            <b>8,000+</b>
            <span>students</span>
          </div>

          <div className="mini-stat">
            <b>42</b>
            <span>active clubs</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Post({ post, notify }) {
  return (
    <article className={`post ${post.accent}`}>
      <div className="post-head">
        <div className="avatar">{post.author[0]}</div>

        <div>
          <b>
            {post.author}{" "}
            {post.verified && <HiShieldCheck className="verified" />}
          </b>
          <small>{post.time}</small>
        </div>

        <button
          onClick={() => notify("Post options opened")}
          aria-label="Post options"
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
        <button onClick={() => notify("Liked")}>
          <HiHeart /> {post.likes}
        </button>
        <button onClick={() => notify("Comments opened")}>
          <HiChatBubbleOvalLeft /> {post.comments}
        </button>
        <button onClick={() => notify("Post shared")}>
          <HiArrowUpTray /> Share
        </button>
      </div>
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

function Clubs({ notify, clubs: clubList }) {
  return (
    <section className="page-section">
      <PageHeader
        kicker="STUDENT COMMUNITIES"
        title="Clubs Hub"
        text="Discover the communities shaping campus life."
      />

      <div className="club-grid">
        {clubList.map((club) => (
          <article className="club-card" key={club.id}>
            <div className="club-icon">
              <HiAcademicCap />
            </div>
            <h3>{club.name}</h3>
            <p>{club.description}</p>

            <div className="club-stats">
              <span>{club.members} members</span>
              <span>{club.events} events</span>
            </div>

            <button
              className="ghost"
              onClick={() => notify(`${club.name} opened`)}
            >
              View club <HiArrowRight />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

/* =========================================================
   EVENTS
========================================================= */

function Events({ notify, events, opportunities: opps, mentors: mentorList }) {
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
        {events.map((event) => (
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
                  onClick={() =>
                    notify(`${event.title}: registration opened`)
                  }
                >
                  Register
                </button>

                <button
                  className="ghost"
                  onClick={() => notify("Event saved")}
                >
                  <HiHeart /> Save
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
    </section>
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

function Food({ canteens: vendorList, items, cart, addFood, openModal }) {
  const [selectedCanteen, setSelectedCanteen] = useState("All");
  const [q, setQ] = useState("");

  const filtered = items.filter(
    (item) =>
      (selectedCanteen === "All" || item.vendor === selectedCanteen) &&
      `${item.name} ${item.category}`
        .toLowerCase()
        .includes(q.toLowerCase())
  );

  const total = cart.reduce((sum, item) => sum + item.price, 0);

  return (
    <section className="page-section food-page">
      <PageHeader
        kicker="CAMPUS FOOD"
        title="Food Hub"
        text="Four canteens, one campus checkout."
        action={
          <button className="primary" onClick={() => openModal("food-cart")}>
            <HiShoppingCart /> Cart ({cart.length})
          </button>
        }
      />

      <div className="canteen-status-grid">
        {vendorList.map((canteen) => (
          <button
            key={canteen.id}
            className={`canteen-status ${
              selectedCanteen === canteen.name ? "selected" : ""
            }`}
            onClick={() =>
              setSelectedCanteen(
                selectedCanteen === canteen.name ? "All" : canteen.name
              )
            }
          >
            <div>
              <div>
                <b>{canteen.name}</b>
                <small>{canteen.eta}</small>
              </div>
            </div>

            <p className="canteen-subtitle">{canteen.subtitle}</p>

            <span className={`load-bar ${canteen.color}`}>
              <i style={{ width: `${canteen.load}%` }} />
            </span>

            <small>{canteen.status}</small>
          </button>
        ))}
      </div>

      <div className="searchbar compact wide-search">
        <HiMagnifyingGlass />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search dosa, biryani, Maggi, coffee..."
        />
      </div>

      <div className="product-grid food-product-grid">
        {filtered.map((item) => (
          <FoodCard key={item.id} item={item} add={addFood} />
        ))}
      </div>

      {cart.length > 0 && (
        <div className="floating-cart">
          <div>
            <HiShoppingCart />
            <b>{cart.length} items</b>
            <span>₹{total}</span>
          </div>
          <button onClick={() => openModal("food-cart")}>
            Checkout <HiArrowRight />
          </button>
        </div>
      )}
    </section>
  );
}

function FoodCard({ item, add }) {
  return (
    <article className="product-card food-card">
      <div className="food-image-wrap">
        <img src={item.image} alt={item.name} loading="lazy" />
      </div>

      <span className="event-club">{item.category}</span>
      <h3>{item.name}</h3>
      <p>{item.vendor}</p>

      <div className="product-bottom">
        <b>₹{item.price}</b>
        <button onClick={() => add(item)}>
          <HiPlus /> Add
        </button>
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

function Profile({ user, onLogin, notify }) {
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
            <span className="verified-pill">
              <HiShieldCheck /> VERIFIED STUDENT
            </span>
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
            onClick={() => notify("Edit profile opened")}
          >
            Edit profile
          </button>
        </div>

        <div className="linkedin-actions">
          <button className="primary" onClick={() => notify("Profile shared")}>
            <HiArrowUpTray /> Share profile
          </button>
          <button
            className="ghost"
            onClick={() => notify("Availability updated")}
          >
            <HiUserPlus /> Open to projects
          </button>
        </div>
      </div>

      <div className="profile-grid linkedin-grid">
        <div className="profile-box">
          <span className="section-kicker">ABOUT</span>
          <h3>Student builder focused on AI + hardware.</h3>
          <p>
            Building Campus OS to connect students, campus services, AI and
            future autonomous systems into one digital layer.
          </p>
        </div>

        <div className="profile-box">
          <span className="section-kicker">ACTIVITY</span>
          <h3>Campus contribution</h3>
          <div className="stats">
            <b>12<span>Posts</span></b>
            <b>5<span>Events</span></b>
            <b>3<span>Teams</span></b>
            <b>17<span>Helpful</span></b>
          </div>
        </div>
      </div>

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
          <p><HiTrophy /> Hackathon finalist</p>
          <p><HiUserGroup /> Club coordinator</p>
          <p><HiCpuChip /> AI project showcase</p>
          <p><HiStar /> Community contributor</p>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   SOCIALIZE
========================================================= */

function Socialize({ notify, go }) {
  const [filter, setFilter] = useState("All");

  const filters = ["All", "Hackathon", "Event", "Opportunity", "Community"];

  const filtered = socializePosts.filter(
    (post) => filter === "All" || post.type === filter
  );

  return (
    <section className="page-section socialize-page">
      <PageHeader
        kicker="BEYOND YOUR CAMPUS"
        title="Socialize"
        text="See what students and clubs are building across nearby colleges."
        action={
          <button
            className="primary"
            onClick={() => notify("Cross-campus post composer opened")}
          >
            <HiPlus /> Post to network
          </button>
        }
      />

      <div className="socialize-hero">
        <div>
          <span className="section-kicker">BENGALURU STUDENT NETWORK</span>
          <h2>Your campus is bigger than your campus.</h2>
          <p>
            Discover hackathons, open labs, meetups and opportunities from
            colleges around you.
          </p>
        </div>

        <div className="socialize-stats">
          <div><b>18</b><small>nearby colleges</small></div>
          <div><b>142</b><small>open opportunities</small></div>
          <div><b>36</b><small>events this week</small></div>
        </div>
      </div>

      <div className="socialize-filter-row">
        {filters.map((item) => (
          <button
            key={item}
            className={filter === item ? "chip active" : "chip"}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="socialize-layout">
        <div className="socialize-feed">
          {filtered.map((post) => (
            <article className="social-post" key={post.id}>
              <div className="social-post-head">
                <div className="college-avatar">
                  {post.college[0]}
                </div>

                <div>
                  <b>
                    {post.college} <HiShieldCheck />
                  </b>
                  <small>
                    {post.location} · {post.time}
                  </small>
                </div>

                <span className="social-type">{post.type}</span>
              </div>

              <h3>{post.title}</h3>
              <p>{post.text}</p>

              <div className="tags">
                {post.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>

              <div className="social-post-actions">
                <button onClick={() => notify("Liked")}>
                  <HiHeart /> {post.likes}
                </button>
                <button onClick={() => notify("Comments opened")}>
                  <HiChatBubbleOvalLeft /> {post.comments}
                </button>
                <button onClick={() => notify("Shared to your campus")}>
                  <HiArrowUpTray /> Share
                </button>
              </div>
            </article>
          ))}
        </div>

        <aside className="socialize-sidebar">
          <span className="section-kicker">NEARBY COLLEGES</span>
          {[
            "PES University",
            "RV College of Engineering",
            "BMSCE",
            "Christ University",
            "MS Ramaiah",
          ].map((college, index) => (
            <button
              key={college}
              onClick={() => notify(`${college} selected`)}
            >
              <span>{index + 1}</span>
              <div>
                <b>{college}</b>
                <small>{12 + index * 4} active posts</small>
              </div>
              <HiChevronRight />
            </button>
          ))}

          <div className="socialize-note">
            <HiGlobeAlt />
            <b>Cross-campus discovery</b>
            <small>
              Production version can use verified college domains and
              institution-level moderation.
            </small>
          </div>
        </aside>
      </div>
    </section>
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

function ServiceDetail({ serviceId, notify, go, openModal }) {
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
        <div className="service-detail-grid">
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
        </div>
      )}

      {serviceId === "issues" && (
        <IssueService notify={notify} />
      )}

      {serviceId === "booking" && (
        <BookingService notify={notify} />
      )}

      {serviceId === "lost" && (
        <LostService notify={notify} />
      )}

      {serviceId === "market" && (
        <MarketplaceService notify={notify} />
      )}

      {serviceId === "pass" && (
        <PassService notify={notify} />
      )}

      {serviceId === "hostel" && (
        <HostelService notify={notify} />
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

function IssueService({ notify }) {
  const categories = [
    ["Wi-Fi", <HiWifi />],
    ["Electrical", <HiLightBulb />],
    ["AC", <HiBoltSlash />],
    ["Furniture", <HiBuildingOffice2 />],
    ["Lab Equipment", <HiComputerDesktop />],
    ["Other", <HiExclamationTriangle />],
  ];

  return (
    <div className="service-detail-grid">
      {categories.map(([title, icon]) => (
        <WorkflowCard
          key={title}
          icon={icon}
          title={title}
          text={`Report a ${title.toLowerCase()} issue.`}
          button="Report"
          onClick={() => notify(`${title} issue ticket created`)}
        />
      ))}
    </div>
  );
}

function BookingService({ notify }) {
  const resources = [
    ["Innovation Lab", "Available", "2nd Floor"],
    ["Seminar Hall 2", "Available", "Main Block"],
    ["Robotics Lab", "Available", "Block D"],
    ["Sports Court", "Booked", "Ground"],
  ];

  return (
    <div className="resource-list">
      {resources.map(([name, status, location]) => (
        <article className="resource-row" key={name}>
          <div className="resource-icon"><HiBuildingOffice2 /></div>
          <div>
            <b>{name}</b>
            <small>{location} · {status}</small>
          </div>
          <button
            onClick={() => notify(`${name} booking request submitted`)}
          >
            Book <HiArrowRight />
          </button>
        </article>
      ))}
    </div>
  );
}

function LostService({ notify }) {
  const items = [
    ["Black backpack", "Found near Block B · 18 min ago"],
    ["Student ID card", "Found near Main Gate · 1 hr ago"],
    ["AirPods case", "Found near Library · Yesterday"],
  ];

  return (
    <div className="resource-list">
      {items.map(([name, location]) => (
        <article className="resource-row" key={name}>
          <div className="resource-icon"><HiMagnifyingGlassCircle /></div>
          <div>
            <b>{name}</b>
            <small>{location}</small>
          </div>
          <button onClick={() => notify(`Claim request submitted for ${name}`)}>
            Claim
          </button>
        </article>
      ))}
      <button className="primary" onClick={() => notify("Lost item report opened")}>
        <HiPlus /> Report lost item
      </button>
    </div>
  );
}

function MarketplaceService({ notify }) {
  const listings = [
    ["MacBook sleeve", "₹450", "CSE 3rd Year"],
    ["Scientific calculator", "₹420", "ECE 2nd Year"],
    ["Arduino Uno", "₹500", "Robotics Club"],
  ];

  return (
    <div className="resource-list">
      {listings.map(([name, price, seller]) => (
        <article className="resource-row" key={name}>
          <div className="resource-icon"><HiShoppingCart /></div>
          <div>
            <b>{name}</b>
            <small>{seller}</small>
          </div>
          <strong>{price}</strong>
          <button onClick={() => notify(`Chat opened with seller of ${name}`)}>
            Contact
          </button>
        </article>
      ))}
    </div>
  );
}

function PassService({ notify }) {
  return (
    <div className="digital-pass-card">
      <div className="qr-placeholder">
        <HiQrCode />
      </div>
      <div>
        <span className="section-kicker">STUDENT PASS</span>
        <h2>NHCE · SANJAY PADMARAJ</h2>
        <p>Valid for events, workshops, pickups and approved campus workflows.</p>
        <button className="primary" onClick={() => notify("QR pass displayed")}>
          Display QR <HiQrCode />
        </button>
      </div>
    </div>
  );
}

function HostelService({ notify }) {
  return (
    <div className="hostel-grid">
      <WorkflowCard icon={<HiHomeModern />} title="Room" text="B-204 · Occupied" button="Open" onClick={() => notify("Room details opened")} />
      <WorkflowCard icon={<HiShoppingBag />} title="Mess" text="Today's menu available." button="View menu" onClick={() => notify("Mess menu opened")} />
      <WorkflowCard icon={<HiWrenchScrewdriver />} title="Maintenance" text="2 open requests." button="Track" onClick={() => notify("Maintenance opened")} />
      <WorkflowCard icon={<HiArrowPath />} title="Laundry" text="12 slots available." button="Book" onClick={() => notify("Laundry booking opened")} />
    </div>
  );
}

function DeliveryService({ notify }) {
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
      <button className="primary" onClick={() => notify("Delivery request created — demo")}>
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
            <h3>August 2026</h3>
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
              const hasEvent = [12, 14, 16, 22].includes(day);
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

function PostComposer({ onClose, onCreate }) {
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
            author: "Sanjay Padmaraj",
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

function LoginModal({ onClose, onLogin }) {
  const [name, setName] = useState("Sanjay Padmaraj");
  const [email, setEmail] = useState("sanjaypadmaraj@nhce.edu.in");
  const [usn, setUsn] = useState("1NH25CS123");

  return (
    <ModalShell
      kicker="COLLEGE ACCOUNT"
      title="Welcome to Campus OS"
      onClose={onClose}
    >
      <p>
        Use your college identity to join the verified campus network.
      </p>

      <label>
        Full name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label>
        College email
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>

      <label>
        USN
        <input value={usn} onChange={(e) => setUsn(e.target.value)} />
      </label>

      <button
        className="primary wide"
        onClick={() =>
          onLogin({
            name: name || "Campus Student",
            email,
            usn,
            course: "Computer Science & Engineering",
            year: "2nd Year",
          })
        }
      >
        Continue with college account <HiArrowRight />
      </button>

      <small className="login-note">
        Demo mode · authentication will be connected to Supabase later.
      </small>
    </ModalShell>
  );
}

function PrintModal({ onClose, setPrintFile, notify }) {
  const [file, setFile] = useState("");
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
            setFile(selected?.name || "");
            setPrintFile(selected?.name || "");
          }}
        />
      </label>

      {file && (
        <div className="file-chip">
          <HiDocumentArrowUp />
          {file}
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
        onClick={() => {
          notify("Print order created — demo");
          onClose();
        }}
      >
        Place print order <HiCreditCard />
      </button>
    </ModalShell>
  );
}

function CartModal({ title, cart, onClose, notify, type }) {
  const total = cart.reduce((sum, item) => sum + item.price, 0);

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
            onClick={() => {
              notify("Checkout opened — payment integration comes later");
              onClose();
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

ReactDOM.createRoot(document.getElementById("root")).render(<App />);