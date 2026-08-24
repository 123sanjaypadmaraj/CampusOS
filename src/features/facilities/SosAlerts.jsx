import React, { useEffect, useState } from "react";
import { HiExclamationTriangle, HiPhone, HiUserGroup, HiShieldCheck, HiMapPin, HiCheck, HiIdentification } from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as facilitiesApi from "./api";

const ALERT_LABEL = {
  general: "General emergency",
  security: "Security needed",
  medical: "Medical emergency",
  help: "Campus help requested",
};

const ALERT_ICON = {
  security: <HiPhone />,
  medical: <HiExclamationTriangle />,
  help: <HiUserGroup />,
  general: <HiShieldCheck />,
};

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

// Live queue for facilities staff/admins (sos.respond permission) --
// realtime-subscribed so a new alert shows up without a manual refresh,
// which matters far more here than anywhere else in the app. See
// supabase/migrations/20260815000300_sos_alerts.sql.
export default function SosAlertsPanel({ notify }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  // Emergency-contacts lookup is per-alert and lazy -- only fetched once a
  // responder actually asks, via a call scoped to this exact alert
  // (get_emergency_contacts_for_alert), not a standing directory read.
  const [contactsOpenId, setContactsOpenId] = useState(null);
  const [contactsByAlert, setContactsByAlert] = useState({});

  const reload = async () => {
    try {
      setError("");
      setAlerts(await facilitiesApi.listActiveSosAlerts());
    } catch (err) {
      setError(err.message || "Could not load SOS alerts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    const unsub = facilitiesApi.subscribeToSosAlerts(() => reload());
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const acknowledge = async (alert) => {
    try {
      setBusyId(alert.id);
      await facilitiesApi.acknowledgeSosAlert(alert.id);
      notify(`Acknowledged — you're on it`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not acknowledge this alert");
    } finally {
      setBusyId(null);
    }
  };

  const resolve = async (alert) => {
    try {
      setBusyId(alert.id);
      await facilitiesApi.resolveSosAlert(alert.id, resolutionNotes.trim() || null);
      notify("Alert resolved");
      setResolvingId(null);
      setResolutionNotes("");
      await reload();
    } catch (err) {
      notify(err.message || "Could not resolve this alert");
    } finally {
      setBusyId(null);
    }
  };

  const toggleContacts = async (alert) => {
    if (contactsOpenId === alert.id) {
      setContactsOpenId(null);
      return;
    }
    setContactsOpenId(alert.id);
    if (contactsByAlert[alert.id]) return; // already fetched this open
    setContactsByAlert((prev) => ({ ...prev, [alert.id]: { loading: true } }));
    try {
      const data = await facilitiesApi.getEmergencyContactsForAlert(alert.id);
      setContactsByAlert((prev) => ({ ...prev, [alert.id]: { loading: false, data } }));
    } catch (err) {
      setContactsByAlert((prev) => ({ ...prev, [alert.id]: { loading: false, error: err.message || "Could not load emergency contacts" } }));
    }
  };

  if (loading) return <LoadingState label="Loading SOS alerts…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      {alerts.length === 0 && (
        <EmptyState icon={<HiShieldCheck />} title="No active SOS alerts" text="New emergency alerts will appear here immediately." />
      )}
      {alerts.map((alert) => (
        <article
          className="resource-row sos-alert-row"
          key={alert.id}
          style={{ alignItems: "flex-start", borderColor: alert.status === "active" ? "#e35f68" : undefined }}
        >
          <div className="resource-icon" style={{ color: "#e35f68" }}>{ALERT_ICON[alert.alert_type] || <HiShieldCheck />}</div>
          <div>
            <b>
              {ALERT_LABEL[alert.alert_type] || "SOS alert"}
              {alert.status === "acknowledged" && <span className="social-type" style={{ marginLeft: 6 }}>ACKNOWLEDGED</span>}
            </b>
            <small>
              {alert.contact_name || "A student"}
              {alert.contact_phone ? ` · ${alert.contact_phone}` : ""} · {timeAgo(alert.created_at)}
            </small>
            {alert.latitude != null && (
              <small>
                <a
                  href={`https://www.google.com/maps?q=${alert.latitude},${alert.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <HiMapPin /> View location
                  {alert.location_accuracy_m ? ` (±${Math.round(alert.location_accuracy_m)}m)` : ""}
                </a>
              </small>
            )}
            {alert.latitude == null && <small style={{ color: "var(--muted)" }}>No location shared</small>}

            {contactsOpenId === alert.id && (
              <div style={{ marginTop: 8 }}>
                {contactsByAlert[alert.id]?.loading && <small>Loading emergency contacts…</small>}
                {contactsByAlert[alert.id]?.error && (
                  <small style={{ color: "#e35f68" }}>{contactsByAlert[alert.id].error}</small>
                )}
                {contactsByAlert[alert.id]?.data && contactsByAlert[alert.id].data.length === 0 && (
                  <small style={{ color: "var(--muted)" }}>This student hasn&rsquo;t added any emergency contacts yet.</small>
                )}
                {contactsByAlert[alert.id]?.data?.map((contact) => (
                  <div key={contact.id} style={{ marginTop: 4 }}>
                    <small>
                      <b>{contact.contact_name}</b> ({contact.relationship}){contact.is_primary ? " · Primary" : ""}
                      {contact.verified ? (
                        <span title="Verified"> <HiShieldCheck /></span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}> · unverified</span>
                      )}
                      {" · "}
                      <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                      {contact.alt_phone && <> · alt <a href={`tel:${contact.alt_phone}`}>{contact.alt_phone}</a></>}
                    </small>
                  </div>
                ))}
              </div>
            )}

            {resolvingId === alert.id && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  rows={2}
                  placeholder="Resolution notes (optional)"
                  aria-label="Resolution notes"
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {alert.status === "active" && (
              <button className="primary" disabled={busyId === alert.id} onClick={() => acknowledge(alert)}>
                <HiCheck /> Acknowledge
              </button>
            )}
            <button onClick={() => toggleContacts(alert)}>
              <HiIdentification /> {contactsOpenId === alert.id ? "Hide" : "View"} emergency contacts
            </button>
            {resolvingId === alert.id ? (
              <button className="primary" disabled={busyId === alert.id} onClick={() => resolve(alert)}>
                {busyId === alert.id ? "Resolving…" : "Confirm resolved"}
              </button>
            ) : (
              <button disabled={busyId === alert.id} onClick={() => { setResolvingId(alert.id); setResolutionNotes(""); }}>
                Mark resolved
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
