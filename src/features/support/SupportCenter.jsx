import React, { useEffect, useState } from "react";
import { HiXMark, HiPlus, HiLifebuoy, HiPhone } from "react-icons/hi2";
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

function NewTicketModal({ onClose, notify, onCreated }) {
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!subject.trim()) { notify("Add a subject"); return; }
    try {
      setSaving(true);
      const ticket = await supportApi.createSupportTicket({ category, subject: subject.trim(), description: description.trim() });
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
      <button className="primary wide" disabled={saving || !subject.trim()} onClick={submit}>
        {saving ? "Submitting…" : "Submit ticket"}
      </button>
    </Modal>
  );
}

function TicketThreadModal({ ticket, notify, onClose }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(ticket.status);

  const reload = async () => {
    try { setLoading(true); setMessages(await supportApi.getSupportTicketMessages(ticket.id)); }
    catch (err) { notify(err.message || "Could not load the message thread"); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!reply.trim()) return;
    try {
      setSending(true);
      await supportApi.addSupportTicketMessage(ticket.id, reply.trim());
      setReply("");
      await reload();
      setStatus((s) => (s === "resolved" || s === "closed" ? "open" : s));
    } catch (err) {
      notify(err.message || "Could not send your reply");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal kicker={`SUPPORT · ${ticket.category.toUpperCase()}`} title={ticket.subject} onClose={onClose}>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>Status: {STATUS_LABEL[status] || status}</p>

      {loading ? <LoadingState label="Loading…" /> : (
        <div className="resource-list" style={{ maxHeight: 320, overflowY: "auto" }}>
          {messages.map((m) => (
            <article className="resource-row" key={m.id} style={{ background: m.is_staff ? "var(--card-alt, #f5f5fa)" : undefined }}>
              <div>
                <b>{m.is_staff ? "Campus support" : "You"}</b>
                <small>{m.body}</small>
                <small>{new Date(m.created_at).toLocaleString()}</small>
              </div>
            </article>
          ))}
        </div>
      )}

      <label>Reply<textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add more detail or reply to staff…" /></label>
      <button className="primary wide" disabled={sending || !reply.trim()} onClick={send}>
        {sending ? "Sending…" : "Send"}
      </button>
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
      <EmptyState icon={<HiLifebuoy />} title="Sign in to get help" text="Support tickets are tied to your account so staff can follow up."
        action={<button className="primary" onClick={openLogin}>Sign in</button>} />
    );
  }
  if (loading) return <LoadingState label="Loading your tickets…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      <button className="primary" onClick={() => setCreating(true)}><HiPlus /> New support ticket</button>

      {tickets.length === 0 ? (
        <EmptyState icon={<HiLifebuoy />} title="No tickets yet" text="Account, payment or technical problem? Submit a ticket and campus staff will follow up here." />
      ) : (
        tickets.map((t) => (
          <article className="resource-row" key={t.id} onClick={() => setOpenTicket(t)} style={{ cursor: "pointer" }}>
            <div className="resource-icon"><HiLifebuoy /></div>
            <div>
              <b>{t.subject}</b>
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
        <NewTicketModal notify={notify} onClose={() => setCreating(false)}
          onCreated={(ticket) => { setCreating(false); setTickets((cur) => [ticket, ...cur]); setOpenTicket(ticket); }} />
      )}
      {openTicket && (
        <TicketThreadModal ticket={openTicket} notify={notify} onClose={() => { setOpenTicket(null); reload(); }} />
      )}
    </div>
  );
}
