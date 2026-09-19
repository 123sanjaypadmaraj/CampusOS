import React, { useEffect, useState } from "react";
import { FEATURES } from "../../config/features";
import {
  HiAcademicCap, HiArrowRight, HiBookOpen, HiBuildingOffice2, HiCalendarDays, HiChevronRight, HiClock,
  HiHeart, HiLifebuoy, HiMagnifyingGlass, HiMagnifyingGlassCircle, HiMapPin, HiPhone, HiPrinter,
  HiShieldExclamation, HiShoppingBag, HiShoppingCart, HiSparkles, HiSquares2X2, HiTicket, HiUserGroup,
  HiUserPlus, HiWrenchScrewdriver,
} from "react-icons/hi2";
import { RecommendedForYou, RemindersWidget } from "./Home";

// Blinkit-style rotating search hint: tells a new user what the search bar
// can actually find without a separate onboarding screen.
const SEARCH_HINTS = ["events", "clubs", "print shop", "lost & found", "people", "study rooms"];

const ESSENTIALS = [
  { key: "print", label: "Print", icon: <HiPrinter />, tone: "purple" },
  { key: "store", label: "Store", icon: <HiBookOpen />, tone: "blue" },
  { key: "booking", label: "Book", icon: <HiBuildingOffice2 />, tone: "teal" },
  { key: "issues", label: "Report", icon: <HiWrenchScrewdriver />, tone: "orange" },
  { key: "lost", label: "Lost & Found", icon: <HiMagnifyingGlassCircle />, tone: "pink" },
  { key: "market", label: "Market", icon: <HiShoppingCart />, tone: "green" },
  { key: "academics", label: "Academics", icon: <HiAcademicCap />, tone: "amber" },
  FEATURES.food
    ? { key: "food", label: "Food", icon: <HiShoppingBag />, tone: "red" }
    : { key: "services", label: "More", icon: <HiSquares2X2 />, tone: "slate" },
];

const EXPLORE = [
  { key: "events", label: "Events", icon: <HiTicket />, tone: "purple" },
  { key: "clubs", label: "Clubs", icon: <HiUserGroup />, tone: "blue" },
  { key: "people", label: "Find People", icon: <HiUserPlus />, tone: "teal" },
  { key: "socialize", label: "Connect", icon: <HiHeart />, tone: "pink" },
  { key: "calendar", label: "Calendar", icon: <HiCalendarDays />, tone: "orange" },
  { key: "ai", label: "Campus AI", icon: <HiSparkles />, tone: "green" },
  { key: "emergencydirectory", label: "Emergency", icon: <HiPhone />, tone: "red" },
  { key: "support", label: "Help", icon: <HiLifebuoy />, tone: "amber" },
];

const CARD_TONES = ["purple", "blue", "teal", "orange", "pink"];

const greeting = (date = new Date()) => {
  const hour = date.getHours();
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

function TileGrid({ tiles, go, label }) {
  return (
    <div className="mh-grid" role="group" aria-label={label}>
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          className={`mh-tile tone-${tile.tone}`}
          onClick={() => go(tile.key)}
        >
          <span className="mh-tile-icon">{tile.icon}</span>
          <span className="mh-tile-label">{tile.label}</span>
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ title, action, onAction }) {
  return (
    <div className="mh-section-title">
      <h2>{title}</h2>
      {action && (
        <button type="button" onClick={onAction}>
          {action} <HiChevronRight />
        </button>
      )}
    </div>
  );
}

function MobileHome({ go, authUser, profile, events = [], openSearch, openSos, notify }) {
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setHintIndex((i) => (i + 1) % SEARCH_HINTS.length), 2600);
    return () => clearInterval(id);
  }, []);

  const firstName = (profile?.name || authUser?.user_metadata?.name || "").trim().split(" ")[0];
  const upcoming = events.slice(0, 6);

  return (
    <div className="mh">
      <section className="mh-header">
        <p className="mh-greeting">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </p>
        <h1>What do you need on campus today?</h1>

        <button type="button" className="mh-search" onClick={openSearch} aria-label="Search events, clubs, services, people">
          <HiMagnifyingGlass />
          <span>
            Search <b key={hintIndex}>&ldquo;{SEARCH_HINTS[hintIndex]}&rdquo;</b>
          </span>
        </button>
      </section>

      <button type="button" className="mh-sos" onClick={openSos}>
        <span className="mh-sos-icon">
          <HiShieldExclamation />
        </span>
        <span className="mh-sos-copy">
          <b>Need help right now?</b>
          <small>Alert campus security instantly</small>
        </span>
        <span className="mh-sos-cta">SOS</span>
      </button>

      <section className="mh-section" aria-label="Campus essentials">
        <SectionTitle title="Campus essentials" />
        <TileGrid tiles={ESSENTIALS} go={go} label="Campus essentials" />
      </section>

      {upcoming.length > 0 && (
        <section className="mh-section" aria-label="Happening on campus">
          <SectionTitle title="Happening on campus" action="See all" onAction={() => go("events")} />
          <div className="mh-rail">
            {upcoming.map((event, index) => (
              <button
                key={event.id ?? index}
                type="button"
                className={`mh-event tone-${CARD_TONES[index % CARD_TONES.length]}`}
                onClick={() => go("events")}
              >
                <span className="mh-event-date">
                  <b>{event.date}</b>
                  <small>{event.month}</small>
                </span>
                <span className="mh-event-club">{event.club}</span>
                <strong>{event.title}</strong>
                <span className="mh-event-meta">
                  {event.time && (
                    <span><HiClock /> {event.time}</span>
                  )}
                  {event.place && (
                    <span><HiMapPin /> {event.place}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="mh-section" aria-label="Explore campus">
        <SectionTitle title="Explore campus" />
        <TileGrid tiles={EXPLORE} go={go} label="Explore campus" />
      </section>

      {authUser && <RemindersWidget authUser={authUser} notify={notify} />}
      {authUser && <RecommendedForYou authUser={authUser} go={go} notify={notify} />}

      <button type="button" className="mh-ai" onClick={() => go("ai")}>
        <span className="mh-ai-icon">
          <HiSparkles />
        </span>
        <span>
          <b>Ask Campus AI</b>
          <small>&ldquo;Where is Lab 204?&rdquo; &middot; &ldquo;What&rsquo;s on tomorrow?&rdquo;</small>
        </span>
        <HiArrowRight />
      </button>
    </div>
  );
}

export { ESSENTIALS, EXPLORE, MobileHome, greeting };
