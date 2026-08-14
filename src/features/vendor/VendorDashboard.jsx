import React, { useEffect, useState } from "react";
import {
  HiXMark,
  HiPlus,
  HiPencilSquare,
  HiTrash,
  HiArchiveBoxArrowDown,
  HiCheck,
  HiXCircle,
  HiClock,
  HiTruck,
  HiQrCode,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as vendorApi from "./api";

/* =========================================================
   SHARED SHELL (mirrors App.jsx's ModalShell markup/classes, same
   convention the admin CMS uses, so this looks native without a
   fragile cross-file import)
========================================================= */

function Modal({ title, kicker, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <HiXMark />
        </button>
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function VendorDashboard({ notify, authUser }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canteen, setCanteen] = useState(null);
  const [printRates, setPrintRates] = useState([]);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const myCanteen = await vendorApi.getMyCanteen(authUser.id);
      if (myCanteen) {
        setCanteen(myCanteen);
        setPrintRates([]);
        return;
      }
      const rates = await vendorApi.getMyPrintRateCard(authUser.id);
      setCanteen(null);
      setPrintRates(rates);
    } catch (err) {
      setError(err.message || "Could not load your vendor dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading your dashboard…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  if (canteen) {
    return <CanteenMenuManager canteen={canteen} notify={notify} onCanteenChanged={reload} />;
  }

  if (printRates.length) {
    return <PrintPricingManager rates={printRates} notify={notify} onChanged={reload} />;
  }

  return (
    <section className="page-section admin-cms">
      <EmptyState
        title="No vendor profile assigned yet"
        text="This account isn't linked to a canteen or the print shop. Ask a campus admin to assign it."
      />
    </section>
  );
}

/* =========================================================
   CANTEEN MENU (Udupi / Tango / Munch / Nescafe)
========================================================= */

function CanteenMenuManager({ canteen, notify, onCanteenChanged }) {
  const [tab, setTab] = useState("orders");
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canteenModal, setCanteenModal] = useState(false);
  const [itemModal, setItemModal] = useState(null); // {} for new, {...item} to edit

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [i, cat] = await Promise.all([
        vendorApi.listMyFoodItems(canteen.id),
        vendorApi.listFoodCategories(),
      ]);
      setItems(i);
      setCategories(cat);
    } catch (err) {
      setError(err.message || "Could not load your menu");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [canteen.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="page-section admin-cms">
      <div className="section-head">
        <div>
          <span className="section-kicker">VENDOR DASHBOARD</span>
          <h1>{canteen.name}</h1>
          <p>{canteen.subtitle || "Manage your menu — changes go live immediately."}</p>
        </div>
        <button className="ghost" onClick={() => setCanteenModal(true)}>
          <HiPencilSquare /> Edit canteen details
        </button>
      </div>

      <div className="resource-row" style={{ marginBottom: 24 }}>
        <div>
          <b>Status: {canteen.status}</b>
          <small>ETA {canteen.eta_min}-{canteen.eta_max} min · {canteen.active ? "Visible to students" : "Hidden from students"}</small>
        </div>
      </div>

      <div className="socialize-filter-row">
        <button className={tab === "orders" ? "chip active" : "chip"} onClick={() => setTab("orders")}>Orders</button>
        <button className={tab === "menu" ? "chip active" : "chip"} onClick={() => setTab("menu")}>Menu</button>
      </div>

      {tab === "orders" && <OrderQueue canteen={canteen} notify={notify} />}

      {tab === "menu" && (
        <>
          {loading && <LoadingState label="Loading menu…" />}
          {error && <ErrorState text={error} onRetry={reload} />}

          {!loading && !error && (
            <>
              <div className="section-head">
                <h2>Menu items</h2>
                <button className="primary" onClick={() => setItemModal({ canteen_id: canteen.id })}>
                  <HiPlus /> New item
                </button>
              </div>

              <div className="resource-list">
                {items.length === 0 && <EmptyState title="No items yet" text="Add your first menu item to get started." />}
                {items.map((item) => (
                  <article className="resource-row" key={item.id}>
                    <div>
                      <b>{item.name}</b>
                      <small>
                        ₹{item.price} · {item.food_categories?.name || "Uncategorised"} ·{" "}
                        {item.is_vegetarian ? "Veg" : "Non-veg"} ·{" "}
                        {item.active ? (item.available ? "Available" : "Unavailable") : "Archived"}
                      </small>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setItemModal(item)}><HiPencilSquare /> Edit</button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete "${item.name}"? Items with past orders are archived instead of deleted.`)) return;
                          try {
                            const result = await vendorApi.deleteFoodItem(item.id);
                            notify(result.hardDeleted ? "Item deleted" : "Item has order history — archived instead");
                            reload();
                          } catch (err) {
                            notify(err.message || "Could not delete item");
                          }
                        }}
                      >
                        {item.active ? <><HiTrash /> Delete</> : <><HiArchiveBoxArrowDown /> Archived</>}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {canteenModal && (
        <CanteenDetailsForm
          canteen={canteen}
          onClose={() => setCanteenModal(false)}
          onSaved={() => { setCanteenModal(false); onCanteenChanged(); }}
          notify={notify}
        />
      )}

      {itemModal && (
        <FoodItemForm
          item={itemModal}
          canteenId={canteen.id}
          categories={categories}
          onClose={() => setItemModal(null)}
          onSaved={() => { setItemModal(null); reload(); }}
          notify={notify}
        />
      )}
    </section>
  );
}

/* =========================================================
   ORDER QUEUE (doc §13, §16)
   RECEIVED -> ACCEPTED -> PREPARING -> READY -> (OUT_FOR_DELIVERY ->) COMPLETED/DELIVERED
========================================================= */

const NEXT_STEP = {
  RECEIVED: { label: "Accept", to: "ACCEPTED" },
  ACCEPTED: { label: "Start preparing", to: "PREPARING" },
  PREPARING: { label: "Mark ready", to: "READY" },
};

function timeAgo(iso) {
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`;
}

function OrderQueue({ canteen, notify }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [history, setHistory] = useState(null); // null until "View recent history" is opened

  const reload = async () => {
    try {
      setError("");
      const active = await vendorApi.listActiveCanteenOrders(canteen.id);
      setOrders(active);
    } catch (err) {
      setError(err.message || "Could not load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    const unsubscribe = vendorApi.subscribeToCanteenOrders(canteen.id, reload);
    return unsubscribe;
  }, [canteen.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (order, toStatus, reason) => {
    try {
      setBusyId(order.id);
      await vendorApi.transitionOrderStatus(order.id, toStatus, reason);
      notify(`Order #${order.id.slice(0, 8)} → ${toStatus}`);
      // Don't wait on the realtime round-trip for feedback on your own
      // action -- reload immediately; the subscription is still there to
      // pick up changes made by someone else (another staff device).
      await reload();
    } catch (err) {
      notify(err.message || "Could not update order");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading order queue…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <>
      <div className="resource-list">
        {orders.length === 0 && (
          <EmptyState icon={<HiClock />} title="No active orders" text="New orders will appear here the moment a student pays." />
        )}
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} busy={busyId === order.id} onAct={act} onChanged={reload} notify={notify} />
        ))}
      </div>

      <button className="ghost" style={{ marginTop: 16 }} onClick={async () => {
        if (history !== null) { setHistory(null); return; }
        try { setHistory(await vendorApi.listCanteenOrderHistory(canteen.id)); }
        catch (err) { notify(err.message || "Could not load history"); }
      }}>
        {history === null ? "View recent history" : "Hide history"}
      </button>

      {history !== null && (
        <div className="resource-list" style={{ marginTop: 12 }}>
          {history.length === 0 && <EmptyState title="No past orders yet" />}
          {history.map((order) => (
            <article className="resource-row" key={order.id}>
              <div>
                <b>#{order.id.slice(0, 8)} · {order.status}</b>
                <small>
                  {order.order_items.map((i) => `${i.quantity}× ${i.item_name}`).join(", ")} · {timeAgo(order.created_at)}
                </small>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function OrderCard({ order, busy, onAct, onChanged, notify }) {
  const [pickupModal, setPickupModal] = useState(false);
  const next = NEXT_STEP[order.status];

  return (
    <article className="resource-row" style={{ alignItems: "flex-start" }}>
      <div>
        <b>
          #{order.id.slice(0, 8)} · {order.status}{" "}
          <span className="social-type" style={{ marginLeft: 6 }}>{order.fulfillment_type}</span>
        </b>
        <small>
          {order.order_items.map((i) => (
            <span key={i.id}>
              {i.quantity}× {i.item_name}
              {i.special_instructions ? ` (${i.special_instructions})` : ""}
              {"; "}
            </span>
          ))}
        </small>
        {order.notes && <small>Note: {order.notes}</small>}
        <small>{timeAgo(order.created_at)} · Order code {order.pickup_code}</small>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {order.status === "RECEIVED" && (
          <button disabled={busy} onClick={() => {
            const reason = window.prompt("Reason for rejecting this order? (shown to the student)");
            if (reason === null) return; // cancelled the prompt
            onAct(order, "REJECTED", reason || undefined);
          }}>
            <HiXCircle /> Reject
          </button>
        )}
        {next && (
          <button className="primary" disabled={busy} onClick={() => onAct(order, next.to)}>
            <HiCheck /> {next.label}
          </button>
        )}
        {order.status === "READY" && order.fulfillment_type === "pickup" && (
          <button className="primary" disabled={busy} onClick={() => setPickupModal(true)}>
            <HiQrCode /> Complete pickup
          </button>
        )}
        {order.status === "READY" && order.fulfillment_type === "delivery" && (
          <button className="primary" disabled={busy} onClick={() => onAct(order, "OUT_FOR_DELIVERY")}>
            <HiTruck /> Out for delivery
          </button>
        )}
        {order.status === "OUT_FOR_DELIVERY" && (
          <button className="primary" disabled={busy} onClick={() => onAct(order, "DELIVERED")}>
            <HiCheck /> Mark delivered
          </button>
        )}
        {["ACCEPTED", "PREPARING"].includes(order.status) && (
          <button disabled={busy} onClick={() => onAct(order, "CANCEL_REQUESTED", "Cancelled by vendor")}>
            <HiXCircle /> Cancel
          </button>
        )}
      </div>

      {pickupModal && (
        <PickupCodeModal
          order={order}
          onClose={() => setPickupModal(false)}
          onCompleted={() => { setPickupModal(false); onChanged(); }}
          notify={notify}
        />
      )}
    </article>
  );
}

// Asks the vendor to type the code the student reads out loud, verifying it
// against the real pickup token server issued when the order went READY --
// a bare "mark completed" button would let staff complete an order without
// the student actually being present to collect it.
function PickupCodeModal({ order, onClose, onCompleted, notify }) {
  const [tokenRow, setTokenRow] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    vendorApi.getOrderPickupToken(order.id).then(setTokenRow).catch((err) => notify(err.message || "Could not load pickup code"));
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!tokenRow) return;
    if (code.trim() !== tokenRow.short_code) {
      notify("That code doesn't match — ask the student to read it again.");
      return;
    }
    try {
      setBusy(true);
      await vendorApi.redeemPickupToken(tokenRow.token);
      notify(`Order #${order.id.slice(0, 8)} completed`);
      onCompleted();
    } catch (err) {
      notify(err.message || "Could not complete pickup");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal kicker="PICKUP" title={`Complete order #${order.id.slice(0, 8)}`} onClose={onClose}>
      <p>Ask the student for their 6-digit pickup code and enter it below.</p>
      <label>
        Pickup code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          maxLength={6}
          autoFocus
        />
      </label>
      <button className="primary wide" disabled={busy || !tokenRow || code.trim().length !== 6} onClick={submit}>
        {busy ? "Completing…" : "Complete pickup"}
      </button>
    </Modal>
  );
}

function CanteenDetailsForm({ canteen, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    name: canteen.name || "", subtitle: canteen.subtitle || "",
    status: canteen.status || "Open", eta_min: canteen.eta_min || 8, eta_max: canteen.eta_max || 15,
    color: canteen.color || "green", active: canteen.active !== false,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="CANTEEN" title="Edit canteen details" onClose={onClose}>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>Subtitle<input value={form.subtitle} onChange={(e) => change("subtitle", e.target.value)} /></label>
      <div className="form-grid">
        <label>Status
          <select value={form.status} onChange={(e) => change("status", e.target.value)}>
            <option>Open</option><option>Busy</option><option>Closed</option>
          </select>
        </label>
        <label>Queue color
          <select value={form.color} onChange={(e) => change("color", e.target.value)}>
            <option value="green">Quiet (green)</option>
            <option value="moderate">Moderate</option>
            <option value="busy">Busy</option>
          </select>
        </label>
        <label>ETA min<input type="number" min="1" value={form.eta_min} onChange={(e) => change("eta_min", e.target.value)} /></label>
        <label>ETA max<input type="number" min="1" value={form.eta_max} onChange={(e) => change("eta_max", e.target.value)} /></label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={form.active} onChange={(e) => change("active", e.target.checked)} /> Visible to students
      </label>
      <button className="primary wide" disabled={saving || !form.name.trim()} onClick={async () => {
        try { setSaving(true); await vendorApi.upsertCanteen(canteen.campus_id, { ...canteen, ...form }); notify("Canteen details saved"); onSaved(); }
        catch (err) { notify(err.message || "Could not save canteen"); } finally { setSaving(false); }
      }}>
        {saving ? "Saving…" : "Save canteen details"}
      </button>
    </Modal>
  );
}

function FoodItemForm({ item, canteenId, categories, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    category_id: item.category_id || "",
    name: item.name || "", description: item.description || "", price: item.price ?? 0,
    is_vegetarian: item.is_vegetarian !== false, available: item.available !== false,
    active: item.active !== false, featured: Boolean(item.featured),
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="MENU" title={item.id ? "Edit menu item" : "New menu item"} onClose={onClose}>
      <label>Category
        <select value={form.category_id} onChange={(e) => change("category_id", e.target.value)}>
          <option value="">Uncategorised</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>Description<textarea value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Price (₹)<input type="number" min="0" step="0.01" value={form.price} onChange={(e) => change("price", e.target.value)} /></label>
      <div className="form-grid">
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.is_vegetarian} onChange={(e) => change("is_vegetarian", e.target.checked)} /> Vegetarian
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.available} onChange={(e) => change("available", e.target.checked)} /> Available now
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.active} onChange={(e) => change("active", e.target.checked)} /> Active (on menu)
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.featured} onChange={(e) => change("featured", e.target.checked)} /> Featured
        </label>
      </div>
      <button className="primary wide" disabled={saving || !form.name.trim() || Number(form.price) < 0} onClick={async () => {
        try { setSaving(true); await vendorApi.upsertFoodItem({ ...item, ...form, canteen_id: canteenId }); notify("Menu item saved"); onSaved(); }
        catch (err) { notify(err.message || "Could not save item"); } finally { setSaving(false); }
      }}>
        {saving ? "Saving…" : "Save item"}
      </button>
    </Modal>
  );
}

/* =========================================================
   PRINT SHOP PRICING
========================================================= */

const RATE_LABELS = { black_white: "Black & White (per page)", colour: "Colour (per page)" };

function PrintPricingManager({ rates, notify, onChanged }) {
  return (
    <section className="page-section admin-cms">
      <div className="section-head">
        <div>
          <span className="section-kicker">VENDOR DASHBOARD</span>
          <h1>Print Shop</h1>
          <p>Set the per-page price used to quote every print job the moment it&apos;s uploaded.</p>
        </div>
      </div>

      <div className="resource-list">
        {rates.map((rate) => (
          <PrintRateRow key={rate.id} rate={rate} notify={notify} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function PrintRateRow({ rate, notify, onChanged }) {
  const [price, setPrice] = useState(String(rate.price_per_page));
  const [saving, setSaving] = useState(false);
  const dirty = Number(price) !== Number(rate.price_per_page);

  return (
    <article className="resource-row">
      <div>
        <b>{RATE_LABELS[rate.color_mode] || rate.color_mode}</b>
        <small>Applied to every new print job automatically</small>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span>₹</span>
        <input
          type="number"
          min="0"
          step="0.5"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          style={{ width: 90 }}
        />
        <button
          className="primary"
          disabled={saving || !dirty || Number(price) < 0}
          onClick={async () => {
            try {
              setSaving(true);
              await vendorApi.updatePrintRate(rate.id, Number(price));
              notify("Price updated");
              onChanged();
            } catch (err) {
              notify(err.message || "Could not update price");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </article>
  );
}
