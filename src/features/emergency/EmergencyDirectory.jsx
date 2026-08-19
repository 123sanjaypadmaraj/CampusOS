import React, { useEffect, useState } from "react";
import {
  HiPhone, HiEnvelope, HiMapPin, HiShieldCheck, HiTruck, HiHomeModern,
  HiBuildingOffice2, HiHeart, HiExclamationTriangle, HiUserGroup,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import { listEmergencyDirectory } from "./api";

const CATEGORY_META = {
  emergency_response: { label: "Emergency Response", icon: <HiExclamationTriangle /> },
  security: { label: "Security", icon: <HiShieldCheck /> },
  medical: { label: "Medical", icon: <HiHeart /> },
  facilities: { label: "Facilities", icon: <HiBuildingOffice2 /> },
  hostel: { label: "Hostel", icon: <HiHomeModern /> },
  transport: { label: "Transport", icon: <HiTruck /> },
  admin: { label: "Administration", icon: <HiUserGroup /> },
  campus_management: { label: "Campus Management", icon: <HiUserGroup /> },
};

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Client-side "open now" -- weekly_hours is {"mon": ["09:00","17:00"], ...},
// a missing/null day means closed that day; only consulted when !is_24x7
// (see the migration's own column comment).
function isOpenNow(entry) {
  if (entry.is_24x7) return true;
  const hours = entry.weekly_hours?.[DAY_KEYS[new Date().getDay()]];
  if (!Array.isArray(hours) || hours.length !== 2) return null; // unknown, not "closed"
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = hours[0].split(":").map(Number);
  const [closeH, closeM] = hours[1].split(":").map(Number);
  return minutesNow >= openH * 60 + openM && minutesNow <= closeH * 60 + closeM;
}

export default function EmergencyDirectory() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    listEmergencyDirectory()
      .then(setEntries)
      .catch((err) => setError(err.message || "Could not load the emergency directory"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <LoadingState label="Loading campus emergency contacts…" />;
  if (error) return <ErrorState text={error} onRetry={load} />;
  if (entries.length === 0) {
    return <EmptyState icon={<HiPhone />} title="No verified contacts yet" text="Your campus hasn't published its emergency directory yet." />;
  }

  const byCategory = entries.reduce((acc, e) => {
    (acc[e.category] ||= []).push(e);
    return acc;
  }, {});

  return (
    <div className="emergency-directory">
      {Object.entries(byCategory).map(([category, rows]) => (
        <div key={category} className="emergency-directory-group">
          <span className="section-kicker">
            {CATEGORY_META[category]?.icon} {CATEGORY_META[category]?.label || category}
          </span>
          <div className="resource-list">
            {rows.map((entry) => {
              const open = isOpenNow(entry);
              return (
                <article className={`resource-row emergency-directory-row priority-${entry.priority}`} key={entry.id}>
                  <div className="resource-icon">{CATEGORY_META[category]?.icon || <HiPhone />}</div>
                  <div>
                    <b>{entry.name}</b>
                    {entry.designation && <small>{entry.designation}</small>}
                    {entry.description && <small>{entry.description}</small>}
                    <small>
                      {entry.is_24x7 ? "Open 24/7" : open === null ? (entry.hours_note || "Hours not listed") : open ? "Open now" : "Closed now"}
                      {entry.location && <> · <HiMapPin style={{ verticalAlign: "-2px" }} /> {entry.location}</>}
                    </small>
                  </div>
                  <div className="emergency-directory-actions">
                    <a className="ghost" href={`tel:${entry.phone}`}><HiPhone /> {entry.phone}</a>
                    {entry.alt_phone && <a className="ghost" href={`tel:${entry.alt_phone}`}><HiPhone /> Alt</a>}
                    {entry.email && <a className="ghost" href={`mailto:${entry.email}`}><HiEnvelope /></a>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
