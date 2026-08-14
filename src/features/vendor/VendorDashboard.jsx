import React, { useEffect, useMemo, useState } from "react";
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
  HiPrinter,
  HiMagnifyingGlass,
  HiPhoto,
  HiPercentBadge,
  HiEyeSlash,
  HiEye,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as vendorApi from "./api";
import VendorAnalytics from "./Analytics";

/* =========================================================
   SHARED SHELL (mirrors App.jsx's ModalShell markup/classes, same
   convention the admin CMS uses, so this looks native without a
   fragile cross-file import)
========================================================= */

function Modal({ title, kicker, onClose, children, className }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`feature-modal${className ? ` ${className}` : ""}`} onMouseDown={(e) => e.stopPropagation()}>
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
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all"); // all | available | unavailable | archived
  const [bulkBusy, setBulkBusy] = useState(false);

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
      setSelected(new Set());
    } catch (err) {
      setError(err.message || "Could not load your menu");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [canteen.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (categoryFilter !== "all" && item.category_id !== categoryFilter) return false;
      if (statusFilter === "archived" && item.active) return false;
      if (statusFilter === "available" && !(item.active && item.available)) return false;
      if (statusFilter === "unavailable" && !(item.active && !item.available)) return false;
      return true;
    });
  }, [items, search, categoryFilter, statusFilter]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((i) => selected.has(i.id));
  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleItems.forEach((i) => next.delete(i.id));
        return next;
      }
      const next = new Set(prev);
      visibleItems.forEach((i) => next.add(i.id));
      return next;
    });
  };

  const selectedIds = [...selected];
  const selectedItems = items.filter((i) => selected.has(i.id));

  const runBulk = async (fn, successMsg) => {
    try {
      setBulkBusy(true);
      await fn();
      notify(successMsg);
      await reload();
    } catch (err) {
      notify(err.message || "Bulk action failed");
    } finally {
      setBulkBusy(false);
    }
  };

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
        <button className={tab === "analytics" ? "chip active" : "chip"} onClick={() => setTab("analytics")}>Analytics</button>
      </div>

      {tab === "orders" && <OrderQueue canteen={canteen} notify={notify} />}

      {tab === "analytics" && <VendorAnalytics />}

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

              {items.length > 0 && (
                <div className="vendor-menu-toolbar">
                  <label className="vendor-search-box">
                    <HiMagnifyingGlass />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search items…"
                      aria-label="Search menu items"
                    />
                  </label>
                  <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
                    <option value="all">All categories</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
                    <option value="all">All statuses</option>
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                    <option value="archived">Archived</option>
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                    Select all ({visibleItems.length})
                  </label>
                </div>
              )}

              {selected.size > 0 && (
                <BulkActionsBar
                  count={selected.size}
                  categories={categories}
                  busy={bulkBusy}
                  onClear={() => setSelected(new Set())}
                  onAvailable={(available) => runBulk(
                    () => vendorApi.bulkSetAvailability(selectedIds, available),
                    `${selectedIds.length} item(s) marked ${available ? "available" : "unavailable"}`
                  )}
                  onArchive={() => {
                    if (!window.confirm(`Archive ${selectedIds.length} item(s)? They'll be hidden from students but past orders stay intact.`)) return;
                    runBulk(() => vendorApi.bulkArchiveFoodItems(selectedIds), `${selectedIds.length} item(s) archived`);
                  }}
                  onCategory={(categoryId) => runBulk(
                    () => vendorApi.bulkSetCategory(selectedIds, categoryId),
                    `${selectedIds.length} item(s) moved`
                  )}
                  onPriceAdjust={(opts) => runBulk(
                    () => vendorApi.bulkAdjustPrice(selectedItems, opts),
                    `Price updated on ${selectedIds.length} item(s)`
                  )}
                />
              )}

              <div className="vendor-item-grid">
                {items.length === 0 && <EmptyState title="No items yet" text="Add your first menu item to get started." />}
                {items.length > 0 && visibleItems.length === 0 && (
                  <EmptyState title="No items match" text="Try clearing your search or filters." />
                )}
                {visibleItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    onToggleSelect={() => toggleSelect(item.id)}
                    onEdit={() => setItemModal(item)}
                    onDelete={async () => {
                      if (!window.confirm(`Delete "${item.name}"? Items with past orders are archived instead of deleted.`)) return;
                      try {
                        const result = await vendorApi.deleteFoodItem(item.id);
                        notify(result.hardDeleted ? "Item deleted" : "Item has order history — archived instead");
                        reload();
                      } catch (err) {
                        notify(err.message || "Could not delete item");
                      }
                    }}
                    onToggleAvailable={() => runBulk(
                      () => vendorApi.bulkSetAvailability([item.id], !item.available),
                      item.available ? "Marked unavailable" : "Marked available"
                    )}
                  />
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

/* =========================================================
   MENU ITEM CARD (grid view, doc §16 bulk menu & inventory)
========================================================= */

function statusLabel(item) {
  if (!item.active) return { text: "Archived", cls: "archived" };
  return item.available ? { text: "Available", cls: "available" } : { text: "Unavailable", cls: "unavailable" };
}

function ItemCard({ item, selected, onToggleSelect, onEdit, onDelete, onToggleAvailable }) {
  const status = statusLabel(item);
  return (
    <article className={`vendor-item-card${selected ? " selected" : ""}${!item.active ? " archived" : ""}`}>
      <input
        type="checkbox"
        className="vendor-item-select"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Select ${item.name}`}
      />
      <div className="vendor-item-thumb">
        {item.image_url ? <img src={item.image_url} alt="" /> : <HiPhoto />}
      </div>
      <div className="vendor-item-title-row">
        <b>{item.name}</b>
        <span className="vendor-item-price">₹{item.price}</span>
      </div>
      <div className="vendor-item-meta">
        <span className={`veg-dot${item.is_vegetarian ? "" : " non-veg"}`} />
        {item.food_categories?.name || "Uncategorised"}
        <span className={`status-pill ${status.cls}`}>{status.text}</span>
      </div>
      <div className="vendor-item-actions">
        <button onClick={onEdit}><HiPencilSquare /> Edit</button>
        {item.active && (
          <button onClick={onToggleAvailable} title={item.available ? "Mark unavailable" : "Mark available"}>
            {item.available ? <HiEyeSlash /> : <HiEye />}
          </button>
        )}
        <button onClick={onDelete}>
          {item.active ? <><HiTrash /> Delete</> : <><HiArchiveBoxArrowDown /> Archived</>}
        </button>
      </div>
    </article>
  );
}

/* =========================================================
   BULK ACTIONS BAR (doc §16 bulk menu & inventory)
========================================================= */

function BulkActionsBar({ count, categories, busy, onClear, onAvailable, onArchive, onCategory, onPriceAdjust }) {
  const [priceMode, setPriceMode] = useState("percent"); // 'percent' | 'amount'
  const [priceDirection, setPriceDirection] = useState("1"); // '1' increase, '-1' decrease
  const [priceValue, setPriceValue] = useState("");

  return (
    <div className="bulk-action-bar">
      <strong>{count} selected</strong>
      <div className="bulk-actions">
        <button disabled={busy} onClick={() => onAvailable(true)}><HiEye /> Mark available</button>
        <button disabled={busy} onClick={() => onAvailable(false)}><HiEyeSlash /> Mark unavailable</button>

        <select
          disabled={busy}
          defaultValue="__placeholder__"
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__placeholder__") return;
            onCategory(v === "__none__" ? null : v);
            e.target.value = "__placeholder__";
          }}
          aria-label="Move selected items to category"
        >
          <option value="__placeholder__" disabled>Move to category…</option>
          <option value="__none__">Uncategorised</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div className="bulk-price-form">
          <HiPercentBadge />
          <select value={priceDirection} onChange={(e) => setPriceDirection(e.target.value)} aria-label="Increase or decrease price">
            <option value="1">Increase</option>
            <option value="-1">Decrease</option>
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            value={priceValue}
            onChange={(e) => setPriceValue(e.target.value)}
            placeholder="0"
            aria-label="Price adjustment value"
          />
          <select value={priceMode} onChange={(e) => setPriceMode(e.target.value)} aria-label="Adjust by percent or amount">
            <option value="percent">%</option>
            <option value="amount">₹</option>
          </select>
          <button
            disabled={busy || !priceValue || Number(priceValue) <= 0}
            onClick={() => { onPriceAdjust({ mode: priceMode, value: priceValue, direction: Number(priceDirection) }); setPriceValue(""); }}
          >
            Apply
          </button>
        </div>

        <button disabled={busy} onClick={onArchive}><HiArchiveBoxArrowDown /> Archive</button>
        <button disabled={busy} onClick={onClear}><HiXMark /> Clear</button>
      </div>
    </div>
  );
}

/* =========================================================
   TOGGLE SWITCH (better UI for the item editor's on/off fields)
========================================================= */

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <label className="toggle-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </label>
    </div>
  );
}

/* =========================================================
   MENU ITEM EDITOR -- redesigned: sectioned form + live preview
========================================================= */

function FoodItemForm({ item, canteenId, categories, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    category_id: item.category_id || "",
    name: item.name || "", description: item.description || "", price: item.price ?? 0,
    image_url: item.image_url || "", preparation_time_min: item.preparation_time_min ?? 10,
    is_vegetarian: item.is_vegetarian !== false, available: item.available !== false,
    active: item.active !== false, featured: Boolean(item.featured),
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const categoryName = categories.find((c) => c.id === form.category_id)?.name;

  return (
    <Modal kicker="MENU" title={item.id ? "Edit menu item" : "New menu item"} onClose={onClose} className="item-form-modal">
      <div className="item-form-layout">
        <div>
          <div className="item-form-section-label">Basics</div>
          <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} autoFocus /></label>
          <label>Category
            <select value={form.category_id} onChange={(e) => change("category_id", e.target.value)}>
              <option value="">Uncategorised</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Description<textarea value={form.description} onChange={(e) => change("description", e.target.value)} placeholder="What's in it, how it's made…" /></label>
          <label>Photo URL<input value={form.image_url} onChange={(e) => change("image_url", e.target.value)} placeholder="https://…" /></label>

          <div className="item-form-section-label">Pricing &amp; prep</div>
          <div className="form-grid">
            <label>Price
              <div className="price-input-wrap">
                <span>₹</span>
                <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => change("price", e.target.value)} />
              </div>
            </label>
            <label>Prep time (min)<input type="number" min="1" value={form.preparation_time_min} onChange={(e) => change("preparation_time_min", e.target.value)} /></label>
          </div>

          <div className="item-form-section-label">Visibility</div>
          <ToggleSwitch label="Vegetarian" checked={form.is_vegetarian} onChange={(v) => change("is_vegetarian", v)} />
          <ToggleSwitch label="Available now" checked={form.available} onChange={(v) => change("available", v)} />
          <ToggleSwitch label="Active (on menu)" checked={form.active} onChange={(v) => change("active", v)} />
          <ToggleSwitch label="Featured" checked={form.featured} onChange={(v) => change("featured", v)} />

          <button
            className="primary wide"
            style={{ marginTop: 20 }}
            disabled={saving || !form.name.trim() || Number(form.price) < 0}
            onClick={async () => {
              try { setSaving(true); await vendorApi.upsertFoodItem({ ...item, ...form, canteen_id: canteenId }); notify("Menu item saved"); onSaved(); }
              catch (err) { notify(err.message || "Could not save item"); } finally { setSaving(false); }
            }}
          >
            {saving ? "Saving…" : "Save item"}
          </button>
        </div>

        <div className="item-form-preview">
          <div className="item-form-section-label">Preview</div>
          <div className="item-preview-card">
            <div className="item-preview-thumb">
              {form.image_url ? <img src={form.image_url} alt="" /> : <HiPhoto />}
            </div>
            <div className="vendor-item-title-row">
              <b>{form.name || "Item name"}</b>
              <span className="vendor-item-price">₹{form.price || 0}</span>
            </div>
            <div className="vendor-item-meta" style={{ marginTop: 6 }}>
              <span className={`veg-dot${form.is_vegetarian ? "" : " non-veg"}`} />
              {categoryName || "Uncategorised"}
            </div>
            <small>{form.description || "No description yet."}</small>
            <small>{form.preparation_time_min || 10} min prep · {form.available ? "Available" : "Unavailable"} to students</small>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================
   PRINT SHOP PRICING
========================================================= */

const RATE_LABELS = { black_white: "Black & White (per page)", colour: "Colour (per page)" };

function PrintPricingManager({ rates, notify, onChanged }) {
  const [tab, setTab] = useState("jobs");

  return (
    <section className="page-section admin-cms">
      <div className="section-head">
        <div>
          <span className="section-kicker">VENDOR DASHBOARD</span>
          <h1>Print Shop</h1>
          <p>Manage the print queue and the per-page price quoted on upload.</p>
        </div>
      </div>

      <div className="socialize-filter-row">
        <button className={tab === "jobs" ? "chip active" : "chip"} onClick={() => setTab("jobs")}>Print Queue</button>
        <button className={tab === "pricing" ? "chip active" : "chip"} onClick={() => setTab("pricing")}>Pricing</button>
        <button className={tab === "analytics" ? "chip active" : "chip"} onClick={() => setTab("analytics")}>Analytics</button>
      </div>

      {tab === "jobs" && <PrintJobQueue notify={notify} />}

      {tab === "analytics" && <VendorAnalytics />}

      {tab === "pricing" && (
        <div className="resource-list">
          {rates.map((rate) => (
            <PrintRateRow key={rate.id} rate={rate} notify={notify} onChanged={onChanged} />
          ))}
        </div>
      )}
    </section>
  );
}

const PRINT_NEXT_STEP = {
  UPLOADED: { label: "Start processing", to: "PROCESSING" },
  PROCESSING: { label: "Queue for printing", to: "QUEUED" },
  QUEUED: { label: "Start printing", to: "PRINTING" },
  PRINTING: { label: "Mark ready", to: "READY" },
  READY: { label: "Mark collected", to: "COLLECTED" },
};

function PrintJobQueue({ notify }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setError("");
      setJobs(await vendorApi.listActivePrintJobs());
    } catch (err) {
      setError(err.message || "Could not load print jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    const unsubscribe = vendorApi.subscribeToPrintJobs(reload);
    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (job, status) => {
    try {
      setBusyId(job.id);
      await vendorApi.setPrintJobStatus(job.id, status);
      notify(`Job ${job.file_name} → ${status}`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this job");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading print queue…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      {jobs.length === 0 && <EmptyState icon={<HiPrinter />} title="No active jobs" text="New uploads will appear here." />}
      {jobs.map((job) => {
        const next = PRINT_NEXT_STEP[job.status];
        return (
          <article className="resource-row" key={job.id}>
            <div>
              <b>{job.file_name} · {job.status}</b>
              <small>
                {job.profiles?.name || "Student"} · {job.pages}pg × {job.copies} · {job.color_mode === "colour" ? "Colour" : "B&W"} ·{" "}
                {job.binding !== "none" ? job.binding : "No binding"} · Pickup {job.pickup_code}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {next && (
                <button className="primary" disabled={busyId === job.id} onClick={() => act(job, next.to)}>{next.label}</button>
              )}
              <button disabled={busyId === job.id} onClick={() => act(job, "FAILED")}>Mark failed</button>
            </div>
          </article>
        );
      })}
    </div>
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
