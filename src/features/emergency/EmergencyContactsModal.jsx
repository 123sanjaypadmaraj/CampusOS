import React, { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { deleteEmergencyContact, listMyEmergencyContacts, upsertEmergencyContact } from "../../services/mvpService";
import { HiPencilSquare, HiPhone, HiPlus, HiShieldCheck, HiTrash } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";

const EMERGENCY_RELATIONSHIPS = [
  ["parent", "Parent"], ["guardian", "Guardian"], ["sibling", "Sibling"],
  ["spouse", "Spouse"], ["relative", "Relative"], ["friend", "Friend"], ["other", "Other"],
];

function EmergencyContactsModal({ onClose, notify }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null = not editing, {} = new, {...} = existing
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setContacts(await listMyEmergencyContacts());
    } catch (err) {
      setError(err.message || "Could not load your emergency contacts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (contact) => {
    if (!window.confirm(`Remove ${contact.contact_name} as an emergency contact?`)) return;
    try {
      await deleteEmergencyContact(contact.id);
      notify("Emergency contact removed");
      await reload();
    } catch (err) {
      notify(err.message || "Could not remove this contact");
    }
  };

  const save = async (form) => {
    try {
      setSaving(true);
      await upsertEmergencyContact({
        id: editing?.id || null,
        contactName: form.contact_name,
        relationship: form.relationship,
        phone: form.phone,
        altPhone: form.alt_phone,
        email: form.email,
        isPrimary: form.is_primary,
      });
      notify(editing?.id ? "Emergency contact updated" : "Emergency contact added");
      setEditing(null);
      await reload();
    } catch (err) {
      notify(err.message || "Could not save this contact");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell kicker="EMERGENCY CONTACTS" title="Your next-of-kin contacts" onClose={onClose}>
      {editing ? (
        <EmergencyContactForm
          initial={editing}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : (
        <>
          {loading && <LoadingState label="Loading your contacts…" />}
          {!loading && error && <ErrorState text={error} onRetry={reload} />}
          {!loading && !error && contacts.length === 0 && (
            <EmptyState icon={<HiPhone />} title="No emergency contacts yet" text="Add at least one so a responder can reach someone on your behalf in a real emergency." />
          )}
          {!loading && !error && contacts.map((contact) => (
            <div key={contact.id} className="resource-row">
              <div>
                <b>
                  {contact.contact_name}{" "}
                  <small>({EMERGENCY_RELATIONSHIPS.find(([k]) => k === contact.relationship)?.[1] || contact.relationship})</small>
                  {contact.is_primary && <span className="social-type" style={{ marginLeft: 6 }}>PRIMARY</span>}
                </b>
                <small>
                  {contact.phone}{contact.alt_phone ? ` · alt ${contact.alt_phone}` : ""}
                  {" · "}
                  {contact.verified ? (
                    <span><HiShieldCheck /> Verified</span>
                  ) : (
                    "Pending verification"
                  )}
                </small>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setEditing(contact)} aria-label={`Edit ${contact.contact_name || "contact"}`}><HiPencilSquare /></button>
                <button onClick={() => remove(contact)} aria-label={`Remove ${contact.contact_name || "contact"}`}><HiTrash /></button>
              </div>
            </div>
          ))}
          {!loading && !error && contacts.length < 5 && (
            <button className="primary wide" onClick={() => setEditing({})}>
              <HiPlus /> Add emergency contact
            </button>
          )}
        </>
      )}
    </ModalShell>
  );
}

function EmergencyContactForm({ initial, saving, onCancel, onSave }) {
  const [form, setForm] = useState({
    contact_name: initial?.contact_name || "",
    relationship: initial?.relationship || "parent",
    phone: initial?.phone || "",
    alt_phone: initial?.alt_phone || "",
    email: initial?.email || "",
    is_primary: initial?.is_primary || false,
  });
  const change = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div>
      <label>
        Name
        <input value={form.contact_name} onChange={(e) => change("contact_name", e.target.value)} placeholder="Contact's full name" />
      </label>
      <label>
        Relationship
        <select value={form.relationship} onChange={(e) => change("relationship", e.target.value)}>
          {EMERGENCY_RELATIONSHIPS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label>
        Phone
        <input value={form.phone} onChange={(e) => change("phone", e.target.value)} placeholder="+91XXXXXXXXXX" />
      </label>
      <label>
        Alternate phone (optional)
        <input value={form.alt_phone} onChange={(e) => change("alt_phone", e.target.value)} placeholder="Optional" />
      </label>
      <label>
        Email (optional)
        <input value={form.email} onChange={(e) => change("email", e.target.value)} placeholder="Optional" />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" checked={form.is_primary} onChange={(e) => change("is_primary", e.target.checked)} style={{ width: "auto" }} />
        Make this my primary contact
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="primary wide" disabled={saving} onClick={() => onSave(form)}>
          {saving ? "Saving…" : "Save contact"}
        </button>
        <button disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export { EMERGENCY_RELATIONSHIPS, EmergencyContactForm, EmergencyContactsModal };
