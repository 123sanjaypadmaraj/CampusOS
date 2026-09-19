import React, { useEffect, useState } from "react";
import { FEATURES } from "../../config/features";
import { dismissRecommendation, getAllRecommendations } from "../../services/recommendationsService";
import { deleteReminder, listMyReminders, setReminderDone, subscribeToReminders } from "../../services/remindersService";
import { HiArrowRight, HiBolt, HiBookOpen, HiBuildingOffice2, HiCalendarDays, HiCheck, HiExclamationTriangle, HiMagnifyingGlass, HiMegaphone, HiPrinter, HiRocketLaunch, HiShoppingCart, HiSparkles, HiTrophy, HiUserGroup, HiUserPlus, HiWrenchScrewdriver, HiXMark } from "react-icons/hi2";
import { ActionTile, Feature, PulseCard } from "../../components/ui/Shell";

function Home({
  go,
  search,
  setSearch,
  notify,
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
                aria-label="Search events, clubs, services, people"
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
          {FEATURES.food && (
            <PulseCard
              icon={<HiTrophy />}
              label="FOOD"
              title="Udupi has the shortest queue"
              meta="8–12 min · Food Hub"
              onClick={() => go("food")}
            />
          )}
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
          {FEATURES.food && (
            <ActionTile
              icon={<HiShoppingCart />}
              title="Food"
              text={`${foodCart.length} items in cart`}
              onClick={() => go("food")}
            />
          )}
          <ActionTile
            icon={<HiBookOpen />}
            title="Store"
            text={`${storeCart.length} items in cart`}
            onClick={() => go("store")}
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
    </>
  );
}

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
        {FEATURES.food && foodItems.length > 0 && (
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
      <button className="recommend-dismiss" title="Not interested" aria-label="Not interested" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>
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

export { Home, RecommendCard, RecommendedForYou, RemindersWidget };
