import React, { useEffect, useId, useState } from "react";
import { HiPlus, HiXMark, HiPencil, HiTrash, HiCheck, HiClock, HiShoppingBag, HiExclamationTriangle, HiBanknotes } from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import VendorAnalytics from "../vendor/Analytics";
import VendorManagerAccounts from "../vendor/ManagerAccounts";
import { useModalA11y } from "../../hooks/useModalA11y";
import * as storeApi from "./api";

function Modal({ title, kicker, onClose, children }) {
  const titleId = useId();
  const dialogRef = useModalA11y(onClose);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><HiXMark /></button>
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

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

const CATEGORIES = ["Stationery", "Books", "Electronics", "Merch", "Printing Supplies", "General"];
const NEXT_STEP = {
  PLACED: { label: "Pack it", to: "PACKED" },
  PACKED: { label: "Mark ready", to: "READY" },
};

// null when the item doesn't track stock -- matches food_items'
// stockLabel() convention exactly (see src/features/vendor/VendorDashboard.jsx).
function stockLabel(entity) {
  if (!entity.track_stock || entity.stock_quantity == null) return null;
  if (entity.stock_quantity <= 0) return { text: "Out of stock", cls: "out-of-stock" };
  if (entity.stock_quantity <= (entity.low_stock_threshold ?? 5)) return { text: `Low stock: ${entity.stock_quantity}`, cls: "low-stock" };
  return { text: `Stock: ${entity.stock_quantity}`, cls: "in-stock" };
}

export default function StoreDashboard({ notify, authUser }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [store, setStore] = useState(null);
  const [tab, setTab] = useState("orders");

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setStore(await storeApi.getMyStore(authUser.id));
    } catch (err) {
      setError(err.message || "Could not load your store");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading your store…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;
  if (!store) {
    return (
      <section className="page-section admin-cms">
        <EmptyState title="No store assigned yet" text="This account isn't linked to a Campus Store shop. Ask a campus admin to assign it." />
      </section>
    );
  }

  return (
    <section className="page-section admin-cms">
      <div className="section-head">
        <div>
          <span className="section-kicker">CAMPUS STORE · {store.category.toUpperCase()}</span>
          <h1>{store.name}</h1>
          <p>Manage what you sell and work through incoming orders.</p>
        </div>
      </div>

      <div className="socialize-filter-row">
        <button className={tab === "orders" ? "chip active" : "chip"} onClick={() => setTab("orders")}>Orders</button>
        <button className={tab === "items" ? "chip active" : "chip"} onClick={() => setTab("items")}>Items</button>
        <button className={tab === "billing" ? "chip active" : "chip"} onClick={() => setTab("billing")}>Billing</button>
        <button className={tab === "analytics" ? "chip active" : "chip"} onClick={() => setTab("analytics")}>Analytics</button>
        <button className={tab === "staff" ? "chip active" : "chip"} onClick={() => setTab("staff")}>Managers</button>
      </div>

      {tab === "orders" && <StoreOrderQueue store={store} notify={notify} />}
      {tab === "items" && <StoreItemManager store={store} notify={notify} />}
      {tab === "billing" && <StoreBillingPanel store={store} notify={notify} onStoreChanged={reload} />}
      {tab === "analytics" && <VendorAnalytics />}
      {tab === "staff" && <VendorManagerAccounts vendorType="store" scopeId={store.id} notify={notify} />}
    </section>
  );
}

/* =========================================================
   BILLING: GST configuration + settlement report (doc phase 04's
   engineering-doable subset -- "extend Campus Store to the same
   settlement/invoice depth Food already has", see
   supabase/migrations/20260824000600_campus_store_gst_invoices_settlement.sql).
   Mirrors src/features/vendor/VendorDashboard.jsx's BillingPanel, minus a
   payout-history section: Store is pay-at-pickup, so there's no platform-
   held money for a payout to release, only a sales report for the vendor's
   own bookkeeping.
========================================================= */

function StoreBillingPanel({ store, notify, onStoreChanged }) {
  const [gstRegistered, setGstRegistered] = useState(Boolean(store.gst_registered));
  const [gstNumber, setGstNumber] = useState(store.gst_number || "");
  const [savingGst, setSavingGst] = useState(false);

  const [range, setRange] = useState(() => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    return { start, end };
  });
  const [settlement, setSettlement] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      setLoading(true);
      setSettlement(await storeApi.getStoreSettlementReport(range.start, range.end));
    } catch (err) { notify(err.message || "Could not load billing data"); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [store.id, range.start, range.end]); // eslint-disable-line react-hooks/exhaustive-deps

  const settlementTotal = settlement.reduce((sum, r) => sum + Number(r.net_amount || 0), 0);

  return (
    <div>
      <div className="section-head"><h2>GST configuration</h2></div>
      <div className="form-grid" style={{ maxWidth: 420 }}>
        <ToggleSwitch label="GST registered" checked={gstRegistered} onChange={setGstRegistered} />
        {gstRegistered && (
          <label>GSTIN<input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="29ABCDE1234F1Z5" /></label>
        )}
      </div>
      <button
        className="ghost"
        disabled={savingGst}
        onClick={async () => {
          try {
            setSavingGst(true);
            await storeApi.updateStoreGst(store.id, { gstRegistered, gstNumber });
            notify("GST settings saved");
            onStoreChanged?.();
          } catch (err) { notify(err.message || "Could not save GST settings"); } finally { setSavingGst(false); }
        }}
      >
        Save GST settings
      </button>

      <div className="section-head" style={{ marginTop: 24 }}>
        <h2>Settlement report</h2>
      </div>
      <div className="form-grid" style={{ maxWidth: 420 }}>
        <label>From<input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} /></label>
        <label>To<input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} /></label>
      </div>

      {loading ? <LoadingState label="Loading…" /> : (
        <>
          <div className="resource-row" style={{ marginTop: 12 }}>
            <div><b>Net for this period</b><small>{settlement.length} completed order{settlement.length === 1 ? "" : "s"}</small></div>
            <strong>₹{settlementTotal.toFixed(2)}</strong>
          </div>
          <div className="resource-list">
            {settlement.length === 0 && <EmptyState title="No completed sales yet" text="Orders show up here once a student has picked them up." />}
            {settlement.map((row, i) => (
              <article className="resource-row" key={`${row.order_id}-${i}`}>
                <div className="resource-icon"><HiBanknotes /></div>
                <div><b>{row.description}</b><small>{row.occurred_on}</small></div>
                <strong>₹{Number(row.net_amount).toFixed(2)}</strong>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StoreItemManager({ store, notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [itemModal, setItemModal] = useState(null);
  const [variantsFor, setVariantsFor] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all"); // all | low_stock | out_of_stock

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setItems(await storeApi.listMyStoreItems(store.id));
    } catch (err) {
      setError(err.message || "Could not load items");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [store.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (item) => {
    try {
      const result = await storeApi.deleteStoreItem(item.id);
      notify(result.hardDeleted ? `${item.name} deleted` : `${item.name} has order history -- archived instead`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not delete item");
    }
  };

  const toggleAvailable = async (item) => {
    try {
      await storeApi.upsertStoreItem({ id: item.id, store_id: store.id, name: item.name, price: item.price, available: !item.available });
      await reload();
    } catch (err) {
      notify(err.message || "Could not update item");
    }
  };

  if (loading) return <LoadingState label="Loading items…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const lowStockItems = items.filter((i) => i.active && i.track_stock && i.stock_quantity != null && i.stock_quantity > 0 && i.stock_quantity <= (i.low_stock_threshold ?? 5));
  const outOfStockItems = items.filter((i) => i.active && i.track_stock && i.stock_quantity != null && i.stock_quantity <= 0);

  const visible = items.filter((item) => {
    if (statusFilter === "low_stock") return lowStockItems.includes(item);
    if (statusFilter === "out_of_stock") return outOfStockItems.includes(item);
    return true;
  });

  return (
    <div>
      {(lowStockItems.length > 0 || outOfStockItems.length > 0) && (
        <div className="stock-alert-banner" style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <HiExclamationTriangle />
          <span>
            {outOfStockItems.length > 0 && <><b>{outOfStockItems.length}</b> item{outOfStockItems.length === 1 ? "" : "s"} out of stock</>}
            {outOfStockItems.length > 0 && lowStockItems.length > 0 ? " · " : ""}
            {lowStockItems.length > 0 && <><b>{lowStockItems.length}</b> item{lowStockItems.length === 1 ? "" : "s"} running low</>}
          </span>
          {lowStockItems.length > 0 && <button onClick={() => setStatusFilter("low_stock")}>View low stock</button>}
          {outOfStockItems.length > 0 && <button onClick={() => setStatusFilter("out_of_stock")}>View out of stock</button>}
          {statusFilter !== "all" && <button onClick={() => setStatusFilter("all")}>Clear filter</button>}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="primary" onClick={() => setItemModal({})}><HiPlus /> Add item</button>
      </div>

      <div className="resource-list">
        {visible.length === 0 && (
          <EmptyState icon={<HiShoppingBag />} title="No items yet" text="Add what your store sells so students can order it." />
        )}
        {visible.map((item) => {
          const stock = stockLabel(item);
          return (
            <article className="resource-row" key={item.id} style={{ opacity: item.active ? 1 : 0.55 }}>
              <div>
                <b>{item.name} · ₹{item.price}</b>
                <small>{item.category || "Uncategorized"} · {item.active ? (item.available ? "Available" : "Unavailable") : "Archived"}{stock ? ` · ${stock.text}` : ""}</small>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {item.active && (
                  <button onClick={() => toggleAvailable(item)}>
                    {item.available ? "Mark out of stock" : "Mark in stock"}
                  </button>
                )}
                <button onClick={() => setVariantsFor(item)}>Variants</button>
                <button onClick={() => setItemModal(item)} aria-label={`Edit ${item.name}`}><HiPencil /></button>
                <button onClick={() => remove(item)} aria-label={`Delete ${item.name}`}><HiTrash /></button>
              </div>
            </article>
          );
        })}
      </div>

      {itemModal && (
        <StoreItemForm
          item={itemModal}
          storeId={store.id}
          onClose={() => setItemModal(null)}
          onSaved={() => { setItemModal(null); reload(); }}
          notify={notify}
        />
      )}

      {variantsFor && (
        <VariantManager
          item={variantsFor}
          onClose={() => setVariantsFor(null)}
          notify={notify}
        />
      )}
    </div>
  );
}

function StoreItemForm({ item, storeId, onClose, onSaved, notify }) {
  const isNew = !item.id;
  const [form, setForm] = useState({
    name: item.name || "",
    description: item.description || "",
    price: item.price ?? "",
    category: item.category || CATEGORIES[0],
    sku: item.sku || "",
    image_url: item.image_url || "",
    track_stock: Boolean(item.track_stock),
    stock_quantity: item.stock_quantity ?? "",
    low_stock_threshold: item.low_stock_threshold ?? 5,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim() || Number(form.price) < 0) return;
    try {
      setSaving(true);
      await storeApi.upsertStoreItem({
        ...(isNew ? {} : { id: item.id }),
        store_id: storeId,
        name: form.name.trim(),
        description: form.description,
        price: Number(form.price),
        category: form.category,
        sku: form.sku || null,
        image_url: form.image_url || null,
        track_stock: form.track_stock,
        stock_quantity: form.track_stock && form.stock_quantity !== "" ? Number(form.stock_quantity) : null,
        low_stock_threshold: Number(form.low_stock_threshold) || 5,
      });
      notify(isNew ? "Item added" : "Item updated");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not save item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="STORE ITEM" title={isNew ? "Add item" : "Edit item"} onClose={onClose}>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>Description<textarea rows={2} value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Category
        <select value={form.category} onChange={(e) => change("category", e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Price (₹)<input type="number" min="0" value={form.price} onChange={(e) => change("price", e.target.value)} /></label>
      <label>Image URL (optional)<input value={form.image_url} onChange={(e) => change("image_url", e.target.value)} placeholder="https://…" /></label>
      <label>SKU (optional)<input value={form.sku} onChange={(e) => change("sku", e.target.value)} /></label>

      <div className="item-form-section-label">Inventory</div>
      <ToggleSwitch label="Track stock" checked={form.track_stock} onChange={(v) => change("track_stock", v)} />
      {form.track_stock && (
        <div className="form-grid">
          <label>Stock quantity
            <input type="number" min="0" value={form.stock_quantity} onChange={(e) => change("stock_quantity", e.target.value)} placeholder="e.g. 20" />
          </label>
          <label>Low stock alert below
            <input type="number" min="0" value={form.low_stock_threshold} onChange={(e) => change("low_stock_threshold", e.target.value)} />
          </label>
        </div>
      )}

      <button className="primary wide" disabled={saving || !form.name.trim() || Number(form.price) < 0} onClick={save}>
        {saving ? "Saving…" : isNew ? "Add item" : "Save changes"}
      </button>
    </Modal>
  );
}

// Product variants (size/colour/etc) for a single item -- each carries its
// own price and, optionally, its own stock. Deleting a variant is always a
// real delete (see api.js's comment on deleteStoreItemVariant for why
// that's safe here, unlike items).
function VariantManager({ item, onClose, notify }) {
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setVariants(await storeApi.listStoreItemVariants(item.id));
    } catch (err) {
      setError(err.message || "Could not load variants");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAvailable = async (variant) => {
    try {
      await storeApi.upsertStoreItemVariant({ id: variant.id, store_item_id: item.id, name: variant.name, price: variant.price, available: !variant.available });
      await reload();
    } catch (err) {
      notify(err.message || "Could not update option");
    }
  };

  const remove = async (variant) => {
    try {
      await storeApi.deleteStoreItemVariant(variant.id);
      notify(`${variant.name} removed`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not delete option");
    }
  };

  return (
    <Modal kicker={`VARIANTS · ${item.name}`} title="Manage options" onClose={onClose}>
      {loading ? (
        <LoadingState label="Loading options…" />
      ) : error ? (
        <ErrorState text={error} onRetry={reload} />
      ) : (
        <div className="resource-list">
          {variants.length === 0 && (
            <EmptyState title="No options yet" text="Add a size, colour, or other option -- students pick one when ordering." />
          )}
          {variants.map((v) => {
            const stock = stockLabel(v);
            return (
              <article className="resource-row" key={v.id}>
                <div>
                  <b>{v.name} · ₹{v.price}</b>
                  <small>{v.available ? "Available" : "Unavailable"}{stock ? ` · ${stock.text}` : ""}</small>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => toggleAvailable(v)}>{v.available ? "Mark out of stock" : "Mark in stock"}</button>
                  <button onClick={() => setForm(v)} aria-label={`Edit ${v.name}`}><HiPencil /></button>
                  <button onClick={() => remove(v)} aria-label={`Delete ${v.name}`}><HiTrash /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <button className="primary wide" style={{ marginTop: 16 }} onClick={() => setForm({})}>
        <HiPlus /> Add option
      </button>

      {form && (
        <VariantForm
          variant={form}
          storeItemId={item.id}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); reload(); }}
          notify={notify}
        />
      )}
    </Modal>
  );
}

function VariantForm({ variant, storeItemId, onClose, onSaved, notify }) {
  const isNew = !variant.id;
  const [form, setForm] = useState({
    name: variant.name || "",
    price: variant.price ?? "",
    sku: variant.sku || "",
    track_stock: Boolean(variant.track_stock),
    stock_quantity: variant.stock_quantity ?? "",
    low_stock_threshold: variant.low_stock_threshold ?? 5,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim() || Number(form.price) < 0) return;
    try {
      setSaving(true);
      await storeApi.upsertStoreItemVariant({
        ...(isNew ? {} : { id: variant.id }),
        store_item_id: storeItemId,
        name: form.name.trim(),
        price: Number(form.price),
        sku: form.sku || null,
        track_stock: form.track_stock,
        stock_quantity: form.track_stock && form.stock_quantity !== "" ? Number(form.stock_quantity) : null,
        low_stock_threshold: Number(form.low_stock_threshold) || 5,
      });
      notify(isNew ? "Option added" : "Option updated");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not save option");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="OPTION" title={isNew ? "Add option" : "Edit option"} onClose={onClose}>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} placeholder="e.g. Medium, Red, 500ml" /></label>
      <label>Price (₹)<input type="number" min="0" value={form.price} onChange={(e) => change("price", e.target.value)} /></label>
      <label>SKU (optional)<input value={form.sku} onChange={(e) => change("sku", e.target.value)} /></label>

      <div className="item-form-section-label">Inventory</div>
      <ToggleSwitch label="Track stock" checked={form.track_stock} onChange={(v) => change("track_stock", v)} />
      {form.track_stock && (
        <div className="form-grid">
          <label>Stock quantity
            <input type="number" min="0" value={form.stock_quantity} onChange={(e) => change("stock_quantity", e.target.value)} placeholder="e.g. 20" />
          </label>
          <label>Low stock alert below
            <input type="number" min="0" value={form.low_stock_threshold} onChange={(e) => change("low_stock_threshold", e.target.value)} />
          </label>
        </div>
      )}

      <button className="primary wide" disabled={saving || !form.name.trim() || Number(form.price) < 0} onClick={save}>
        {saving ? "Saving…" : isNew ? "Add option" : "Save changes"}
      </button>
    </Modal>
  );
}

function StoreOrderQueue({ store, notify }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [pickupOrder, setPickupOrder] = useState(null);

  const reload = async () => {
    try {
      setError("");
      setOrders(await storeApi.listStoreOrders(store.id));
    } catch (err) {
      setError(err.message || "Could not load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [store.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (order, toStatus) => {
    try {
      setBusyId(order.id);
      await storeApi.transitionStoreOrderStatus(order.id, toStatus);
      notify(`Order #${order.id.slice(0, 8)} → ${toStatus}`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not update order");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading orders…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const active = orders.filter((o) => !["COMPLETED", "CANCELLED"].includes(o.status));

  return (
    <div className="resource-list">
      {active.length === 0 && (
        <EmptyState icon={<HiClock />} title="No active orders" text="New orders will appear here the moment a student places one." />
      )}
      {active.map((order) => {
        const next = NEXT_STEP[order.status];
        return (
          <article className="resource-row" key={order.id} style={{ alignItems: "flex-start" }}>
            <div>
              <b>#{order.id.slice(0, 8)} · {order.status}</b>
              <small>
                {order.profiles?.name || "Student"} · {order.store_order_items.map((i) => `${i.quantity}× ${i.item_name}`).join(", ")} · ₹{order.total}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {next && (
                <button className="primary" disabled={busyId === order.id} onClick={() => act(order, next.to)}>
                  <HiCheck /> {next.label}
                </button>
              )}
              {order.status === "READY" && (
                <button className="primary" disabled={busyId === order.id} onClick={() => setPickupOrder(order)}>
                  Complete pickup
                </button>
              )}
              {order.status === "CANCEL_REQUESTED" && (
                <>
                  <button disabled={busyId === order.id} onClick={() => act(order, "CANCELLED")}>Confirm cancel</button>
                  <button disabled={busyId === order.id} onClick={() => act(order, "PACKED")}>Resume packing</button>
                </>
              )}
            </div>
          </article>
        );
      })}

      {pickupOrder && (
        <Modal kicker="PICKUP" title={`Complete order #${pickupOrder.id.slice(0, 8)}`} onClose={() => setPickupOrder(null)}>
          <PickupConfirm order={pickupOrder} onDone={async () => { setPickupOrder(null); await act(pickupOrder, "COMPLETED"); }} notify={notify} />
        </Modal>
      )}
    </div>
  );
}

function PickupConfirm({ order, onDone, notify }) {
  const [code, setCode] = useState("");
  return (
    <>
      <p>Ask the student for their 6-digit pickup code and enter it below.</p>
      <label>
        Pickup code
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6} autoFocus />
      </label>
      <button
        className="primary wide"
        disabled={code.trim().length !== 6}
        onClick={() => {
          if (code.trim() !== order.pickup_code) {
            notify("That code doesn't match -- ask the student to read it again.");
            return;
          }
          onDone();
        }}
      >
        Complete pickup
      </button>
    </>
  );
}
