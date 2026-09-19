import React, { useEffect, useState } from "react";
import { getMyEventFeedback, getMyEventTicket, submitEventFeedback } from "../../services/mvpService";
import QRCode from "qrcode";
import { HiArrowDownTray, HiStar } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";

function EventTicketModal({ event, userId, notify, onClose }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [myFeedback, setMyFeedback] = useState(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getMyEventTicket({ eventId: event.id, userId }),
      getMyEventFeedback({ eventId: event.id, userId }),
    ])
      .then(([t, f]) => {
        if (cancelled) return;
        setTicket(t);
        setMyFeedback(f);
        if (f) { setRating(f.rating); setComment(f.comment || ""); }
      })
      .catch((err) => notify?.(err.message || "Could not load your ticket"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [event.id, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ticket?.token) { setQrDataUrl(""); return; }
    let cancelled = false;
    QRCode.toDataURL(ticket.token, { width: 220, margin: 1, color: { dark: "#17151f", light: "#ffffff" } })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ticket?.token]);

  const checkedIn = Boolean(ticket?.checkedInAt);

  const downloadCertificate = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 850;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#faf8f4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#6e48ed";
    ctx.lineWidth = 10;
    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);
    ctx.strokeStyle = "#c9bdfb";
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 50, canvas.width - 100, canvas.height - 100);
    ctx.textAlign = "center";
    ctx.fillStyle = "#6e48ed";
    ctx.font = "700 22px Manrope, sans-serif";
    ctx.fillText("CAMPUSOS", canvas.width / 2, 150);
    ctx.fillStyle = "#17151f";
    ctx.font = "800 44px Manrope, sans-serif";
    ctx.fillText("Certificate of Participation", canvas.width / 2, 230);
    ctx.font = "400 22px Manrope, sans-serif";
    ctx.fillStyle = "#4a4658";
    ctx.fillText("This certifies that", canvas.width / 2, 340);
    ctx.font = "800 40px Manrope, sans-serif";
    ctx.fillStyle = "#17151f";
    ctx.fillText(ticket?.name || "Participant", canvas.width / 2, 410);
    ctx.font = "400 22px Manrope, sans-serif";
    ctx.fillStyle = "#4a4658";
    ctx.fillText("successfully participated in", canvas.width / 2, 480);
    ctx.font = "700 32px Manrope, sans-serif";
    ctx.fillStyle = "#17151f";
    wrapCanvasText(ctx, event.title || "a CampusOS event", canvas.width / 2, 540, 1000, 40);
    ctx.font = "400 18px Manrope, sans-serif";
    ctx.fillStyle = "#7a7688";
    ctx.fillText(
      event.event_date || event.eventDate ? new Date(event.event_date || event.eventDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "",
      canvas.width / 2, 700
    );

    const link = document.createElement("a");
    link.download = `${(event.title || "certificate").replace(/[^a-zA-Z0-9._-]/g, "_")}-certificate.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <ModalShell kicker="EVENT TICKET" title={event.title} onClose={onClose}>
      {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      {!loading && !ticket && <p style={{ color: "var(--muted)" }}>No active ticket for this event -- you may be on the waitlist.</p>}
      {!loading && ticket && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          {qrDataUrl && (
            <div style={{ width: 180, height: 180, margin: "0 auto 16px", background: "#fff", borderRadius: 16, display: "grid", placeItems: "center", border: "2px solid #6e48ed", padding: 10 }}>
              <img src={qrDataUrl} alt="Event ticket QR code" style={{ width: "100%", height: "100%" }} />
            </div>
          )}
          <span style={{ background: checkedIn ? "#e4f7ef" : "#fdf0da", color: checkedIn ? "#13845b" : "#a6690a", padding: "6px 14px", borderRadius: 999, fontSize: 11, fontWeight: 800 }}>
            {checkedIn ? `CHECKED IN · ${new Date(ticket.checkedInAt).toLocaleString()}` : "SHOW THIS QR AT THE DOOR"}
          </span>

          {checkedIn && event.certificates_enabled && (
            <button className="primary wide" style={{ marginTop: 16 }} onClick={downloadCertificate}>
              <HiArrowDownTray /> Download certificate
            </button>
          )}

          {checkedIn && (
            <div style={{ marginTop: 20, textAlign: "left" }}>
              <h4 style={{ marginBottom: 8 }}>{myFeedback ? "Your feedback" : "Rate this event"}</h4>
              <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className="ghost"
                    style={{ padding: 4, color: n <= rating ? "#f5a623" : "var(--muted)" }}
                    onClick={() => setRating(n)}
                    aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
                    aria-pressed={n <= rating}
                  >
                    <HiStar />
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                placeholder="Optional comment for the organizers…"
                aria-label="Comment for the organizers"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button
                className="primary wide"
                style={{ marginTop: 8 }}
                disabled={submittingFeedback}
                onClick={async () => {
                  try {
                    setSubmittingFeedback(true);
                    await submitEventFeedback({ eventId: event.id, rating, comment });
                    notify?.("Thanks for the feedback!");
                    setMyFeedback({ rating, comment });
                  } catch (err) {
                    notify?.(err.message || "Could not submit feedback");
                  } finally {
                    setSubmittingFeedback(false);
                  }
                }}
              >
                {submittingFeedback ? "Saving…" : myFeedback ? "Update feedback" : "Submit feedback"}
              </button>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = (text || "").split(" ");
  let line = "";
  let curY = y;
  for (let i = 0; i < words.length; i++) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = words[i];
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, curY);
}

export { EventTicketModal, wrapCanvasText };
