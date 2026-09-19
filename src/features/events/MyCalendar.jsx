import { HiArrowPath, HiChevronRight } from "react-icons/hi2";
import { PageHeader } from "../../components/ui/Shell";

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
            <button onClick={() => notify("Calendar synced")} aria-label="Sync calendar">
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

export { MyCalendar };
