import React, { useMemo, useState } from "react";
import { EmptyState, LoadingState } from "../../components/ui/States";
import { HiArrowRight, HiBookOpen, HiMagnifyingGlass, HiPlus, HiQrCode, HiShoppingCart } from "react-icons/hi2";
import { PageHeader } from "../../components/ui/Shell";

function Store({ items, loading, cart, addStore, openModal, orders = [] }) {
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(items.map((item) => item.category).filter(Boolean)))],
    [items]
  );

  const filtered = items.filter((item) => {
    if (categoryFilter !== "All" && item.category !== categoryFilter) return false;
    return `${item.name} ${item.category} ${item.storeName || ""}`.toLowerCase().includes(q.toLowerCase());
  });

  const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);
  const activeOrders = orders.filter((o) => !["COMPLETED", "CANCELLED"].includes(o.status));

  return (
    <section className="page-section">
      <PageHeader
        kicker="CAMPUS STORE"
        title="Stationery & Supplies"
        text="Everything you need for classes and projects."
        action={
          <button className="primary" onClick={() => openModal("store-cart")}>
            <HiShoppingCart /> Cart ({cart.length})
          </button>
        }
      />

      {activeOrders.length > 0 && (
        <div className="resource-list" style={{ marginBottom: 24 }}>
          {activeOrders.map((order) => (
            <article className="resource-row" key={order.id}>
              <div>
                <b>Order #{order.id.slice(0, 8)} · {order.status}</b>
                <small>
                  {order.stores?.name} · {order.store_order_items.map((i) => `${i.quantity}× ${i.item_name}`).join(", ")}
                </small>
              </div>
              <span className="listing-tag" style={{ fontWeight: 800 }}>Pickup code: {order.pickup_code}</span>
            </article>
          ))}
        </div>
      )}

      <div className="searchbar compact wide-search">
        <HiMagnifyingGlass />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stationery, books, records..."
          aria-label="Search store items"
        />
      </div>

      <div className="category-row">
        {categories.map((category) => (
          <button
            key={category}
            className={category === categoryFilter ? "active" : undefined}
            onClick={() => setCategoryFilter(category)}
          >
            {category}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading the campus store…" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<HiBookOpen />} title="Nothing here yet" text="No store items match your search." />
      ) : (
        <div className="product-grid">
          {filtered.map((item) => (
            <StoreProductCard key={item.id} item={item} addStore={addStore} />
          ))}
        </div>
      )}

      {cart.length > 0 && (
        <div className="floating-cart">
          <div>
            <HiShoppingCart />
            <b>{cart.length} items</b>
            <span>₹{total}</span>
          </div>
          <button onClick={() => openModal("store-cart")}>
            Checkout <HiArrowRight />
          </button>
        </div>
      )}

      <div className="store-banner">
        <div>
          <span className="section-kicker">QUICK PICKUP</span>
          <h2>Order before class. Collect between lectures.</h2>
          <p>Get a QR pickup code when your order is ready.</p>
        </div>
        <HiQrCode />
      </div>
    </section>
  );
}

function StoreProductCard({ item, addStore }) {
  const variants = useMemo(
    () => (item.store_item_variants || []).filter((v) => v.active).sort((a, b) => a.name.localeCompare(b.name)),
    [item.store_item_variants]
  );
  const hasVariants = variants.length > 0;
  const [variantId, setVariantId] = useState(hasVariants ? variants[0].id : null);
  const selectedVariant = hasVariants ? variants.find((v) => v.id === variantId) || variants[0] : null;
  const price = selectedVariant ? selectedVariant.price : item.price;
  const canAdd = !hasVariants || (selectedVariant && selectedVariant.available);

  return (
    <article className="product-card">
      <div className="product-placeholder">
        {item.image_url ? <img src={item.image_url} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <HiBookOpen />}
      </div>
      <span className="event-club">{item.category}</span>
      <h3>{item.name}</h3>
      <p>{item.storeName}</p>

      {hasVariants && (
        <select value={selectedVariant.id} onChange={(e) => setVariantId(e.target.value)} aria-label={`Choose variant for ${item.name}`} style={{ marginBottom: 8, width: "100%" }}>
          {variants.map((v) => (
            <option key={v.id} value={v.id} disabled={!v.available}>
              {v.name} · ₹{v.price}{!v.available ? " · out of stock" : ""}
            </option>
          ))}
        </select>
      )}

      <div className="product-bottom">
        <b>₹{price}</b>
        <button
          disabled={!canAdd}
          onClick={() => addStore({
            id: item.id,
            name: hasVariants ? `${item.name} (${selectedVariant.name})` : item.name,
            price,
            category: item.category,
            storeId: item.storeId,
            storeName: item.storeName,
            vendor: item.storeName,
            variantId: hasVariants ? selectedVariant.id : undefined,
          })}
        >
          <HiPlus /> {canAdd ? "Add" : "Out of stock"}
        </button>
      </div>
    </article>
  );
}

export { Store, StoreProductCard };
