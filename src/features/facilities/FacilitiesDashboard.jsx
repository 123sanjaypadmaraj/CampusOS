import React, { useEffect, useState } from "react";
import { HiCheck, HiXCircle, HiClock, HiWrenchScrewdriver, HiCalendarDays } from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as facilitiesApi from "./api";

export default function FacilitiesDashboard({ notify, campusId }) {
  const [tab, setTab] = useState("tickets");

  return (
    <section className="page-section admin-cms">
      <div className="section-head">
        <div>
          <span className="section-kicker">FACILITIES DASHBOARD</span>
          <h1>Tickets &amp; Bookings</h1>
          <p>Triage service tickets and approve resource bookings for your campus.</p>
        </div>
      </div>

      <div className="socialize-filter-row">
        <button className={tab === "tickets" ? "chip active" : "chip"} onClick={() => setTab("tickets")}>Tickets</button>
        <button className={tab === "bookings" ? "chip active" : "chip"} onClick={() => setTab("bookings")}>Booking Approvals</button>
      </div>

      {tab === "tickets" && <TicketQueue notify={notify} campusId={campusId} />}
      {tab === "bookings" && <BookingApprovals notify={notify} />}
    </section>
  );
}

const TICKET_NEXT_STEP = {
  SUBMITTED: { label: "Triage", to: "TRIAGED" },
  TRIAGED: { label: "Assign", to: "ASSIGNED" },
  ASSIGNED: { label: "Start work", to: "IN_PROGRESS" },
  IN_PROGRESS: { label: "Mark resolved", to: "RESOLVED" },
  WAITING: { label: "Resume", to: "IN_PROGRESS" },
  RESOLVED: { label: "Close ticket", to: "CLOSED" },
};

function TicketQueue({ notify, campusId }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setError("");
      setTickets(await facilitiesApi.listActiveTickets(campusId));
    } catch (err) {
      setError(err.message || "Could not load tickets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (ticket, toStatus) => {
    try {
      setBusyId(ticket.id);
      await facilitiesApi.transitionTicketStatus(ticket.id, toStatus);
      notify(`${ticket.title} → ${toStatus}`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this ticket");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading tickets…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      {tickets.length === 0 && (
        <EmptyState icon={<HiWrenchScrewdriver />} title="No open tickets" text="New facilities/service tickets will show up here." />
      )}
      {tickets.map((ticket) => {
        const next = TICKET_NEXT_STEP[ticket.status];
        return (
          <article className="resource-row" key={ticket.id} style={{ alignItems: "flex-start" }}>
            <div>
              <b>
                {ticket.title} · {ticket.status}{" "}
                <span className="social-type" style={{ marginLeft: 6 }}>{ticket.priority}</span>
              </b>
              <small>
                {ticket.profiles?.name || "Student"} · {ticket.category}
                {ticket.location ? ` · ${ticket.location}` : ""}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {next && (
                <button className="primary" disabled={busyId === ticket.id} onClick={() => act(ticket, next.to)}>
                  <HiCheck /> {next.label}
                </button>
              )}
              {["IN_PROGRESS", "WAITING"].includes(ticket.status) && next?.to !== "WAITING" && (
                <button disabled={busyId === ticket.id} onClick={() => act(ticket, ticket.status === "IN_PROGRESS" ? "WAITING" : "RESOLVED")}>
                  <HiClock /> {ticket.status === "IN_PROGRESS" ? "Put on hold" : "Mark resolved"}
                </button>
              )}
              {["SUBMITTED", "TRIAGED"].includes(ticket.status) && (
                <button disabled={busyId === ticket.id} onClick={() => act(ticket, "CLOSED")}>
                  <HiXCircle /> Close
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function BookingApprovals({ notify }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setError("");
      setBookings(await facilitiesApi.listPendingBookings());
    } catch (err) {
      setError(err.message || "Could not load bookings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (booking, status) => {
    try {
      setBusyId(booking.id);
      await facilitiesApi.setBookingStatus(booking.id, status);
      notify(status === "APPROVED" ? "Booking approved" : "Booking rejected");
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this booking");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading bookings…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      {bookings.length === 0 && (
        <EmptyState icon={<HiCalendarDays />} title="No bookings awaiting approval" />
      )}
      {bookings.map((booking) => (
        <article className="resource-row" key={booking.id}>
          <div>
            <b>{booking.resources?.name || "Resource"}</b>
            <small>
              {booking.profiles?.name || "Student"} ·{" "}
              {new Date(booking.start_time).toLocaleString()} – {new Date(booking.end_time).toLocaleTimeString()}
            </small>
            {booking.notes && <small>Note: {booking.notes}</small>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" disabled={busyId === booking.id} onClick={() => act(booking, "APPROVED")}>Approve</button>
            <button disabled={busyId === booking.id} onClick={() => act(booking, "REJECTED")}>Reject</button>
          </div>
        </article>
      ))}
    </div>
  );
}
