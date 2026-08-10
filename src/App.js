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
} from "react-icons/hi2";

/* =========================================================
   NAVIGATION
========================================================= */

const navItems = [
  ["home", <HiHome />, "Home"],
  ["campus", <HiSparkles />, "Campus"],
  ["events", <HiCalendarDays />, "Events"],
  ["services", <HiWrenchScrewdriver />, "Services"],
  ["profile", <HiUserCircle />, "Profile"],
];

/* =========================================================
   CAMPUS POSTS
========================================================= */

const posts = [
  {
    type: "Hackathon",
    icon: <HiBolt />,
    title: "Need 2 Flutter developers for Smart India Hackathon",
    author: "Tech Innovators Club",
    time: "12 min ago",
    likes: 42,
    comments: 8,
    accent: "violet",
    tags: ["Flutter", "ML", "Team"],
  },
  {
    type: "Event",
    icon: <HiCalendarDays />,
    title: "Generative AI Workshop — registrations are open",
    author: "AI Club",
    time: "1 hr ago",
    likes: 76,
    comments: 14,
    accent: "blue",
    tags: ["Workshop", "AI"],
  },
  {
    type: "Help Needed",
    icon: <HiUserGroup />,
    title: "Does anyone have a Type-C charger near Block C?",
    author: "Ananya • CSE 2",
    time: "2 hrs ago",
    likes: 18,
    comments: 6,
    accent: "orange",
    tags: ["Help", "Block C"],
  },
  {
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
  },
];

/* =========================================================
   EVENTS
========================================================= */

const events = [
  {
    date: "12",
    month: "AUG",
    title: "Generative AI Workshop",
    club: "AI Club",
    time: "2:00 PM",
    place: "Seminar Hall 2",
    color: "purple",
  },
  {
    date: "14",
    month: "AUG",
    title: "Campus Hackathon 2026",
    club: "Coding Club",
    time: "9:00 AM",
    place: "Innovation Lab",
    color: "blue",
  },
  {
    date: "16",
    month: "AUG",
    title: "Robotics Project Showcase",
    club: "Robotics Club",
    time: "4:30 PM",
    place: "Main Auditorium",
    color: "green",
  },
];

/* =========================================================
   CAMPUS SERVICES
========================================================= */

const services = [
  [
    <HiPrinter />,
    "Print & Documents",
    "Upload, print, bind and collect with QR pickup",
    "Open",
  ],
  [
    <HiBookOpen />,
    "Campus Store",
    "Stationery, records, books and academic supplies",
    "Browse",
  ],
  [
    <HiMap />,
    "Smart Campus Map",
    "Find rooms, labs, offices and facilities",
    "Explore",
  ],
  [
    <HiWrenchScrewdriver />,
    "Report an Issue",
    "Wi-Fi, electrical, AC, furniture and equipment",
    "Report",
  ],
  [
    <HiBuildingOffice2 />,
    "Resource Booking",
    "Book halls, labs, equipment and sports facilities",
    "Book",
  ],
  [
    <HiMagnifyingGlassCircle />,
    "Lost & Found",
    "Report or find lost items around campus",
    "Open",
  ],
  [
    <HiShoppingCart />,
    "Campus Marketplace",
    "Buy and sell permitted items within campus",
    "Browse",
  ],
  [
    <HiTicket />,
    "Digital Campus Pass",
    "QR entry for events, workshops and pickups",
    "View",
  ],
];

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

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("campus-theme") === "dark";
  });

  /* -------------------------------------------------------
     THEME
  ------------------------------------------------------- */

  const toggleTheme = () => {
    setDarkMode((current) => {
      const next = !current;

      localStorage.setItem(
        "campus-theme",
        next ? "dark" : "light"
      );

      return next;
    });
  };

  /* -------------------------------------------------------
     TOAST
  ------------------------------------------------------- */

  const notify = (msg) => {
    setToast(msg);

    setTimeout(() => {
      setToast("");
    }, 2200);
  };

  /* -------------------------------------------------------
     FILTER POSTS
  ------------------------------------------------------- */

  const filteredPosts = useMemo(() => {
    const q = search.toLowerCase();

    return posts.filter(
      (p) =>
        (postFilter === "All" || p.type === postFilter) &&
        (!q ||
          `${p.title} ${p.author} ${p.tags.join(" ")}`
            .toLowerCase()
            .includes(q))
    );
  }, [search, postFilter]);

  /* -------------------------------------------------------
     NAVIGATION
  ------------------------------------------------------- */

  const go = (key) => {
    setActive(key);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <div
      className={`app-shell ${
        darkMode ? "dark-mode" : "light-mode"
      }`}
    >
      {/* ===================================================
          TOP BAR
      =================================================== */}

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
          {/* Notifications */}

          <button
            className="icon-btn"
            onClick={() =>
              notify("No new notifications")
            }
            aria-label="Notifications"
          >
            <HiBell />

            <i>3</i>
          </button>

          {/* Theme Toggle */}

          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={
              darkMode
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
          >
            <span className="theme-track">
              <span className="theme-thumb">
                {darkMode ? <HiMoon /> : <HiSun />}
              </span>
            </span>
          </button>

          {/* User */}

          {user ? (
            <button
              className="profile-mini"
              onClick={() => go("profile")}
            >
              <span>{user.name[0]}</span>

              {user.name}
            </button>
          ) : (
            <button
              className="login-btn"
              onClick={() => setLoginOpen(true)}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {/* ===================================================
          MAIN
      =================================================== */}

      <main>
        {active === "home" && (
          <Home
            go={go}
            search={search}
            setSearch={setSearch}
            notify={notify}
          />
        )}

        {active === "campus" && (
          <Campus
            search={search}
            setSearch={setSearch}
            filter={postFilter}
            setFilter={setPostFilter}
            notify={notify}
            posts={filteredPosts}
          />
        )}

        {active === "events" && (
          <Events notify={notify} />
        )}

        {active === "services" && (
          <Services notify={notify} />
        )}

        {active === "profile" && (
          <Profile
            user={user}
            onLogin={() => setLoginOpen(true)}
            notify={notify}
          />
        )}
      </main>

      {/* ===================================================
          BOTTOM NAV
      =================================================== */}

      <nav className="bottom-nav">
        {navItems.map(([key, icon, label]) => (
          <button
            key={key}
            className={
              active === key ? "active" : ""
            }
            onClick={() => go(key)}
          >
            <span>{icon}</span>

            <small>{label}</small>
          </button>
        ))}
      </nav>

      {/* LOGIN */}

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLogin={(u) => {
            setUser(u);
            setLoginOpen(false);

            notify(
              `Welcome, ${u.name.split(" ")[0]}!`
            );
          }}
        />
      )}

      {/* TOAST */}

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
}) {
  return (
    <>
      {/* HERO */}

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
              Connect with students, discover
              opportunities, access campus services
              and get things done — all from one place.
            </p>

            {/* SEARCH */}

            <div className="searchbar">
              <span>
                <HiMagnifyingGlass />
              </span>

              <input
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
                placeholder="Search events, clubs, services, people..."
              />

              <kbd>⌘ K</kbd>
            </div>

            {/* HERO LINKS */}

            <div className="hero-links">
              <button
                onClick={() => go("campus")}
              >
                Explore Campus

                <b>
                  <HiArrowRight />
                </b>
              </button>

              <button
                onClick={() => go("events")}
              >
                See what's happening

                <b>
                  <HiArrowRight />
                </b>
              </button>
            </div>
          </div>

          {/* HERO ORBIT */}

          <div className="hero-orbit">
            <div className="orbit-card card-a">
              <HiRocketLaunch />

              <b>Hackathon</b>

              <small>
                3 teams need members
              </small>
            </div>

            <div className="orbit-card card-b">
              <HiCalendarDays />

              <b>AI Workshop</b>

              <small>
                Today · 2:00 PM
              </small>
            </div>

            <div className="orbit-card card-c">
              <HiUserGroup />

              <b>Help needed</b>

              <small>
                Block C · 2 replies
              </small>
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

      {/* ===================================================
          CAMPUS PULSE
      =================================================== */}

      <section className="page-section pulse-section">
        <div className="section-head">
          <div>
            <span className="section-kicker">
              LIVE NOW
            </span>

            <h2>Campus Pulse</h2>

            <p>
              What students are talking about right now.
            </p>
          </div>

          <button
            className="text-btn"
            onClick={() => go("campus")}
          >
            View all

            <HiArrowRight />
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
            label="ACHIEVEMENT"
            title="Robotics team wins regional challenge"
            meta="42 students congratulated"
            onClick={() => go("campus")}
          />
        </div>
      </section>

      {/* ===================================================
          FEATURES
      =================================================== */}

      <section className="page-section feature-strip">
        <div>
          <span className="section-kicker">
            ONE PLATFORM
          </span>

          <h2>
            Built around real student needs.
          </h2>
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
            text="Print, store, map, booking & support"
            onClick={() => go("services")}
          />

          <Feature
            icon={<HiCpuChip />}
            title="Campus AI"
            text="Ask questions. Find people. Take action."
            onClick={() =>
              notify(
                "Campus AI demo coming next"
              )
            }
          />
        </div>
      </section>

      {/* ===================================================
          AI BANNER
      =================================================== */}

      <section className="page-section ai-banner">
        <div>
          <span className="ai-icon">
            <HiSparkles />
          </span>

          <div>
            <span className="section-kicker">
              CAMPUS AI
            </span>

            <h2>
              Your campus, searchable in natural language.
            </h2>

            <p>
              "Find me a Flutter developer for my
              hackathon." · "Where is Lab 204?" ·
              "What is happening tomorrow?"
            </p>
          </div>
        </div>

        <button
          onClick={() =>
            notify(
              "AI assistant opened — demo mode"
            )
          }
        >
          Ask Campus AI

          <b>
            <HiArrowRight />
          </b>
        </button>
      </section>
    </>
  );
}

/* =========================================================
   PULSE CARD
========================================================= */

function PulseCard({
  icon,
  label,
  title,
  meta,
  onClick,
}) {
  return (
    <button
      className="pulse-card"
      onClick={onClick}
    >
      <span className="pulse-icon">
        {icon}
      </span>

      <span className="pulse-label">
        {label}
      </span>

      <strong>{title}</strong>

      <small>{meta}</small>

      <span className="arrow">
        <HiArrowRight />
      </span>
    </button>
  );
}

/* =========================================================
   FEATURE
========================================================= */

function Feature({
  icon,
  title,
  text,
  onClick,
}) {
  return (
    <button
      className="feature"
      onClick={onClick}
    >
      <span>{icon}</span>

      <b>{title}</b>

      <small>{text}</small>
    </button>
  );
}

/* =========================================================
   CAMPUS
========================================================= */

function Campus({
  search,
  setSearch,
  filter,
  setFilter,
  notify,
  posts,
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
          <span className="section-kicker">
            COMMUNITY
          </span>

          <h1>Campus Feed</h1>

          <p>
            A verified space for your entire campus.
          </p>
        </div>

        <button
          className="primary"
          onClick={() =>
            notify(
              "Post composer opened — demo mode"
            )
          }
        >
          <span>+</span>

          Create post
        </button>
      </div>

      <div className="feed-toolbar">
        <div className="searchbar compact">
          <span>
            <HiMagnifyingGlass />
          </span>

          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Search campus posts..."
          />
        </div>

        <div className="chips">
          {filters.map((f) => (
            <button
              className={
                filter === f
                  ? "chip active"
                  : "chip"
              }
              onClick={() => setFilter(f)}
              key={f}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="feed-layout">
        <div className="feed">
          {posts.map((p, i) => (
            <Post
              key={i}
              post={p}
              notify={notify}
            />
          ))}
        </div>

        <aside className="side-card">
          <span className="section-kicker">
            TRENDING
          </span>

          <h3>Campus topics</h3>

          {[
            "#Hackathon2026",
            "#AIWorkshop",
            "#PlacementPrep",
            "#Robotics",
            "#LostAndFound",
          ].map((x, i) => (
            <button
              key={x}
              onClick={() =>
                notify(`${x} selected`)
              }
            >
              <b>
                0{i + 1}
              </b>

              {x}

              <span>
                <HiArrowRight />
              </span>
            </button>
          ))}

          <hr />

          <span className="section-kicker">
            YOUR CAMPUS
          </span>

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

/* =========================================================
   POST
========================================================= */

function Post({
  post,
  notify,
}) {
  return (
    <article
      className={`post ${post.accent}`}
    >
      <div className="post-head">
        <div className="avatar">
          {post.author[0]}
        </div>

        <div>
          <b>{post.author}</b>

          <small>{post.time}</small>
        </div>

        <button
          onClick={() =>
            notify("Post options opened")
          }
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
        {post.tags.map((t) => (
          <span key={t}>
            #{t}
          </span>
        ))}
      </div>

      <div className="post-actions">
        <button
          onClick={() => notify("Liked")}
        >
          <HiHeart />

          {post.likes}
        </button>

        <button
          onClick={() =>
            notify("Comments opened")
          }
        >
          <HiChatBubbleOvalLeft />

          {post.comments}
        </button>

        <button
          onClick={() =>
            notify("Post shared")
          }
        >
          <HiArrowUpTray />

          Share
        </button>
      </div>
    </article>
  );
}

/* =========================================================
   EVENTS
========================================================= */

function Events({ notify }) {
  return (
    <section className="page-section events-page">
      <div className="section-head large">
        <div>
          <span className="section-kicker">
            DISCOVER
          </span>

          <h1>
            Events & Opportunities
          </h1>

          <p>
            Everything happening across campus,
            in one calendar.
          </p>
        </div>

        <button
          className="primary"
          onClick={() =>
            notify(
              "Event creation opened — demo mode"
            )
          }
        >
          <span>+</span>

          Create event
        </button>
      </div>

      <div className="event-grid">
        {events.map((e, i) => (
          <article
            className="event-card"
            key={i}
          >
            <div
              className={`date-box ${e.color}`}
            >
              <b>{e.date}</b>

              <span>{e.month}</span>
            </div>

            <div className="event-content">
              <span className="event-club">
                {e.club}
              </span>

              <h3>{e.title}</h3>

              <p>
                <HiClock />

                {e.time}

                <span>·</span>

                <HiMapPin />

                {e.place}
              </p>

              <div>
                <button
                  onClick={() =>
                    notify(
                      `${e.title}: registration opened`
                    )
                  }
                >
                  Register
                </button>

                <button
                  className="ghost"
                  onClick={() =>
                    notify("Event saved")
                  }
                >
                  <HiHeart />

                  Save
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="opportunity">
        <div>
          <span className="section-kicker">
            TEAM MATCHING
          </span>

          <h2>
            Looking for a hackathon team?
          </h2>

          <p>
            Tell us your skills. Campus OS can
            help you discover teams looking for
            people like you.
          </p>
        </div>

        <button
          onClick={() =>
            notify(
              "Skill matching demo opened"
            )
          }
        >
          Find my team

          <HiArrowRight />
        </button>
      </div>
    </section>
  );
}

/* =========================================================
   SERVICES
========================================================= */

function Services({ notify }) {
  return (
    <section className="page-section services-page">
      <div className="section-head large">
        <div>
          <span className="section-kicker">
            CAMPUS SERVICES
          </span>

          <h1>Get things done.</h1>

          <p>
            Everyday services, without the queue.
          </p>
        </div>
      </div>

      <div className="service-grid">
        {services.map(
          ([icon, title, text, action]) => (
            <button
              className="service-card"
              key={title}
              onClick={() =>
                notify(
                  `${title} opened — demo mode`
                )
              }
            >
              <span className="service-icon">
                {icon}
              </span>

              <div>
                <h3>{title}</h3>

                <p>{text}</p>
              </div>

              <span className="service-arrow">
                {action}

                <HiArrowRight />
              </span>
            </button>
          )
        )}
      </div>

      <div className="service-demo">
        <div>
          <span className="section-kicker">
            PRINT & DOCUMENTS
          </span>

          <h2>
            Upload. Pay. Pick up.
          </h2>

          <p>
            Send your project report before you
            even reach the print shop.
          </p>

          <div className="steps">
            <span>
              <b>1</b>

              Upload
            </span>

            <span>
              <b>2</b>

              Configure
            </span>

            <span>
              <b>3</b>

              Pay
            </span>

            <span>
              <b>4</b>

              QR Pickup
            </span>
          </div>
        </div>

        <button
          onClick={() =>
            notify(
              "Print order demo opened"
            )
          }
        >
          Try print demo

          <HiArrowRight />
        </button>
      </div>
    </section>
  );
}

/* =========================================================
   PROFILE
========================================================= */

function Profile({
  user,
  onLogin,
  notify,
}) {
  return (
    <section className="page-section profile-page">
      {user ? (
        <>
          <div className="profile-hero">
            <div className="big-avatar">
              {user.name[0]}
            </div>

            <div>
              <span className="section-kicker">
                VERIFIED STUDENT
              </span>

              <h1>{user.name}</h1>

              <p>
                {user.course} · {user.year}
              </p>

              <div className="profile-tags">
                <span>React</span>

                <span>Python</span>

                <span>AI/ML</span>
              </div>
            </div>

            <button
              className="ghost top-right"
              onClick={() =>
                notify(
                  "Edit profile opened"
                )
              }
            >
              Edit profile
            </button>
          </div>

          <div className="profile-grid">
            <div className="profile-box">
              <span className="section-kicker">
                YOUR CAMPUS
              </span>

              <h3>Activity</h3>

              <div className="stats">
                <b>
                  12
                  <span>Posts</span>
                </b>

                <b>
                  5
                  <span>Events</span>
                </b>

                <b>
                  3
                  <span>Teams</span>
                </b>

                <b>
                  17
                  <span>Helpful</span>
                </b>
              </div>
            </div>

            <div className="profile-box">
              <span className="section-kicker">
                ACHIEVEMENTS
              </span>

              <h3>
                Campus Passport
              </h3>

              <p>
                <HiTrophy />

                Hackathon finalist
              </p>

              <p>
                <HiUserGroup />

                Club coordinator
              </p>

              <p>
                <HiCpuChip />

                AI project showcase
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="empty-profile">
          <div className="profile-logo">
            C
          </div>

          <span className="section-kicker">
            YOUR CAMPUS ID
          </span>

          <h1>
            Build your campus identity.
          </h1>

          <p>
            Sign in to access your profile,
            skills, clubs, achievements and
            personalized campus activity.
          </p>

          <button
            className="primary"
            onClick={onLogin}
          >
            Sign in with college email
          </button>
        </div>
      )}
    </section>
  );
}

/* =========================================================
   LOGIN MODAL
========================================================= */

function LoginModal({
  onClose,
  onLogin,
}) {
  const [name, setName] =
    useState("Sanjay Padmaraj");

  const [email, setEmail] =
    useState("sanjaypadmaraj@nhce.edu.in");

  const [usn, setusn] =
    useState("1NH25CS123");

  return (
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
    >
      <div
        className="login-modal"
        onMouseDown={(e) =>
          e.stopPropagation()
        }
      >
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <HiXMark />
        </button>

        <div className="profile-logo">
          C
        </div>

        <span className="section-kicker">
          COLLEGE ACCOUNT
        </span>

        <h2>
          Welcome to Campus OS
        </h2>

        <p>
          Use your college email to join
          the verified campus network.
        </p>

        <label>
          Full name

          <input
            value={name}
            onChange={(e) =>
              setName(e.target.value)
            }
          />
        </label>

        <label>
          College email

          <input
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
          />
        </label>
        <label>
          USN

          <input
            value={usn}
            onChange={(e) =>
              setusn(e.target.value)
            }
          />
        </label>

        <button
          className="primary wide"
          onClick={() =>
            onLogin({
              name:
                name || "Campus Student",
              email,
              course:
                "Computer Science & Engineering",
              year: "2nd Year",
            })
          }
        >
          Continue with college account

          <HiArrowRight />
        </button>

        <small className="login-note">
          Demo mode · no real authentication
          is connected yet.
        </small>
      </div>
    </div>
  );
}

/* =========================================================
   RENDER
========================================================= */

ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <App />
);