import React, { useEffect, useState } from "react";
import { HiXMark, HiPlus, HiLifebuoy, HiPhone, HiPaperClip, HiChevronDown, HiExclamationTriangle } from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as supportApi from "./api";

// Local modal shell rather than importing App.jsx's ModalShell -- same
// "avoid a fragile cross-file import" call AdminCMS.jsx's own local Modal
// component already made (App.jsx imports this component, so importing
// back from App.jsx would be circular). Same markup/classes so it looks
// native.
function Modal({ title, kicker, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><HiXMark /></button>
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const CATEGORIES = [
  ["general", "General"], ["account", "Account"], ["payment", "Payment"],
  ["technical", "Technical"], ["other", "Other"],
];
const STATUS_LABEL = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
const PRIORITY_LABEL = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

// Same status-pill.priority-* convention as the vendor order queue
// (VendorDashboard.jsx) -- priority-high/priority-urgent already have
// colors defined there; priority-low added alongside this feature.
function PriorityBadge({ priority }) {
  if (!priority || priority === "normal") return null;
  return (
    <span className={`status-pill priority-${priority}`}>
      {priority === "urgent" && <HiExclamationTriangle />} {PRIORITY_LABEL[priority] || priority}
    </span>
  );
}

// Self-serve help centre -- surfaced above the ticket list so a student can
// find an answer before filing a ticket. Reads even signed-out (support_faqs
// RLS grants anon select) so this also works from the pre-login shell if the
// service is ever exposed there; here it's rendered inside the signed-in
// support screen.
function HelpCentre({ campusId }) {
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [category, setCategory] = useState("");

  useEffect(() => {
    supportApi.getSupportFaqs(campusId).then(setFaqs).catch(() => setFaqs([])).finally(() => setLoading(false));
  }, [campusId]);

  if (loading || faqs.length === 0) return null;

  const shown = category ? faqs.filter((f) => f.category === category) : faqs;
  const cats = [...new Set(faqs.map((f) => f.category))];

  return (
    <div className="service-dash-card" style={{ marginBottom: 8 }}>
      <span className="section-kicker">HELP CENTRE</span>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>Common answers before you file a ticket.</p>
      {cats.length > 1 && (
        <div className="chips" style={{ margin: "8px 0" }}>
          <button className={category === "" ? "chip active" : "chip"} onClick={() => setCategory("")}>All</button>
          {cats.map((c) => (
            <button key={c} className={category === c ? "chip active" : "chip"} onClick={() => setCategory(c)}>
              {CATEGORIES.find(([k]) => k === c)?.[1] || c}
            </button>
          ))}
        </div>
      )}
      <div className="resource-list">
        {shown.map((f) => (
          <article className="resource-row faq-row" key={f.id} onClick={() => setOpenId((cur) => (cur === f.id ? null : f.id))} style={{ cursor: "pointer" }}>
            <div style={{ width: "100%" }}>
              <b style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                {f.question}
                <HiChevronDown style={{ transform: openId === f.id ? "rotate(180deg)" : undefined, transition: "transform .15s", flexShrink: 0 }} />
              </b>
              {openId === f.id && <small style={{ whiteSpace: "pre-wrap" }}>{f.answer}</small>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function AttachmentField({ label, file, setFile, notify }) {
  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type?.startsWith("image/")) { notify("Attach an image (screenshot)"); return; }
    setFile(f);
  };
  return (
    <label>
      {label}
      <input type="file" accept="image/*" onChange={onPick} />
      {file && <small><HiPaperClip /> {file.name}</small>}
    </label>
  );
}

function NewTicketModal({ onClose, notify, onCreated, authUser }) {
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!subject.trim()) { notify("Add a subject"); return; }
    try {
      setSaving(true);
      let attachmentUrl = null;
      if (file) attachmentUrl = await supportApi.uploadSupportAttachment(file, authUser.id);
      const ticket = await supportApi.createSupportTicket({ category, subject: subject.trim(), description: description.trim(), attachmentUrl });
      notify("Ticket submitted — staff will get back to you here");
      onCreated(ticket);
    } catch (err) {
      notify(err.message || "Could not submit your ticket");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="NEW SUPPORT TICKET" title="What do you need help with?" onClose={onClose}>
      <label>Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Payment for order #1234 didn't go through" /></label>
      <label>Details (optional)<textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened, and what you expected instead" /></label>
      <AttachmentField label="Attach a screenshot (optional)" file={file} setFile={setFile} notify={notify} />
      <button className="primary wide" disabled={saving || !subject.trim()} onClick={submit}>
        {saving ? "Submitting…" : "Submit ticket"}
      </button>
    </Modal>
  );
}

function TicketThreadModal({ ticket, authUser, notify, onClose }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);

  const reload = async () => {
    try {
      setLoading(true);
      const msgs = await supportApi.getSupportTicketMessages(ticket.id);
      const withUrls = await Promise.all(msgs.map(async (m) => (
        m.attachment_url ? { ...m, attachmentSignedUrl: await supportApi.getSupportAttachmentUrl(m.attachment_url).catch(() => null) } : m
      )));
      setMessages(withUrls);
    } catch (err) { notify(err.message || "Could not load the message thread"); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!reply.trim() && !file) return;
    try {
      setSending(true);
      let attachmentUrl = null;
      if (file) attachmentUrl = await supportApi.uploadSupportAttachment(file, authUser.id);
      await supportApi.addSupportTicketMessage(ticket.id, reply.trim(), attachmentUrl);
      setReply("");
      setFile(null);
      await reload();
      setStatus((s) => (s === "resolved" || s === "closed" ? "open" : s));
    } catch (err) {
      notify(err.message || "Could not send your reply");
    } finally {
      setSending(false);
    }
  };

  const escalate = async () => {
    try {
      setEscalating(true);
      await supportApi.escalateSupportTicket(ticket.id, "Escalated by student — still waiting on a response");
      setPriority("urgent");
      notify("Ticket escalated — support staff have been notified");
    } catch (err) {
      notify(err.message || "Could not escalate this ticket");
    } finally {
      setEscalating(false);
    }
  };

  return (
    <Modal kicker={`SUPPORT · ${ticket.category.toUpperCase()}`} title={ticket.subject} onClose={onClose}>
      <p style={{ color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        Status: {STATUS_LABEL[status] || status} <PriorityBadge priority={priority} />
      </p>

      {loading ? <LoadingState label="Loading…" /> : (
        <div className="resource-list" style={{ maxHeight: 320, overflowY: "auto" }}>
          {messages.map((m) => (
            <article className="resource-row" key={m.id} style={{ background: m.is_staff ? "var(--card-alt, #f5f5fa)" : undefined }}>
              <div>
                <b>{m.is_staff ? "Campus support" : "You"}</b>
                {m.body && <small>{m.body}</small>}
                {m.attachmentSignedUrl && (
                  <a href={m.attachmentSignedUrl} target="_blank" rel="noreferrer">
                    <img src={m.attachmentSignedUrl} alt="Attachment" style={{ maxWidth: 160, borderRadius: 8, marginTop: 4, display: "block" }} />
                  </a>
                )}
                <small>{new Date(m.created_at).toLocaleString()}</small>
              </div>
            </article>
          ))}
        </div>
      )}

      <label>Reply<textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add more detail or reply to staff…" /></label>
      <AttachmentField label="Attach a screenshot (optional)" file={file} setFile={setFile} notify={notify} />
      <button className="primary wide" disabled={sending || (!reply.trim() && !file)} onClick={send}>
        {sending ? "Sending…" : "Send"}
      </button>

      {status !== "resolved" && status !== "closed" && priority !== "urgent" && (
        <button className="ghost wide" disabled={escalating} style={{ marginTop: 8 }} onClick={escalate}>
          <HiExclamationTriangle /> {escalating ? "Escalating…" : "Still stuck? Escalate this ticket"}
        </button>
      )}
    </Modal>
  );
}

export default function SupportService({ notify, authUser, openLogin, campusId }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [openTicket, setOpenTicket] = useState(null);
  const [contact, setContact] = useState(null);

  useEffect(() => {
    if (campusId) supportApi.getCampusContactInfo(campusId).then(setContact).catch(() => {});
  }, [campusId]);

  const reload = () => {
    if (!authUser) { setLoading(false); return; }
    setLoading(true);
    setError("");
    supportApi.getMySupportTickets(authUser.id)
      .then(setTickets)
      .catch((err) => setError(err.message || "Could not load your tickets"))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!authUser) {
    return (
      <div className="resource-list">
        <HelpCentre campusId={campusId} />
        <EmptyState icon={<HiLifebuoy />} title="Sign in to get help" text="Support tickets are tied to your account so staff can follow up."
          action={<button className="primary" onClick={openLogin}>Sign in</button>} />
      </div>
    );
  }
  if (loading) return <LoadingState label="Loading your tickets…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      <HelpCentre campusId={campusId} />

      <button className="primary" onClick={() => setCreating(true)}><HiPlus /> New support ticket</button>

      {tickets.length === 0 ? (
        <EmptyState icon={<HiLifebuoy />} title="No tickets yet" text="Account, payment or technical problem? Submit a ticket and campus staff will follow up here." />
      ) : (
        tickets.map((t) => (
          <article className="resource-row" key={t.id} onClick={() => setOpenTicket(t)} style={{ cursor: "pointer" }}>
            <div className="resource-icon"><HiLifebuoy /></div>
            <div>
              <b>{t.subject} <PriorityBadge priority={t.priority} /></b>
              <small>{t.category} · {new Date(t.created_at).toLocaleString()}</small>
            </div>
            <strong>{STATUS_LABEL[t.status]}</strong>
          </article>
        ))
      )}

      <div className="service-dash-card" style={{ marginTop: 8 }}>
        <span className="section-kicker">STILL STUCK?</span>
        <p style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
          {(contact?.support_email || contact?.support_phone) ? (
            <>
              {contact.support_phone && <a href={`tel:${contact.support_phone}`}><HiPhone /> {contact.support_phone}</a>}
              {contact.support_email && <a href={`mailto:${contact.support_email}`}>{contact.support_email}</a>}
            </>
          ) : (
            <span><HiPhone /> Check the campus emergency directory for security/medical/hostel numbers</span>
          )}
        </p>
      </div>

      {creating && (
        <NewTicketModal notify={notify} authUser={authUser} onClose={() => setCreating(false)}
          onCreated={(ticket) => { setCreating(false); setTickets((cur) => [ticket, ...cur]); setOpenTicket(ticket); }} />
      )}
      {openTicket && (
        <TicketThreadModal ticket={openTicket} authUser={authUser} notify={notify} onClose={() => { setOpenTicket(null); reload(); }} />
      )}
    </div>
  );
}
