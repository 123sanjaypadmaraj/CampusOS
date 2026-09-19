import React, { useState } from "react";
import { EmptyState, LoadingState } from "../../components/ui/States";
import { FEATURES } from "../../config/features";
import { cancelEventRegistration, isValidPhone, logClientError, registerEvent, reportContent, startEventRegistrationPayment, startEventRegistrationRefund, toggleSavedEvent } from "../../services/mvpService";
import { applyToOpportunity, requestMentor } from "../../services/opportunitiesService";
import { openRazorpayCheckout } from "../payments/razorpay";
import { HiArrowRight, HiBriefcase, HiChatBubbleLeftRight, HiClock, HiFlag, HiHeart, HiMapPin, HiPlus, HiQrCode, HiUserGroup } from "react-icons/hi2";
import { ModalShell, PageHeader } from "../../components/ui/Shell";
import { EventTicketModal } from "./EventTicketModal";

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
  go,
  registeredIds = [],
  pendingPaymentEvents = [],
  savedIds = [],
  onRegistrationChange,
  onPendingPaymentChange,
  onSavedChange,
  onProfileUpdated,
}) {
  const [confirmingEvent, setConfirmingEvent] = useState(null);
  const [applyingTo, setApplyingTo] = useState(null);
  const [requestingMentor, setRequestingMentor] = useState(null);
  const [ticketFor, setTicketFor] = useState(null);
  const [payingEventId, setPayingEventId] = useState(null);
  const pendingPaymentIds = pendingPaymentEvents.map((p) => p.eventId);

  // Shared by both the "Register" confirm dialog (a fresh registration) and
  // the "Complete payment" button (resuming one already reserved) --
  // register_for_event() returns the same { status: 'payment_pending' }
  // shape either way (paid_events.sql), so this is the one place that opens
  // Checkout for an event registration.
  const payForEvent = async (event, registrationId, amount) => {
    try {
      setPayingEventId(event.id);
      const payment = await startEventRegistrationPayment(registrationId);
      await openRazorpayCheckout({
        keyId: payment.key_id,
        gatewayOrderId: payment.gateway_order_id,
        amount: payment.amount,
        currency: payment.currency,
        name: "CampusOS",
        description: event.title,
        prefillEmail: authUser?.email,
        prefillName: profile?.name,
        onDismiss: () => notify("Payment cancelled — you can finish paying any time from this tab before your seat expires"),
      });
      onPendingPaymentChange?.((rows) => rows.some((r) => r.eventId === event.id) ? rows : [...rows, { eventId: event.id, amount }]);
    } catch (paymentError) {
      console.error("Event payment start failed:", paymentError);
      logClientError(paymentError.message || "Event payment start failed", {
        stack: paymentError.stack,
        severity: "error",
        context: { flow: "event_registration_payment", eventId: event.id, registrationId },
      });
      notify(paymentError.message || "Payment could not be started. Try again from this tab.");
    } finally {
      setPayingEventId(null);
    }
  };

  return (
    <section className="page-section events-page">
      <PageHeader
        kicker="DISCOVER"
        title="Events & Opportunities"
        text="Everything happening across campus, in one calendar."
        action={
          <button
            className="primary"
            onClick={() => {
              if (!authUser) { openLogin(); notify("Sign in to create an event"); return; }
              notify("Events are created from a club's dashboard, or by campus admins -- head to the Clubs Hub and manage your club to add one.");
              go?.("clubs");
            }}
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
            {event.coverImageUrl && (
              <img src={event.coverImageUrl} alt="" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 10, marginBottom: 10 }} />
            )}
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
                {event.price > 0 && <><span>·</span> ₹{event.price}</>}
              </p>

              <div>
                {/* A paid event needs a live registration_id to charge, so
                    both "register fresh into a priced event" and "resume a
                    reserved-but-unpaid seat" go through Checkout -- neither
                    can proceed while paid registration is paused. Cancelling
                    an existing registration (paid or free) is unaffected. */}
                <button
                  disabled={payingEventId === event.id || (!FEATURES.paidEvents && (pendingPaymentIds.includes(event.id) || (!registeredIds.includes(event.id) && event.price > 0)))}
                  onClick={async () => {

                    try {

                      if (!authUser) {
                        openLogin();

                        notify(
                          "Sign in to register"
                        );

                        return;
                      }

                      if (!FEATURES.paidEvents && (pendingPaymentIds.includes(event.id) || (!registeredIds.includes(event.id) && event.price > 0))) {
                        notify("Paid event registration is temporarily paused — free events are still open.");
                        return;
                      }

                      if (pendingPaymentIds.includes(event.id)) {
                        // Resume a reserved-but-unpaid seat -- contact
                        // details are already on file server-side, so this
                        // skips straight to Checkout instead of reopening
                        // the confirm dialog.
                        const pending = pendingPaymentEvents.find((p) => p.eventId === event.id);
                        const result = await registerEvent({
                          eventId: event.id,
                          userId: authUser.id,
                          contactPhone: profile?.phone || "",
                          contactName: profile?.name || "",
                          rollNumber: profile?.roll_number,
                          department: profile?.department,
                        });
                        await payForEvent(event, result.registration_id, result.amount ?? pending?.amount);
                        return;
                      }

                      if (registeredIds.includes(event.id)) {
                        const result = await cancelEventRegistration({ eventId: event.id });
                        onRegistrationChange?.((ids) => ids.filter((id) => id !== event.id));
                        onPendingPaymentChange?.((rows) => rows.filter((r) => r.eventId !== event.id));
                        if (result?.refund_id) {
                          try {
                            await startEventRegistrationRefund(result.refund_id);
                            notify(`${event.title}: registration cancelled — refund processed`);
                          } catch (refundError) {
                            console.error("Event refund:", refundError);
                            notify(`${event.title}: registration cancelled — refund is processing, check My Activity shortly`);
                          }
                        } else {
                          notify(`${event.title}: registration cancelled`);
                        }
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
                  {!FEATURES.paidEvents && pendingPaymentIds.includes(event.id)
                    ? "Payments paused"
                    : pendingPaymentIds.includes(event.id)
                    ? (payingEventId === event.id ? "Opening payment…" : `Complete payment${event.price > 0 ? ` · ₹${event.price}` : ""}`)
                    : registeredIds.includes(event.id)
                    ? "Cancel registration"
                    : (!FEATURES.paidEvents && event.price > 0)
                    ? "Registration paused"
                    : (event.price > 0 ? `Register · ₹${event.price}` : "Register")}
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

                {registeredIds.includes(event.id) && (
                  <button className="ghost" onClick={() => setTicketFor(event)}>
                    <HiQrCode /> Ticket
                  </button>
                )}

                <button
                  className="ghost"
                  title="Report this event"
                  onClick={async () => {
                    if (!authUser) { openLogin(); notify("Sign in to report an event"); return; }
                    const reason = window.prompt(`Why are you reporting "${event.title}"?`);
                    if (!reason || !reason.trim()) return;
                    try {
                      await reportContent("event", event.id, reason.trim());
                      notify("Reported -- a moderator will review it.");
                    } catch (error) { notify(error.message || "Could not submit report"); }
                  }}
                >
                  <HiFlag />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {ticketFor && (
        <EventTicketModal event={ticketFor} userId={authUser?.id} notify={notify} onClose={() => setTicketFor(null)} />
      )}

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
            <button
              onClick={() => {
                if (!authUser) { openLogin(); notify("Sign in to request mentorship"); return; }
                setRequestingMentor(mentor);
              }}
              aria-label={`Request mentorship from ${mentor.name}`}
            >
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
            const justConfirmed = confirmingEvent;
            if (result?.status === "waitlisted") {
              notify(`${confirmingEvent.title}: event is full — you're #${result.position} on the waitlist`);
              setConfirmingEvent(null);
            } else if (result?.status === "payment_pending") {
              onRegistrationChange?.((ids) => [...ids, confirmingEvent.id]);
              onPendingPaymentChange?.((rows) => [...rows, { eventId: confirmingEvent.id, amount: result.amount }]);
              notify(`${confirmingEvent.title}: spot reserved — opening payment…`);
              setConfirmingEvent(null);
              payForEvent(justConfirmed, result.registration_id, result.amount);
            } else {
              onRegistrationChange?.((ids) => [...ids, confirmingEvent.id]);
              notify(`${confirmingEvent.title}: registration confirmed`);
              setTicketFor(confirmingEvent);
              setConfirmingEvent(null);
            }
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
        {event.price > 0
          ? `Review your details, then pay ₹${event.price} to confirm your spot.`
          : "Review your details before we confirm your spot."}
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
        {submitting ? "Confirming…" : event.price > 0 ? `Continue to payment · ₹${event.price}` : "Confirm registration"}
      </button>
    </ModalShell>
  );
}

export { EventRegistrationConfirmModal, Events, MentorRequestModal, OpportunityApplyModal };
