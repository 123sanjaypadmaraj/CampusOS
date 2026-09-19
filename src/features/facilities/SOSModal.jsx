import React, { useEffect, useRef, useState } from "react";
import { cancelMySosAlert, getBestEffortLocation, triggerSosAlert } from "../../services/mvpService";
import { HiExclamationTriangle, HiPhone, HiShieldCheck, HiUserGroup } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";

const SOS_HOLD_MS = 1500;

function SOSModal({ onClose, notify, authUser, openLogin }) {
  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // { id, alertType, respondersNotified }
  const [cancelling, setCancelling] = useState(false);
  const holdTimer = useRef(null);

  const send = async (alertType) => {
    if (!authUser) {
      openLogin?.();
      notify("Sign in to send an SOS alert");
      return;
    }
    setHolding(false);
    setSending(true);
    try {
      // Best-effort: never let a denied/slow location permission block or
      // delay dispatch -- getBestEffortLocation() always resolves (null on
      // denial/timeout), it never rejects.
      const location = await getBestEffortLocation();
      const result = await triggerSosAlert({ alertType, location });
      setSent({ id: result.id, alertType, respondersNotified: result.responders_notified });
      notify(
        result.responders_notified > 0
          ? `Alert sent — ${result.responders_notified} responder${result.responders_notified === 1 ? "" : "s"} notified`
          : "Alert sent — no facilities staff are on record for your campus yet, but it's logged"
      );
    } catch (err) {
      notify(err.message || "Could not send the alert -- if this is a real emergency, call campus security directly");
    } finally {
      setSending(false);
    }
  };

  const startHold = () => {
    if (sending || sent) return;
    setHolding(true);
    holdTimer.current = setTimeout(() => send("general"), SOS_HOLD_MS);
  };
  const cancelHold = () => {
    clearTimeout(holdTimer.current);
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const cancelAlert = async () => {
    if (!sent) return;
    try {
      setCancelling(true);
      await cancelMySosAlert(sent.id);
      notify("Alert cancelled");
      setSent(null);
    } catch (err) {
      notify(err.message || "Could not cancel -- a responder may already be on it");
    } finally {
      setCancelling(false);
    }
  };

  if (sent) {
    return (
      <ModalShell kicker="EMERGENCY" title="Campus SOS" onClose={onClose}>
        <div className="sos-card sos-card-sent">
          <span><HiShieldCheck /></span>
          <b>Alert sent</b>
          <small>
            {sent.respondersNotified > 0
              ? `${sent.respondersNotified} campus responder${sent.respondersNotified === 1 ? "" : "s"} notified. Stay where you are if it's safe to.`
              : "Logged, but no facilities staff are on record for your campus yet."}
          </small>
          <button className="ghost" disabled={cancelling} onClick={cancelAlert}>
            {cancelling ? "Cancelling…" : "This was a false alarm — cancel"}
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell kicker="EMERGENCY" title="Campus SOS" onClose={onClose}>
      <div className="sos-card">
        <span><HiShieldCheck /></span>
        <b>Hold for emergency</b>
        <small>
          Real campus responders are notified with your location (if you allow it) the moment this reaches the hold threshold.
        </small>
        <button
          className={holding ? "sos-hold-btn holding" : "sos-hold-btn"}
          style={holding ? { "--sos-hold-ms": `${SOS_HOLD_MS}ms` } : undefined}
          disabled={sending}
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
        >
          <span className="sos-hold-fill" />
          <span className="sos-hold-label"><HiPhone /> {sending ? "Sending…" : "Hold to activate SOS"}</span>
        </button>
      </div>

      <div className="emergency-actions">
        <button disabled={sending} onClick={() => send("security")}>
          <HiPhone /> Security
        </button>
        <button disabled={sending} onClick={() => send("medical")}>
          <HiExclamationTriangle /> Medical
        </button>
        <button disabled={sending} onClick={() => send("help")}>
          <HiUserGroup /> Campus help
        </button>
      </div>
    </ModalShell>
  );
}

export { SOSModal, SOS_HOLD_MS };
