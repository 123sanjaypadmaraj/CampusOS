import React, { useEffect, useState } from "react";
import {
  HiXMark,
  HiPlus,
  HiPencilSquare,
  HiTrash,
  HiArchiveBoxArrowDown,
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
