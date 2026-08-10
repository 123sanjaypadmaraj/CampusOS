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
  HiBattery100,
  HiPaperAirplane,
  HiPlus,
  HiUserPlus,
  HiGlobeAlt,
  HiMagnifyingGlassPlus,
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
} from "react-icons/hi2";

/* =========================================================
   DATA
========================================================= */

const navItems = [
  ["home", <HiHome />, "Home"],
  ["campus", <HiSparkles />, "Campus"],
  ["events", <HiCalendarDays />, "Events"],
  ["services", <HiWrenchScrewdriver />, "Services"],
  ["profile", <HiUserCircle />, "Profile"],
];

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
    title: "Congratulations to the robotics team for winning the regional challenge!",
    author: "Robotics Club",
    time: "Today",
    likes: 119,
    comments: 21,
    accent: "green",
    tags: ["Achievement"],
    verified: true,
  },
];

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
    attendees: 96,
  },
  {
    id: 4,
    date: "18",
    month: "AUG",
    title: "Entrepreneurship Bootcamp",
    club: "E-Cell",
    time: "10:00 AM",
    place: "Innovation Hub",
    color: "orange",
    category: "Bootcamp",
    attendees: 142,
  },
];

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

const canteens = [
  { id: 1, name: "Canteen 1", status: "Quiet", eta: "8–12 min", load: 32 },
  { id: 2, name: "Canteen 2", status: "Moderate", eta: "12–18 min", load: 58 },
  { id: 3, name: "Canteen 3", status: "Busy", eta: "20–28 min", load: 84 },
  { id: 4, name: "Canteen 4", status: "Quiet", eta: "6–10 min", load: 26 },
];

const foodItems = [
  { id: 1, name: "Masala Dosa", vendor: "Canteen 1", price: 45, category: "Breakfast" },
  { id: 2, name: "Paneer Roll", vendor: "Canteen 2", price: 65, category: "Snacks" },
  { id: 3, name: "Veg Fried Rice", vendor: "Canteen 3", price: 80, category: "Lunch" },
  { id: 4, name: "Cold Coffee", vendor: "Canteen 4", price: 55, category: "Drinks" },
  { id: 5, name: "Idli Vada", vendor: "Canteen 1", price: 35, category: "Breakfast" },
  { id: 6, name: "Chicken Sandwich", vendor: "Canteen 4", price: 90, category: "Snacks" },
];

const storeItems = [
  { id: 1, name: "Engineering Record", price: 45, stock: 34, category: "Records" },
  { id: 2, name: "A4 Sheets — 100", price: 30, stock: 120, category: "Paper" },
  { id: 3, name: "Scientific Calculator", price: 650, stock: 12, category: "Electronics" },
  { id: 4, name: "Black Gel Pen", price: 10, stock: 240, category: "Stationery" },
  { id: 5, name: "Drawing Sheets", price: 20, stock: 82, category: "Paper" },
  { id: 6, name: "Lab Coat", price: 420, stock: 18, category: "Academic" },
];

const peopleSeed = [
  { id: 1, name: "Arjun Menon", course: "CSE", year: "2nd Year", skills: ["React", "Python", "AI/ML"], match: 96 },
  { id: 2, name: "Meera Nair", course: "ECE", year: "3rd Year", skills: ["Robotics", "Arduino", "CAD"], match: 91 },
  { id: 3, name: "Rahul Kumar", course: "CSE", year: "2nd Year", skills: ["Node.js", "Flutter", "Firebase"], match: 87 },
  { id: 4, name: "Ananya Rao", course: "ISE", year: "3rd Year", skills: ["UI/UX", "Figma", "React"], match: 84 },
];

const clubs = [
  { name: "AI Club", members: "1,284", icon: <HiCpuChip />, color: "purple", events: 12 },
  { name: "Coding Club", members: "1,842", icon: <HiComputerDesktop />, color: "blue", events: 18 },
  { name: "Robotics Club", members: "642", icon: <HiRocketLaunch />, color: "green", events: 9 },
  { name: "E-Cell", members: "914", icon: <HiLightBulb />, color: "orange", events: 14 },
];

const mentors = [
  { name: "Dr. Priya Sharma", field: "AI / Machine Learning", slots: 4 },
  { name: "Prof. Rahul Nair", field: "Robotics & Embedded Systems", slots: 2 },
  { name: "Ankit Varma", field: "Entrepreneurship", slots: 6 },
];

const opportunities = [
  { company: "Campus Innovation Lab", role: "AI Research Intern", type: "Research", tags: ["Python", "ML"], deadline: "18 Aug" },
  { company: "Tech Startup Hub", role: "React Developer", type: "Internship", tags: ["React", "Node"], deadline: "21 Aug" },
  { company: "Robotics Lab", role: "Embedded Systems Intern", type: "Research", tags: ["ESP32", "C++"], deadline: "25 Aug" },
];

const rooms = [
  { name: "Innovation Lab", block: "Block B", floor: "2nd Floor", type: "Lab", status: "Available" },
  { name: "Lab 302", block: "Block C", floor: "3rd Floor", type: "Computer Lab", status: "Occupied" },
  { name: "Seminar Hall 2", block: "Main Block", floor: "1st Floor", type: "Hall", status: "Available" },
  { name: "Robotics Lab", block: "Block D", floor: "Ground Floor", type: "Lab", status: "Available" },
];

const notificationsSeed = [
  { id: 1, type: "event", title: "AI Workshop starts in 30 minutes", time: "10 min ago", unread: true },
  { id: 2, type: "service", title: "Print order #2048 is ready", time: "24 min ago", unread: true },
  { id: 3, type: "community", title: "Someone replied to your post", time: "1 hr ago", unread: true },
  { id: 4, type: "official", title: "Semester schedule has been published", time: "Yesterday", unread: false },
];

const autonomousDevices = [
  { id: "DR-01", name: "Delivery Robot #01", type: "Delivery Robot", status: "Online", battery: 86, location: "Block B", icon: <HiTruck /> },
  { id: "DR-02", name: "Delivery Robot #02", type: "Delivery Robot", status: "Charging", battery: 42, location: "Service Bay", icon: <HiTruck /> },
  { id: "DL-01", name: "Campus Drone #01", type: "Autonomous Drone", status: "Standby", battery: 91, location: "Drone Pad", icon: <HiPaperAirplane /> },
  { id: "IOT-48", name: "Environmental Network", type: "IoT Network", status: "48 / 48 online", battery: 100, location: "Campus-wide", icon: <HiSignal /> },
];

const mapLocations = [
  { id: "a", name: "Block A", x: 14, y: 22, type: "Academic", rooms: 32 },
  { id: "b", name: "Block B", x: 68, y: 22, type: "Academic", rooms: 28 },
  { id: "c", name: "Block C", x: 14, y: 65, type: "Academic", rooms: 24 },
  { id: "d", name: "Labs", x: 68, y: 65, type: "Laboratory", rooms: 18 },
  { id: "canteen", name: "Food Court", x: 42, y: 47, type: "Food", rooms: 4 },
  { id: "main", name: "Main Auditorium", x: 42, y: 80, type: "Events", rooms: 1 },
];

const campusStats = [
  ["Students Online", "1,842", "12.4%"],
  ["Events Today", "12", "+3"],
  ["Open Issues", "23", "-18%"],
  ["Print Orders", "184", "+21%"],
];

const mapQuickSearch = ["Lab 302", "Innovation Lab", "Canteen 4", "Main Auditorium"];

/* =========================================================
   APP
========================================================= */

function App() {
  const [active, setActive] = useState("home");
  const [search, setSearch] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [toast, setToast] = useState("");
  const [postFilter, setPostFilter] = useState("All");
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("campus-theme") === "dark");
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

  const toggleTheme = () => {
    setDarkMode((current) => {
      const next = !current;
      localStorage.setItem("campus-theme", next ? "dark" : "light");
      return next;
    });
  };

  const go = (key) => {
    setActive(key);
    setModal(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        verified: false,
      },
      ...current,
    ]);
    setModal(null);
    notify("Post published to Campus Feed");
  };

  const markNotificationsRead = () => {
    setNotifications((items) => items.map((n) => ({ ...n, unread: false })));
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
        />
      );
    }

    if (active === "events") {
      return (
        <Events
          notify={notify}
          openModal={setModal}
          events={eventsSeed}
          opportunities={opportunities}
          mentors={mentors}
        />
      );
    }

    if (active === "services") {
      return (
        <Services
          notify={notify}
          openModal={setModal}
          foodCart={foodCart}
          storeCart={storeCart}
          addFood={addFood}
          addStore={addStore}
          printFile={printFile}
          setPrintFile={setPrintFile}
        />
      );
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
      return <People notify={notify} people={peopleSeed} openModal={setModal} />;
    }

    if (active === "clubs") {
      return <Clubs notify={notify} clubs={clubs} openModal={setModal} />;
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
      return <CampusAI notify={notify} go={go} openModal={setModal} />;
    }

    if (active === "autonomous") {
      return <AutonomousCampus notify={notify} devices={autonomousDevices} />;
    }

    if (active === "calendar") {
      return <MyCalendar notify={notify} events={eventsSeed} />;
    }

    if (active === "notifications") {
      return <NotificationsPage notifications={notifications} markRead={markNotificationsRead} notify={notify} />;
    }

    return <Home go={go} search={search} setSearch={setSearch} notify={notify} openModal={setModal} />;
  };

  return (
    <div className={`app-shell ${darkMode ? "dark-mode" : "light-mode"}`}>
      <header className="topbar">
        <button className="brand" onClick={() => go("home")} aria-label="Campus OS home">
          <span className="brand-mark">C</span>
          <span><b>Campus</b><em>OS</em></span>
        </button>

        <div className="location">
          <span className="pin"><HiMapPin /></span>
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
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            <span className="theme-track">
              <span className="theme-thumb">{darkMode ? <HiMoon /> : <HiSun />}</span>
            </span>
          </button>

          {user ? (
            <button className="profile-mini" onClick={() => go("profile")}>
              <span>{user.name[0]}</span>{user.name.split(" ")[0]}
            </button>
          ) : (
            <button className="login-btn" onClick={() => setLoginOpen(true)}>Sign in</button>
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
        <PostComposer onClose={() => setModal(null)} onCreate={createPost} />
      )}

      {modal === "notifications" && (
        <NotificationPanel
          notifications={notifications}
          onClose={() => setModal(null)}
          markRead={markNotificationsRead}
        />
      )}

      {modal === "sos" && <SOSModal onClose={() => setModal(null)} notify={notify} />}

      {modal === "navigation" && (
        <NavigationModal location={modal.location} onClose={() => setModal(null)} notify={notify} />
      )}

      {toast && <div className="toast"><HiCheckCircle />{toast}</div>}
    </div>
  );
}

/* =========================================================
   HOME
========================================================= */

function Home({ go, search, setSearch, notify, notifications, openModal, foodCart, storeCart }) {
  const unread = notifications.filter((n) => n.unread).length;

  return (
    <>
      <section className="hero-wrap">
        <div className="hero">
          <div className="hero-copy">
            <span className="eyebrow">THE DIGITAL LAYER FOR CAMPUS LIFE</span>
            <h1>Everything happening<br /><span>on your campus.</span></h1>
            <p>
              Connect with students, discover opportunities, access campus services,
              and eventually connect the campus to intelligent hardware.
            </p>

            <div className="searchbar">
              <span><HiMagnifyingGlass /></span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events, clubs, services, people..."
              />
              <kbd>⌘ K</kbd>
            </div>

            <div className="hero-links">
              <button onClick={() => go("campus")}>Explore Campus <b><HiArrowRight /></b></button>
              <button onClick={() => go("events")}>See what's happening <b><HiArrowRight /></b></button>
            </div>
          </div>

          <div className="hero-orbit">
            <div className="orbit-card card-a">
              <HiRocketLaunch /><b>Hackathon</b><small>3 teams need members</small>
            </div>
            <div className="orbit-card card-b">
              <HiCalendarDays /><b>AI Workshop</b><small>Today · 2:00 PM</small>
            </div>
            <div className="orbit-card card-c">
              <HiUserGroup /><b>Help needed</b><small>Block C · 2 replies</small>
            </div>
            <div className="orbit-core"><strong>C</strong><span>Campus<br />Pulse</span></div>
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
          <button className="text-btn" onClick={() => go("calendar")}>My calendar <HiArrowRight /></button>
        </div>

        <div className="quick-grid">
          <QuickMetric icon={<HiCalendarDays />} value="12" label="Events today" onClick={() => go("events")} />
          <QuickMetric icon={<HiBolt />} value="3" label="Active hackathons" onClick={() => go("events")} />
          <QuickMetric icon={<HiPrinter />} value="1" label="Print order ready" onClick={() => go("services")} />
          <QuickMetric icon={<HiBell />} value={String(unread)} label="Unread updates" onClick={() => go("notifications")} />
        </div>
      </section>

      <section className="page-section pulse-section">
        <div className="section-head">
          <div>
            <span className="section-kicker">LIVE NOW</span>
            <h2>Campus Pulse</h2>
            <p>What students are talking about right now.</p>
          </div>
          <button className="text-btn" onClick={() => go("campus")}>View all <HiArrowRight /></button>
        </div>

        <div className="pulse-grid">
          <PulseCard icon={<HiBolt />} label="HACKATHON" title="3 teams are looking for developers" meta="Flutter · React · ML" onClick={() => go("campus")} />
          <PulseCard icon={<HiCalendarDays />} label="EVENT" title="Generative AI Workshop" meta="Today · Seminar Hall 2" onClick={() => go("events")} />
          <PulseCard icon={<HiWrenchScrewdriver />} label="CAMPUS" title="8 maintenance requests resolved" meta="This week" onClick={() => go("services")} />
          <PulseCard icon={<HiTrophy />} label="ACHIEVEMENT" title="Robotics team wins regional challenge" meta="42 students congratulated" onClick={() => go("campus")} />
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
          <ActionTile icon={<HiPrinter />} title="Print" text="Upload & collect" onClick={() => go("services")} />
          <ActionTile icon={<HiShoppingCart />} title="Food" text={`${foodCart.length} items in cart`} onClick={() => go("food")} />
          <ActionTile icon={<HiBookOpen />} title="Store" text={`${storeCart.length} items in cart`} onClick={() => go("store")} />
          <ActionTile icon={<HiMap />} title="Campus Map" text="Find a room" onClick={() => go("map")} />
          <ActionTile icon={<HiBuildingOffice2 />} title="Book" text="Rooms & resources" onClick={() => go("services")} />
          <ActionTile icon={<HiExclamationTriangle />} title="Report" text="Campus issue" onClick={() => go("services")} />
          <ActionTile icon={<HiUserPlus />} title="Find People" text="Skills & teams" onClick={() => go("people")} />
          <ActionTile icon={<HiSparkles />} title="Campus AI" text="Ask & act" onClick={() => go("ai")} />
        </div>
      </section>

      <section className="page-section feature-strip">
        <div>
          <span className="section-kicker">ONE PLATFORM</span>
          <h2>Built around real student needs.</h2>
        </div>
        <div className="feature-row">
          <Feature icon={<HiMegaphone />} title="Community" text="Posts, clubs, help & lost and found" onClick={() => go("campus")} />
          <Feature icon={<HiRocketLaunch />} title="Opportunities" text="Hackathons, events & team matching" onClick={() => go("events")} />
          <Feature icon={<HiWrenchScrewdriver />} title="Services" text="Food, print, store, map & booking" onClick={() => go("services")} />
          <Feature icon={<HiCpuChip />} title="Campus AI" text="Ask questions. Find people. Take action." onClick={() => go("ai")} />
        </div>
      </section>

      <section className="page-section ai-banner">
        <div>
          <span className="ai-icon"><HiSparkles /></span>
          <div>
            <span className="section-kicker">CAMPUS AI</span>
            <h2>Your campus, searchable in natural language.</h2>
            <p>"Find me a Flutter developer." · "Where is Lab 204?" · "What is happening tomorrow?"</p>
          </div>
        </div>
        <button onClick={() => go("ai")}>Ask Campus AI <b><HiArrowRight /></b></button>
      </section>

      <section className="page-section autonomous-preview">
        <div className="section-head">
          <div>
            <span className="section-kicker">FUTURE INFRASTRUCTURE</span>
            <h2>Autonomous Campus</h2>
            <p>One digital layer for people, services, AI and future hardware.</p>
          </div>
          <button className="text-btn" onClick={() => go("autonomous")}>Explore <HiArrowRight /></button>
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

function QuickMetric({ icon, value, label, onClick }) {
  return <button className="quick-metric" onClick={onClick}><span>{icon}</span><b>{value}</b><small>{label}</small><HiArrowRight /></button>;
}

function ActionTile({ icon, title, text, onClick }) {
  return <button className="action-tile" onClick={onClick}><span>{icon}</span><b>{title}</b><small>{text}</small><HiArrowRight /></button>;
}

function DeviceMini({ icon, name, value }) {
  return <div className="device-mini"><span>{icon}</span><div><b>{name}</b><small>{value}</small></div><HiSignal /></div>;
}

function PulseCard({ icon, label, title, meta, onClick }) {
  return <button className="pulse-card" onClick={onClick}><span className="pulse-icon">{icon}</span><span className="pulse-label">{label}</span><strong>{title}</strong><small>{meta}</small><span className="arrow"><HiArrowRight /></span></button>;
}

function Feature({ icon, title, text, onClick }) {
  return <button className="feature" onClick={onClick}><span>{icon}</span><b>{title}</b><small>{text}</small></button>;
}

/* =========================================================
   CAMPUS COMMUNITY
========================================================= */

function Campus({ search, setSearch, filter, setFilter, notify, posts, openModal, people, clubs }) {
  const filters = ["All", "Hackathon", "Event", "Help Needed", "Achievement"];

  return (
    <section className="page-section campus-page">
      <div className="section-head large">
        <div><span className="section-kicker">COMMUNITY</span><h1>Campus Feed</h1><p>A verified social layer for your entire campus.</p></div>
        <button className="primary" onClick={() => openModal("post")}><HiPlus /> Create post</button>
      </div>

      <div className="subnav">
        <button className="active">Feed</button>
        <button onClick={() => window.dispatchEvent(new CustomEvent("campus-nav-people"))}>People</button>
        <button onClick={() => notify("Clubs hub available from the Campus menu")}>Clubs</button>
        <button onClick={() => notify("Lost & Found opened")}>Lost & Found</button>
      </div>

      <div className="feed-toolbar">
        <div className="searchbar compact"><span><HiMagnifyingGlass /></span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campus posts..." /></div>
        <div className="chips">{filters.map((f) => <button className={filter === f ? "chip active" : "chip"} onClick={() => setFilter(f)} key={f}>{f}</button>)}</div>
      </div>

      <div className="campus-command-grid">
        <CommandCard icon={<HiUserGroup />} title="Find people" text={`${people.length} suggested matches`} onClick={() => openModal("people")} />
        <CommandCard icon={<HiOutlineBuildingLibrary />} title="Clubs" text={`${clubs.length} active clubs`} onClick={() => openModal("clubs")} />
        <CommandCard icon={<HiExclamationTriangle />} title="Ask for help" text="Post a request to campus" onClick={() => openModal("post")} />
      </div>

      <div className="feed-layout">
        <div className="feed">{posts.map((p) => <Post key={p.id} post={p} notify={notify} />)}</div>

        <aside className="side-card">
          <span className="section-kicker">TRENDING</span>
          <h3>Campus topics</h3>
          {["#Hackathon2026", "#AIWorkshop", "#PlacementPrep", "#Robotics", "#LostAndFound"].map((x, i) => (
            <button key={x} onClick={() => notify(`${x} selected`)}><b>0{i + 1}</b>{x}<span><HiArrowRight /></span></button>
          ))}
          <hr />
          <span className="section-kicker">YOUR CAMPUS</span>
          <div className="mini-stat"><b>8,000+</b><span>students</span></div>
          <div className="mini-stat"><b>42</b><span>active clubs</span></div>
          <div className="mini-stat"><b>184</b><span>posts today</span></div>
        </aside>
      </div>
    </section>
  );
}

function CommandCard({ icon, title, text, onClick }) {
  return <button className="command-card" onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{text}</small></div><HiArrowRight /></button>;
}

function Post({ post, notify }) {
  return (
    <article className={`post ${post.accent}`}>
      <div className="post-head">
        <div className="avatar">{post.author[0]}</div>
        <div><b>{post.author} {post.verified && <HiShieldCheck className="verified" />}</b><small>{post.time}</small></div>
        <button onClick={() => notify("Post options opened")} aria-label="Post options"><HiEllipsisHorizontal /></button>
      </div>
      <div className="post-type"><span>{post.icon}</span>{post.type}</div>
      <h3>{post.title}</h3>
      <div className="tags">{post.tags.map((t) => <span key={t}>#{t}</span>)}</div>
      <div className="post-actions">
        <button onClick={() => notify("Liked")}><HiHeart />{post.likes}</button>
        <button onClick={() => notify("Comments opened")}><HiChatBubbleOvalLeft />{post.comments}</button>
        <button onClick={() => notify("Post shared")}><HiArrowUpTray />Share</button>
      </div>
    </article>
  );
}

/* =========================================================
   PEOPLE / CLUBS
========================================================= */

function People({ notify, people, openModal }) {
  const [q, setQ] = useState("");
  const filtered = people.filter((p) => `${p.name} ${p.skills.join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <section className="page-section">
      <PageHeader kicker="NETWORK" title="Find Your People" text="Discover students based on skills, interests and projects." action={<button className="primary" onClick={() => openModal("post")}><HiUserPlus /> Need a teammate</button>} />
      <div className="searchbar compact wide-search"><HiMagnifyingGlass /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or skills..." /></div>
      <div className="people-grid">{filtered.map((p) => <PersonCard key={p.id} person={p} notify={notify} />)}</div>
      <div className="section-divider" />
      <div className="opportunity"><div><span className="section-kicker">SKILL MATCHING</span><h2>Build your next team.</h2><p>Tell Campus OS what you need and discover students with complementary skills.</p></div><button onClick={() => notify("Skill matching questionnaire opened")}>Find my team <HiArrowRight /></button></div>
    </section>
  );
}

function PersonCard({ person, notify }) {
  return <article className="person-card"><div className="person-top"><div className="big-avatar small">{person.name[0]}</div><div><h3>{person.name}</h3><p>{person.course} · {person.year}</p></div><span className="match">{person.match}%</span></div><div className="skill-list">{person.skills.map((s) => <span key={s}>{s}</span>)}</div><div className="person-actions"><button onClick={() => notify(`Connection request sent to ${person.name}`)}><HiUserPlus /> Connect</button><button className="ghost" onClick={() => notify(`Profile opened for ${person.name}`)}>View profile</button></div></article>;
}

function Clubs({ notify, clubs, openModal }) {
  return (
    <section className="page-section">
      <PageHeader kicker="COMMUNITY" title="Clubs Hub" text="Discover student communities, projects and activities." action={<button className="primary" onClick={() => notify("Club application opened")}><HiPlus /> Start a club</button>} />
      <div className="club-grid">{clubs.map((c) => <article className={`club-card ${c.color}`} key={c.name}><span className="club-icon">{c.icon}</span><h3>{c.name}</h3><p>{c.members} members</p><div className="club-stats"><span>{c.events} events</span><span>Verified</span></div><div className="person-actions"><button onClick={() => notify(`Joined ${c.name}`)}><HiUserPlus /> Join</button><button className="ghost" onClick={() => openModal("club")}>Open</button></div></article>)}</div>
    </section>
  );
}

/* =========================================================
   EVENTS
========================================================= */

function Events({ notify, openModal, events, opportunities, mentors }) {
  return (
    <section className="page-section events-page">
      <PageHeader kicker="DISCOVER" title="Events & Opportunities" text="Everything happening across campus, in one place." action={<button className="primary" onClick={() => notify("Event creation opened — demo mode")}><HiPlus /> Create event</button>} />
      <div className="event-tabs"><button className="active">All</button><button>Events</button><button>Hackathons</button><button>Opportunities</button><button>Mentors</button></div>
      <div className="event-grid">{events.map((e) => <EventCard key={e.id} event={e} notify={notify} />)}</div>
      <div className="section-head inner-head"><div><span className="section-kicker">OPPORTUNITIES</span><h2>Internships & Projects</h2></div><button className="text-btn" onClick={() => notify("All opportunities opened")}>View all <HiArrowRight /></button></div>
      <div className="opportunity-grid">{opportunities.map((o) => <OpportunityCard key={o.role} item={o} notify={notify} />)}</div>
      <div className="section-head inner-head"><div><span className="section-kicker">MENTOR NETWORK</span><h2>Find a mentor</h2></div><button className="text-btn" onClick={() => openModal("mentor")}>Request mentorship <HiArrowRight /></button></div>
      <div className="mentor-grid">{mentors.map((m) => <MentorCard key={m.name} mentor={m} notify={notify} />)}</div>
      <div className="opportunity"><div><span className="section-kicker">TEAM MATCHING</span><h2>Looking for a hackathon team?</h2><p>Tell us your skills. Campus OS can help you discover teams looking for people like you.</p></div><button onClick={() => notify("Skill matching demo opened")}>Find my team <HiArrowRight /></button></div>
    </section>
  );
}

function EventCard({ event, notify }) {
  return <article className="event-card"><div className={`date-box ${event.color}`}><b>{event.date}</b><span>{event.month}</span></div><div className="event-content"><span className="event-club">{event.club}</span><h3>{event.title}</h3><p><HiClock />{event.time}<span>·</span><HiMapPin />{event.place}</p><small className="attendee-line"><HiUserGroup /> {event.attendees} students interested</small><div><button onClick={() => notify(`${event.title}: registration opened`)}>Register</button><button className="ghost" onClick={() => notify("Event saved")}><HiHeart /> Save</button></div></div></article>;
}

function OpportunityCard({ item, notify }) {
  return <article className="opportunity-card"><div className="company-avatar">{item.company[0]}</div><div><span className="event-club">{item.type}</span><h3>{item.role}</h3><p>{item.company}</p><div className="tags">{item.tags.map((t) => <span key={t}>{t}</span>)}</div></div><div className="deadline">Due {item.deadline}</div><button onClick={() => notify(`Applied to ${item.role}`)}>View <HiArrowRight /></button></article>;
}

function MentorCard({ mentor, notify }) {
  return <article className="mentor-card"><div className="big-avatar small">{mentor.name[0]}</div><div><h3>{mentor.name}</h3><p>{mentor.field}</p><small>{mentor.slots} slots available</small></div><button onClick={() => notify(`Mentorship request sent to ${mentor.name}`)}><HiUserPlus /> Request</button></article>;
}

function MyCalendar({ notify, events }) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return <section className="page-section"><PageHeader kicker="YOUR SCHEDULE" title="My Campus Calendar" text="Events, workshops, deadlines and activities in one view." action={<button className="primary" onClick={() => notify("Calendar synced")}><HiArrowPath /> Sync</button>} /><div className="calendar-layout"><div className="calendar-box"><div className="calendar-header"><button><HiChevronRight /></button><h3>August 2026</h3><button><HiChevronRight /></button></div><div className="weekdays">{["M","T","W","T","F","S","S"].map((d, i) => <span key={i}>{d}</span>)}</div><div className="calendar-days">{days.map((d) => <button className={d === 10 ? "today" : [12, 14, 16, 18].includes(d) ? "has-event" : ""} key={d} onClick={() => notify(`${d} August selected`)}>{d}</button>)}</div></div><div className="calendar-agenda"><span className="section-kicker">UPCOMING</span>{events.map((e) => <div className="agenda-item" key={e.id}><b>{e.date}</b><div><strong>{e.title}</strong><small>{e.time} · {e.place}</small></div><HiChevronRight /></div>)}</div></div></section>;
}

/* =========================================================
   SERVICES
========================================================= */

function Services({ notify, openModal, foodCart, storeCart, addFood, addStore, printFile, setPrintFile }) {
  return (
    <section className="page-section services-page">
      <PageHeader kicker="CAMPUS SERVICES" title="Get things done." text="Everyday services, without the queue." />
      <div className="service-grid">{services.map((s) => <button className="service-card" key={s.id} onClick={() => { if (s.id === "map") openModal("map"); else if (s.id === "print") openModal("print"); else if (s.id === "store") openModal("store"); else if (s.id === "delivery") openModal("delivery"); else if (s.id === "hostel") openModal("hostel"); else if (s.id === "lost") openModal("lost"); else openModal("service"); }}><span className="service-icon">{s.icon}</span><div><h3>{s.title}</h3><p>{s.text}</p></div><span className="service-arrow">{s.action}<HiArrowRight /></span></button>)}</div>

      <section className="service-dashboard">
        <div className="service-dash-card food-dash"><span className="section-kicker">CAMPUS FOOD</span><h2>Four canteens. One checkout.</h2><p>Compare live queue levels and order from the least busy counter.</p><div className="mini-canteens">{canteens.map((c) => <div key={c.id}><b>{c.name}</b><span className={`status-dot ${c.status.toLowerCase()}`}></span><small>{c.status} · {c.eta}</small></div>)}</div><button onClick={() => openModal("food")} className="primary">Open Food Hub <HiArrowRight /></button></div>
        <div className="service-dash-card print-dash"><span className="section-kicker">PRINT HUB</span><h2>Upload. Pay. Pick up.</h2><p>{printFile ? `Selected: ${printFile}` : "Send your report before you reach the print shop."}</p><div className="steps"><span><b>1</b>Upload</span><span><b>2</b>Configure</span><span><b>3</b>Pay</span><span><b>4</b>QR Pickup</span></div><button onClick={() => openModal("print")}>Try print demo <HiArrowRight /></button></div>
      </section>

      <div className="service-footer-grid">
        <MiniService icon={<HiShoppingCart />} title="Stationery" text={`${storeCart.length} items in cart`} onClick={() => openModal("store")} />
        <MiniService icon={<HiMap />} title="Campus Map" text="Find rooms & facilities" onClick={() => openModal("map")} />
        <MiniService icon={<HiExclamationTriangle />} title="Emergency" text="Campus SOS" onClick={() => openModal("sos")} />
        <MiniService icon={<HiTruck />} title="Delivery" text="Move items around campus" onClick={() => openModal("delivery")} />
      </div>
    </section>
  );
}

function MiniService({ icon, title, text, onClick }) {
  return <button className="mini-service" onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{text}</small></div><HiArrowRight /></button>;
}

/* =========================================================
   FOOD
========================================================= */

function Food({ notify, canteens, items, cart, addFood, openModal }) {
  const [selectedCanteen, setSelectedCanteen] = useState("All");
  const [q, setQ] = useState("");
  const filtered = items.filter((i) => (selectedCanteen === "All" || i.vendor === selectedCanteen) && i.name.toLowerCase().includes(q.toLowerCase()));
  const total = cart.reduce((sum, i) => sum + i.price, 0);

  return <section className="page-section"><PageHeader kicker="CAMPUS FOOD" title="Food Hub" text="Four canteens, one campus checkout." action={<button className="primary" onClick={() => openModal("food-cart")}><HiShoppingCart /> Cart ({cart.length})</button>} />
    <div className="canteen-status-grid">{canteens.map((c) => <button key={c.id} className={`canteen-status ${selectedCanteen === c.name ? "selected" : ""}`} onClick={() => setSelectedCanteen(selectedCanteen === c.name ? "All" : c.name)}><div><b>{c.name}</b><small>{c.eta}</small></div><span className={`load-bar ${c.status.toLowerCase()}`}><i style={{ width: `${c.load}%` }} /></span><small>{c.status}</small></button>)}</div>
    <div className="searchbar compact wide-search"><HiMagnifyingGlass /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search food..." /></div>
    <div className="product-grid">{filtered.map((item) => <ProductCard key={item.id} item={item} add={addFood} />)}</div>
    {cart.length > 0 && <div className="floating-cart"><div><HiShoppingCart /><b>{cart.length} items</b><span>₹{total}</span></div><button onClick={() => openModal("food-cart")}>Checkout <HiArrowRight /></button></div>}
  </section>;
}

function ProductCard({ item, add }) {
  return <article className="product-card"><div className="product-placeholder"><HiShoppingBag /></div><span className="event-club">{item.category}</span><h3>{item.name}</h3><p>{item.vendor}</p><div className="product-bottom"><b>₹{item.price}</b><button onClick={() => add(item)}><HiPlus /> Add</button></div></article>;
}

/* =========================================================
   STORE
========================================================= */

function Store({ notify, items, cart, addStore, openModal }) {
  const [q, setQ] = useState("");
  const filtered = items.filter((i) => `${i.name} ${i.category}`.toLowerCase().includes(q.toLowerCase()));
  const total = cart.reduce((sum, i) => sum + i.price, 0);

  return <section className="page-section"><PageHeader kicker="CAMPUS STORE" title="Stationery & Supplies" text="Everything you need for classes and projects." action={<button className="primary" onClick={() => openModal("store-cart")}><HiShoppingCart /> Cart ({cart.length})</button>} /><div className="searchbar compact wide-search"><HiMagnifyingGlass /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stationery, books, records..." /></div><div className="category-row">{["All", "Stationery", "Records", "Paper", "Electronics", "Academic"].map((c) => <button key={c} onClick={() => setQ(c === "All" ? "" : c)}>{c}</button>)}</div><div className="product-grid">{filtered.map((item) => <article className="product-card" key={item.id}><div className="product-placeholder"><HiBookOpen /></div><span className="event-club">{item.category}</span><h3>{item.name}</h3><p>{item.stock} in stock</p><div className="product-bottom"><b>₹{item.price}</b><button onClick={() => addStore(item)}><HiPlus /> Add</button></div></article>)}</div>{cart.length > 0 && <div className="floating-cart"><div><HiShoppingCart /><b>{cart.length} items</b><span>₹{total}</span></div><button onClick={() => openModal("store-cart")}>Checkout <HiArrowRight /></button></div>}<div className="store-banner"><div><span className="section-kicker">QUICK PICKUP</span><h2>Order before class. Collect between lectures.</h2><p>Get a QR pickup code when your order is ready.</p></div><HiQrCode /></div></section>;
}

/* =========================================================
   MAP
========================================================= */

function CampusMap({ notify, openModal }) {
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState("");

  const results = mapLocations.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));

  return <section className="page-section map-page"><PageHeader kicker="SMART CAMPUS" title="Campus Map" text="Find buildings, rooms, services and future autonomous routes." action={<button className="primary" onClick={() => openModal("navigation")}><HiMapPin /> Navigate</button>} /><div className="map-search-row"><div className="searchbar compact"><HiMagnifyingGlass /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Lab 302, canteen, auditorium..." /></div><div className="map-quick">{mapQuickSearch.map((x) => <button key={x} onClick={() => { setQ(x); notify(`${x} selected`); }}>{x}</button>)}</div></div><div className="map-layout"><div className="campus-map"><div className="map-roads" />{mapLocations.map((loc) => <button key={loc.id} className={`map-marker ${selected?.id === loc.id ? "selected" : ""}`} style={{ left: `${loc.x}%`, top: `${loc.y}%` }} onClick={() => setSelected(loc)}><span>{loc.type === "Food" ? <HiShoppingBag /> : loc.type === "Events" ? <HiCalendarDays /> : loc.type === "Laboratory" ? <HiCpuChip /> : <HiBuildingOffice2 />}</span><b>{loc.name}</b></button>)}<div className="you-marker"><span /><small>You are here</small></div></div><aside className="map-panel"><span className="section-kicker">LOCATIONS</span>{results.map((loc) => <button className={selected?.id === loc.id ? "selected" : ""} key={loc.id} onClick={() => setSelected(loc)}><span>{loc.name}</span><small>{loc.block || loc.type}</small><HiChevronRight /></button>)}{selected && <div className="location-detail"><span className="section-kicker">{selected.type}</span><h3>{selected.name}</h3><p>{selected.rooms} rooms / facilities</p><button onClick={() => openModal("navigation")} className="primary">Get Directions <HiArrowRight /></button></div>}</aside></div></section>;
}

/* =========================================================
   AI
========================================================= */

function CampusAI({ notify, go }) {
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState([
    { role: "ai", text: "Hi. I'm Campus AI. Ask me about people, events, rooms, services or campus operations." },
  ]);

  const suggestions = [
    "Find a Flutter developer",
    "Where is Lab 302?",
    "What's happening tomorrow?",
    "Print my project report",
    "Find a mentor for robotics",
  ];

  const answer = (text) => {
    const t = text.toLowerCase();
    if (t.includes("flutter")) return "I found 3 students with Flutter-related skills. Rahul has the strongest match at 87%.";
    if (t.includes("lab")) return "Lab 302 is in Block C, 3rd Floor. It is currently occupied.";
    if (t.includes("tomorrow")) return "Tomorrow's highlights include the Campus Hackathon preparation session and the AI Club meetup.";
    if (t.includes("print")) return "I can route you to Print Hub. Upload your PDF, select options and generate a pickup QR.";
    if (t.includes("mentor")) return "I found 2 robotics mentors with available slots. Prof. Rahul Nair is the closest match.";
    return "I can help you discover campus people, events, services, rooms and opportunities. Try one of the suggestions below.";
  };

  const ask = (value = message) => {
    if (!value.trim()) return;
    const response = answer(value);
    setConversation((c) => [...c, { role: "user", text: value }, { role: "ai", text: response }]);
    setMessage("");
  };

  return <section className="page-section ai-page"><div className="ai-header"><span className="ai-large-icon"><HiSparkles /></span><div><span className="section-kicker">CAMPUS INTELLIGENCE</span><h1>Campus AI</h1><p>Natural language access to your campus.</p></div></div><div className="ai-shell"><div className="ai-chat">{conversation.map((m, i) => <div className={`ai-message ${m.role}`} key={i}><span>{m.role === "ai" ? <HiSparkles /> : <HiUserCircle />}</span><p>{m.text}</p></div>)}<div className="ai-suggestions">{suggestions.map((s) => <button key={s} onClick={() => ask(s)}>{s}<HiArrowRight /></button>)}</div></div><div className="ai-input"><input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask Campus AI..." /><button onClick={() => ask()}><HiPaperAirplane /></button></div></div><div className="ai-capabilities"><Capability icon={<HiUserGroup />} title="People" text="Find teammates and mentors" /><Capability icon={<HiMap />} title="Places" text="Search campus locations" /><Capability icon={<HiWrenchScrewdriver />} title="Services" text="Start campus workflows" /><Capability icon={<HiCpuChip />} title="Hardware" text="Monitor connected devices" /></div><div className="opportunity"><div><span className="section-kicker">FUTURE</span><h2>AI that can act, not just answer.</h2><p>The next layer can use campus APIs to create orders, book resources and communicate with autonomous systems.</p></div><button onClick={() => go("autonomous")}>Explore Autonomous Campus <HiArrowRight /></button></div></section>;
}

function Capability({ icon, title, text }) {
  return <div className="capability"><span>{icon}</span><b>{title}</b><small>{text}</small></div>;
}

/* =========================================================
   AUTONOMOUS CAMPUS
========================================================= */

function AutonomousCampus({ notify, devices }) {
  return <section className="page-section autonomous-page"><PageHeader kicker="FUTURE INFRASTRUCTURE" title="Autonomous Campus" text="A digital control layer for robots, drones, IoT and AI systems." action={<button className="primary" onClick={() => notify("Device provisioning opened")}>+ Add device</button>} /><div className="autonomous-hero"><div><span className="section-kicker">CAMPUS DIGITAL TWIN</span><h2>People, services and machines in one system.</h2><p>Future hardware can plug into the same campus identity, location, permissions and event infrastructure.</p></div><div className="system-pulse"><span /><b>System operational</b><small>99.8% simulated uptime</small></div></div><div className="device-grid">{devices.map((d) => <DeviceCard key={d.id} device={d} notify={notify} />)}</div><div className="hardware-flow"><div><span className="section-kicker">REFERENCE ARCHITECTURE</span><h2>Hardware → Campus OS → AI → Action</h2></div><div className="flow-row"><Flow icon={<HiSignal />} title="Telemetry" /><HiArrowRight /><Flow icon={<HiCpuChip />} title="Campus OS" /><HiArrowRight /><Flow icon={<HiSparkles />} title="AI" /><HiArrowRight /><Flow icon={<HiRocketLaunch />} title="Action" /></div></div><div className="autonomous-grid"><StatCard label="IoT devices" value="48" icon={<HiSignal />} /><StatCard label="Robots" value="3" icon={<HiTruck />} /><StatCard label="Drones" value="1" icon={<HiPaperAirplane />} /><StatCard label="Automation events" value="284" icon={<HiBolt />} /></div></section>;
}

function DeviceCard({ device, notify }) {
  return <article className="device-card"><div className="device-head"><span>{device.icon}</span><div><span className="event-club">{device.type}</span><h3>{device.name}</h3></div><span className="online-dot" /></div><div className="device-data"><div><small>Status</small><b>{device.status}</b></div><div><small>Battery</small><b>{device.battery}%</b></div><div><small>Location</small><b>{device.location}</b></div></div><div className="battery-bar"><i style={{ width: `${device.battery}%` }} /></div><button onClick={() => notify(`${device.name} control panel opened`)}>Open control panel <HiArrowRight /></button></article>;
}

function Flow({ icon, title }) {
  return <div className="flow-item"><span>{icon}</span><b>{title}</b></div>;
}

function StatCard({ label, value, icon }) {
  return <div className="stat-card"><span>{icon}</span><small>{label}</small><b>{value}</b></div>;
}

/* =========================================================
   PROFILE
========================================================= */

function Profile({ user, onLogin, notify, openModal }) {
  return <section className="page-section profile-page">{user ? <><div className="profile-hero"><div className="big-avatar">{user.name[0]}</div><div><span className="section-kicker">VERIFIED STUDENT</span><h1>{user.name}</h1><p>{user.course} · {user.year}</p><div className="profile-tags"><span>React</span><span>Python</span><span>AI/ML</span></div></div><button className="ghost top-right" onClick={() => notify("Edit profile opened")}>Edit profile</button></div><div className="passport"><div><span className="section-kicker">CAMPUS PASSPORT</span><h2>Your contribution matters.</h2><p>Build a verified campus identity through projects, events, clubs and helpful contributions.</p></div><div className="reputation"><small>Campus Reputation</small><b>842</b><span><HiFire /> +24 this month</span></div></div><div className="profile-grid"><div className="profile-box"><span className="section-kicker">YOUR CAMPUS</span><h3>Activity</h3><div className="stats"><b>12<span>Posts</span></b><b>5<span>Events</span></b><b>3<span>Teams</span></b><b>17<span>Helpful</span></b></div></div><div className="profile-box"><span className="section-kicker">ACHIEVEMENTS</span><h3>Campus Passport</h3><p><HiTrophy /> Hackathon finalist</p><p><HiUserGroup /> Club coordinator</p><p><HiCpuChip /> AI project showcase</p><p><HiStar /> Community contributor</p></div></div></> : <div className="empty-profile"><div className="profile-logo">C</div><span className="section-kicker">YOUR CAMPUS ID</span><h1>Build your campus identity.</h1><p>Sign in to access your profile, skills, clubs, achievements and personalized campus activity.</p><button className="primary" onClick={onLogin}>Sign in with college email</button></div>}</section>;
}

/* =========================================================
   NOTIFICATIONS
========================================================= */

function NotificationsPage({ notifications, markRead, notify }) {
  return <section className="page-section"><PageHeader kicker="UPDATES" title="Notifications" text="Important campus updates, service alerts and community activity." action={<button className="ghost" onClick={() => { markRead(); notify("All notifications marked as read"); }}>Mark all read</button>} /><div className="notification-list">{notifications.map((n) => <article className={`notification-card ${n.unread ? "unread" : ""}`} key={n.id}><span>{n.type === "event" ? <HiCalendarDays /> : n.type === "service" ? <HiWrenchScrewdriver /> : n.type === "official" ? <HiMegaphone /> : <HiChatBubbleOvalLeft />}</span><div><b>{n.title}</b><small>{n.time}</small></div>{n.unread && <i />}</article>)}</div></section>;
}

/* =========================================================
   MODALS
========================================================= */

function ModalShell({ title, kicker, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="feature-modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={onClose}><HiXMark /></button>{kicker && <span className="section-kicker">{kicker}</span>}<h2>{title}</h2>{children}</div></div>;
}

function PostComposer({ onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("General");
  const [tag, setTag] = useState("");

  return <ModalShell kicker="CAMPUS COMMUNITY" title="Create a post" onClose={onClose}><label>Post type<select value={type} onChange={(e) => setType(e.target.value)}><option>General</option><option>Hackathon</option><option>Event</option><option>Help Needed</option><option>Achievement</option></select></label><label>What do you want to say?<textarea value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Share something with your campus..." /></label><label>Tag<input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. robotics" /></label><button className="primary wide" disabled={!title.trim()} onClick={() => onCreate({ type, title, author: "Sanjay Padmaraj", accent: "violet", tags: tag ? [tag] : [] })}>Publish <HiArrowUpTray /></button></ModalShell>;
}

function LoginModal({ onClose, onLogin }) {
  const [name, setName] = useState("Sanjay Padmaraj");
  const [email, setEmail] = useState("sanjaypadmaraj@nhce.edu.in");
  const [usn, setUsn] = useState("1NH25CS123");

  return <ModalShell kicker="COLLEGE ACCOUNT" title="Welcome to Campus OS" onClose={onClose}><p>Use your college identity to join the verified campus network.</p><label>Full name<input value={name} onChange={(e) => setName(e.target.value)} /></label><label>College email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>USN<input value={usn} onChange={(e) => setUsn(e.target.value)} /></label><button className="primary wide" onClick={() => onLogin({ name: name || "Campus Student", email, usn, course: "Computer Science & Engineering", year: "2nd Year" })}>Continue with college account <HiArrowRight /></button><small className="login-note">Demo mode · authentication will be connected to Supabase later.</small></ModalShell>;
}

function SOSModal({ onClose, notify }) {
  return <ModalShell kicker="EMERGENCY" title="Campus SOS" onClose={onClose}><div className="sos-card"><span><HiShieldCheck /></span><b>Hold for emergency</b><small>Campus security will receive your location in the production system.</small><button onClick={() => { notify("SOS simulation activated"); onClose(); }}><HiPhone /> Hold to activate SOS</button></div><div className="emergency-actions"><button onClick={() => notify("Campus security call simulated")}><HiPhone /> Security</button><button onClick={() => notify("Medical response requested")}><HiExclamationTriangle /> Medical</button><button onClick={() => notify("Campus help requested")}><HiUserGroup /> Campus help</button></div></ModalShell>;
}

function PrintModal({ onClose, setPrintFile, notify }) {
  const [file, setFile] = useState("");
  const [pages, setPages] = useState(12);
  const [color, setColor] = useState("B&W");
  return <ModalShell kicker="PRINT HUB" title="Upload & print" onClose={onClose}><label>Document<input type="file" onChange={(e) => { const f = e.target.files?.[0]; setFile(f?.name || ""); setPrintFile(f?.name || ""); }} /></label>{file && <div className="file-chip"><HiDocumentArrowUp />{file}<HiCheck /></div>}<div className="form-grid"><label>Pages<input type="number" min="1" value={pages} onChange={(e) => setPages(e.target.value)} /></label><label>Print mode<select value={color} onChange={(e) => setColor(e.target.value)}><option>B&W</option><option>Colour</option></select></label></div><div className="price-preview"><span>Estimated total</span><b>₹{Number(pages) * (color === "Colour" ? 5 : 2)}</b></div><button className="primary wide" onClick={() => { notify("Print order created — demo"); onClose(); }}>Place print order <HiCreditCard /></button></ModalShell>;
}

function CartModal({ title, cart, onClose, notify, type }) {
  const total = cart.reduce((sum, i) => sum + i.price, 0);
  return <ModalShell kicker={type === "food" ? "FOOD HUB" : "CAMPUS STORE"} title={title} onClose={onClose}>{cart.length === 0 ? <div className="empty-state"><HiShoppingCart /><h3>Your cart is empty</h3><p>Add something to continue.</p></div> : <><div className="cart-list">{cart.map((item, i) => <div key={`${item.id}-${i}`}><span>{item.name}</span><small>{item.vendor || item.category}</small><b>₹{item.price}</b></div>)}</div><div className="price-preview"><span>Total</span><b>₹{total}</b></div><button className="primary wide" onClick={() => { notify("Checkout opened — payment integration comes later"); onClose(); }}>Continue to payment <HiCreditCard /></button></>}</ModalShell>;
}

function MapModal({ onClose }) {
  return <ModalShell kicker="SMART CAMPUS" title="Campus navigation" onClose={onClose}><CampusMap notify={() => {}} openModal={() => {}} /></ModalShell>;
}

function NavigationModal({ onClose, notify }) {
  return <ModalShell kicker="NAVIGATION" title="Route to destination" onClose={onClose}><div className="route-preview"><div className="route-node"><span>YOU</span><b>Current location</b></div><div className="route-line"><i /></div><div className="route-node"><span>DESTINATION</span><b>Lab 302 · Block C</b></div></div><div className="route-stats"><span><HiMapPin /> 240 m</span><span><HiClock /> 3 min</span><span><HiBolt /> Low traffic</span></div><button className="primary wide" onClick={() => { notify("Navigation started"); onClose(); }}>Start navigation <HiArrowRight /></button></ModalShell>;
}

function ServiceModal({ onClose, notify }) {
  const [details, setDetails] = useState("");
  return <ModalShell kicker="CAMPUS SUPPORT" title="Report an issue" onClose={onClose}><div className="issue-categories">{["Wi-Fi", "Electrical", "AC", "Furniture", "Equipment"].map((x) => <button key={x} onClick={() => notify(`${x} selected`)}>{x}</button>)}</div><label>Describe the issue<textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Tell campus support what happened..." /></label><button className="primary wide" onClick={() => { notify("Maintenance request submitted"); onClose(); }}>Submit request <HiArrowUpTray /></button></ModalShell>;
}

function DeliveryModal({ onClose, notify }) {
  const [method, setMethod] = useState("Campus runner");
  return <ModalShell kicker="CAMPUS DELIVERY" title="Move something across campus" onClose={onClose}><div className="delivery-form"><label>Pickup<input placeholder="Print Shop" /></label><label>Destination<input placeholder="Block C" /></label><label>Delivery method<select value={method} onChange={(e) => setMethod(e.target.value)}><option>Campus runner</option><option>Autonomous robot · Coming soon</option><option>Autonomous drone · Coming soon</option></select></label></div><div className="route-stats"><span><HiMapPin /> 350 m</span><span><HiClock /> 6–10 min</span></div><button className="primary wide" onClick={() => { notify(`${method} delivery request created`); onClose(); }}>Request delivery <HiTruck /></button></ModalShell>;
}

function HostelModal({ onClose, notify }) {
  return <ModalShell kicker="HOSTEL" title="Hostel services" onClose={onClose}><div className="hostel-grid"><MiniService icon={<HiHomeModern />} title="Room" text="B-204 · Occupied" onClick={() => notify("Room details opened")} /><MiniService icon={<HiShoppingBag />} title="Mess" text="Today's menu" onClick={() => notify("Mess menu opened")} /><MiniService icon={<HiWrenchScrewdriver />} title="Maintenance" text="2 open requests" onClick={() => notify("Maintenance opened")} /><MiniService icon={<HiArrowPath />} title="Laundry" text="Available" onClick={() => notify("Laundry booking opened")} /></div></ModalShell>;
}

function LostModal({ onClose, notify }) {
  return <ModalShell kicker="LOST & FOUND" title="Campus Lost & Found" onClose={onClose}><div className="lost-item"><span><HiShoppingBag /></span><div><b>Black backpack</b><small>Found near Block B · 18 min ago</small></div><button onClick={() => notify("Claim request submitted")}>Claim</button></div><div className="lost-item"><span><HiCreditCard /></span><div><b>Student ID card</b><small>Found near Main Gate · 1 hr ago</small></div><button onClick={() => notify("Contact request submitted")}>Contact</button></div><button className="primary wide" onClick={() => notify("Lost item report opened")}><HiPlus /> Report lost item</button></ModalShell>;
}

function NotificationPanel({ notifications, onClose, markRead }) {
  return <ModalShell kicker="UPDATES" title="Notifications" onClose={onClose}><div className="notification-list compact-list">{notifications.map((n) => <div className={`notification-card ${n.unread ? "unread" : ""}`} key={n.id}><span><HiBell /></span><div><b>{n.title}</b><small>{n.time}</small></div></div>)}</div><button className="ghost wide" onClick={markRead}>Mark all read</button></ModalShell>;
}

/* =========================================================
   HELPERS
========================================================= */

function PageHeader({ kicker, title, text, action }) {
  return <div className="section-head large"><div><span className="section-kicker">{kicker}</span><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

/* =========================================================
   RENDER
========================================================= */

ReactDOM.createRoot(document.getElementById("root")).render(<App />);