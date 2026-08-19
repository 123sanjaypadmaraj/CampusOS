import React, { useEffect, useState } from "react";
import { HiPlus, HiTrash, HiUserGroup } from "react-icons/hi2";
import { LoadingState, EmptyState } from "../../components/ui/States";
import * as vendorApi from "./api";

// Generalized across all three vendor types (supabase/migrations/
// 20260819000300_vendor_manager_accounts.sql) -- one "manager" sub-role,
// full owner-equivalent access (orders, pricing/menu/rate-card, refunds/
// payouts, and adding/removing other managers), no kitchen/cashier split.
// Standalone file (not defined inside VendorDashboard.jsx) so
// StoreDashboard.jsx can import it too without a circular import between
// the two dashboards.
const MANAGER_ACCOUNTS_API = {
  canteen: { list: vendorApi.listCanteenStaffAccounts, add: vendorApi.addCanteenStaffAccount, remove: vendorApi.removeCanteenStaffAccount },
  store: { list: vendorApi.listStoreStaffAccounts, add: vendorApi.addStoreStaffAccount, remove: vendorApi.removeStoreStaffAccount },
  print: { list: vendorApi.listPrintStaffAccounts, add: vendorApi.addPrintStaffAccount, remove: vendorApi.removePrintStaffAccount },
};

export default function VendorManagerAccounts({ vendorType, scopeId, notify }) {
  const api = MANAGER_ACCOUNTS_API[vendorType];
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    try { setLoading(true); setStaff(await api.list(scopeId)); }
    catch (err) { notify(err.message || "Could not load managers"); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [scopeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading managers…" />;

  return (
    <div>
      <div className="section-head">
        <h2>Manager accounts</h2>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          A manager gets the same access you do — orders, pricing, refunds and adding/removing other managers. Only you can transfer ownership itself (ask a campus admin).
        </p>
      </div>

      <div className="form-grid" style={{ maxWidth: 420 }}>
        <label>Add a manager by email
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@nhce.edu.in" />
        </label>
      </div>
      <button
        className="primary"
        disabled={adding || !email.trim()}
        onClick={async () => {
          try {
            setAdding(true);
            await api.add(scopeId, email.trim());
            notify("Manager added");
            setEmail("");
            await reload();
          } catch (err) { notify(err.message || "Could not add manager — they need an existing CampusOS account"); }
          finally { setAdding(false); }
        }}
      >
        <HiPlus /> Add manager
      </button>

      <div className="resource-list" style={{ marginTop: 16 }}>
        {staff.length === 0 && <EmptyState title="No managers yet" text="Add someone by the email they signed up with." />}
        {staff.map((s) => (
          <article className="resource-row" key={s.id}>
            <div className="resource-icon"><HiUserGroup /></div>
            <div><b>{s.profiles?.name || "Manager"}</b><small>{s.profiles?.email}</small></div>
            <button
              className="ghost"
              onClick={async () => {
                if (!window.confirm(`Remove ${s.profiles?.name || "this manager"}? They'll lose access immediately.`)) return;
                try { await api.remove(s.id); notify("Manager removed"); reload(); }
                catch (err) { notify(err.message || "Could not remove manager"); }
              }}
            >
              <HiTrash />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
