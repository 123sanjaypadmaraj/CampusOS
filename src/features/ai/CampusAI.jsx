import React, { useState } from "react";
import { FEATURES } from "../../config/features";
import { askCampusAssistant, logAiAction, submitAiFeedback } from "../../services/aiAssistantService";
import { createCampusServiceRequest, createResourceBooking, isValidPhone, registerEvent } from "../../services/mvpService";
import { createReminder } from "../../services/remindersService";
import { applyToTeam } from "../teams/api";
import { HiArrowRight, HiCheckCircle, HiExclamationTriangle, HiFlag, HiHandThumbDown, HiHandThumbUp, HiMap, HiPaperAirplane, HiSparkles, HiUserCircle, HiUserGroup, HiWrenchScrewdriver } from "react-icons/hi2";

const AI_ACTION_EXECUTORS = {
  add_to_food_cart: async (action, ctx) => {
    if (!FEATURES.food) throw new Error("Food ordering is temporarily unavailable.");
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
    // A paid event reserves the seat but needs Checkout, which only opens
    // from the Events tab's own UI (payForEvent) -- the AI action layer
    // never gets to trigger a payment popup itself (doc §16's "no elevated
    // privilege" rule extends to gateway checkout, not just writes).
    if (result?.status === "payment_pending") {
      if (!FEATURES.paidEvents) {
        return `Reserved your spot for "${action.eventTitle}", but paid registration is temporarily paused -- your seat will expire on its own; try again later from the Events tab.`;
      }
      return `Reserved your spot for "${action.eventTitle}" (₹${result.amount}) — open the Events tab to complete payment within 30 minutes, or the seat goes to the next person.`;
    }
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
      text: FEATURES.food
        ? "Hi! I'm a real assistant with live access to CampusOS — ask me about the food menu, upcoming events, open opportunities, mentors, teams looking for teammates, the store, or your own orders and registrations. I can also draft real actions for you (add food to your cart, register for an event, submit a service request, book a resource, set a reminder, apply to join a team) -- you'll always get a chance to confirm before anything actually happens."
        : "Hi! I'm a real assistant with live access to CampusOS — ask me about upcoming events, open opportunities, mentors, teams looking for teammates, the store, or your own orders and registrations. I can also draft real actions for you (register for an event, submit a service request, book a resource, set a reminder, apply to join a team) -- you'll always get a chance to confirm before anything actually happens.",
    },
  ]);
  const [phoneDrafts, setPhoneDrafts] = useState({}); // messageIndex -> phone string, for register_event cards

  const suggestions = [
    ...(FEATURES.food ? ["What's on the food menu right now?"] : []),
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
            aria-label="Ask Campus AI"
            disabled={asking}
          />
          <button disabled={asking || !message.trim()} onClick={() => ask()} aria-label="Ask Campus AI">
            <HiPaperAirplane />
          </button>
        </div>
      </div>

      <div className="ai-capabilities">
        <Capability icon={<HiUserGroup />} title="People" text="Find teammates and mentors" />
        <Capability icon={<HiMap />} title="Places" text="Search campus locations" />
        <Capability icon={<HiWrenchScrewdriver />} title="Services" text="Start campus workflows" />
      </div>

      <div className="opportunity">
        <div>
          <span className="section-kicker">NOW LIVE</span>
          <h2>AI that can act, not just answer.</h2>
          <p>
            {FEATURES.food
              ? "Ask it to add food to your cart, register you for an event, file a service request, book a resource, or set a reminder -- it drafts the action and always waits for your Confirm before anything real happens."
              : "Ask it to register you for an event, file a service request, book a resource, or set a reminder -- it drafts the action and always waits for your Confirm before anything real happens."}
          </p>
        </div>
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

export { AI_ACTION_EXECUTORS, ActionCard, CampusAI, Capability };
