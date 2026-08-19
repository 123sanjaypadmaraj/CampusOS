import React, { useEffect, useRef, useState } from "react";
import { HiCheck, HiXCircle, HiClock, HiWrenchScrewdriver, HiCalendarDays, HiQrCode, HiCamera, HiShieldCheck, HiXMark, HiPhone } from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import { verifyCampusPass } from "../../services/campusPassService";
import * as facilitiesApi from "./api";
import SosAlertsPanel from "./SosAlerts";
import { EmergencyContactsTab, EmergencyDirectoryTab, ResourcesTab } from "../admin/AdminCMS";

export default function FacilitiesDashboard({ notify, campusId }) {
  const [tab, setTab] = useState("sos");

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
        <button className={tab === "sos" ? "chip active" : "chip"} onClick={() => setTab("sos")}><HiShieldCheck /> SOS Alerts</button>
        <button className={tab === "tickets" ? "chip active" : "chip"} onClick={() => setTab("tickets")}>Tickets</button>
        <button className={tab === "bookings" ? "chip active" : "chip"} onClick={() => setTab("bookings")}>Booking Approvals</button>
        <button className={tab === "resources" ? "chip active" : "chip"} onClick={() => setTab("resources")}>Resources</button>
        <button className={tab === "pass" ? "chip active" : "chip"} onClick={() => setTab("pass")}><HiQrCode /> Verify Pass</button>
        <button className={tab === "emergencycontacts" ? "chip active" : "chip"} onClick={() => setTab("emergencycontacts")}><HiPhone /> Emergency Contacts</button>
        <button className={tab === "emergencydirectory" ? "chip active" : "chip"} onClick={() => setTab("emergencydirectory")}><HiPhone /> Emergency Directory</button>
      </div>

      {tab === "sos" && <SosAlertsPanel notify={notify} />}
      {tab === "tickets" && <TicketQueue notify={notify} campusId={campusId} />}
      {tab === "bookings" && <BookingApprovals notify={notify} />}
      {tab === "resources" && <ResourcesTab notify={notify} campusId={campusId} />}
      {tab === "pass" && <VerifyPassPanel notify={notify} />}
      {tab === "emergencycontacts" && <EmergencyContactsTab notify={notify} />}
      {tab === "emergencydirectory" && <EmergencyDirectoryTab notify={notify} />}
    </section>
  );
}

// Scans a digital campus pass QR (mint_campus_pass()/verify_campus_pass(),
// see supabase/migrations/20260814004400_digital_campus_pass.sql). Uses the
// browser's native BarcodeDetector where available (Chrome/Edge) so no extra
// scanning library is needed; a manual paste field is always available too
// (works everywhere, and doubles as the fallback when a camera isn't handy).
function VerifyPassPanel({ notify }) {
  const [manualToken, setManualToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectTimer = useRef(null);
  const detectorSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const check = async (token) => {
    const value = (token || "").trim();
    if (!value) return;
    try {
      setChecking(true);
      const row = await verifyCampusPass(value);
      setResult(row);
      if (!row.valid) notify(row.reason || "Invalid pass");
    } catch (err) {
      setResult({ valid: false, reason: err.message || "Could not verify this pass" });
      notify(err.message || "Could not verify this pass");
    } finally {
      setChecking(false);
    }
  };

  const stopScan = () => {
    clearInterval(detectTimer.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const startScan = async () => {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      detectTimer.current = setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            stopScan();
            check(codes[0].rawValue);
          }
        } catch {
          // A single failed detect() (e.g. a blank frame) isn't fatal --
          // just try again on the next tick.
        }
      }, 400);
    } catch (err) {
      setCameraError(err.message || "Could not access the camera");
    }
  };

  useEffect(() => () => stopScan(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="verify-pass-panel">
      <div className="verify-pass-scan">
        {detectorSupported ? (
          <>
            {scanning ? (
              <>
                <video ref={videoRef} muted playsInline className="verify-pass-video" />
                <button className="ghost wide" onClick={stopScan}><HiXMark /> Stop camera</button>
              </>
            ) : (
              <button className="primary wide" onClick={startScan}><HiCamera /> Scan with camera</button>
            )}
            {cameraError && <p style={{ color: "#c23a3a", fontSize: 12 }}>{cameraError}</p>}
          </>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 12 }}>
            Camera scanning isn&apos;t supported in this browser -- paste the pass token below instead.
          </p>
        )}
      </div>

      <label>Or paste the pass token
        <textarea
          rows={2}
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          placeholder="Paste the token shown under the student's QR code…"
        />
      </label>
      <button className="primary wide" disabled={checking || !manualToken.trim()} onClick={() => check(manualToken)}>
        {checking ? "Verifying…" : "Verify pass"}
      </button>

      {result && (
        <div className={`verify-pass-result ${result.valid ? "valid" : "invalid"}`}>
          {result.valid ? (
            <>
              <div className="big-avatar small">{result.holder_name?.[0] || "?"}</div>
              <div>
                <b>{result.holder_name}</b>
                <small>{result.holder_usn ? `USN: ${result.holder_usn} · ` : ""}{result.holder_course}</small>
                {result.verified_student && <span className="verified-pill"><HiShieldCheck /> VERIFIED STUDENT</span>}
              </div>
            </>
          ) : (
            <>
              <HiXCircle style={{ fontSize: 22 }} />
              <div><b>Not valid</b><small>{result.reason}</small></div>
            </>
          )}
        </div>
      )}
    </div>
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
