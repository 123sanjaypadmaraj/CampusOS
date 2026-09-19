import React, { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { addonSelectionKey, isCanteenOpenNow, isFoodItemAvailableNow } from "../../utils/mvpHelpers";
import { HiArrowRight, HiBolt, HiFire, HiHome, HiMagnifyingGlass, HiMagnifyingGlassCircle, HiPlus, HiShoppingBag, HiShoppingCart, HiXMark } from "react-icons/hi2";
import { PageHeader } from "../../components/ui/Shell";

function Food({ canteens: vendorList, items, cart, addFood, openModal, loading, error }) {
  const [selectedCanteen, setSelectedCanteen] = useState("All");
  const [q, setQ] = useState("");
  const [dietFilters, setDietFilters] = useState(() => new Set());

  const dietaryOptions = useMemo(() => {
    const tags = new Set(["Vegetarian"]);
    items.forEach((item) => (item.dietaryTags || []).forEach((t) => tags.add(t)));
    return [...tags];
  }, [items]);

  const toggleDietFilter = (tag) => {
    setDietFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  if (loading) {
    return (
      <section className="page-section food-page">
        <LoadingState label="Loading today's menu…" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="page-section food-page">
        <ErrorState title="Couldn't load the food menu" text={error} onRetry={() => window.location.reload()} />
      </section>
    );
  }

  /* Filter food by selected canteen + search */
  const filtered = items.filter((item) => {
    const matchesCanteen =
      selectedCanteen === "All" ||
      item.category.toLowerCase() === selectedCanteen.toLowerCase();

    const matchesSearch =
      `${item.name} ${item.category} ${item.description || ""}`
        .toLowerCase()
        .includes(q.toLowerCase());

    const matchesDiet = [...dietFilters].every((tag) =>
      tag === "Vegetarian" ? item.vegetarian : (item.dietaryTags || []).includes(tag)
    );

    return matchesCanteen && matchesSearch && matchesDiet;
  });

  const total = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );
  const itemCount = cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  return (
    <section className="page-section food-page">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <PageHeader
        kicker="CAMPUS FOOD"
        title="Food Hub"
        text="Four canteens, one campus checkout."
        action={
          <button
            className="primary"
            onClick={() => openModal("food-cart")}
          >
            <HiShoppingCart />
            Cart ({itemCount})
          </button>
        }
      />


      {/* =====================================================
          CANTEEN TOGGLE
      ===================================================== */}

      <div className="food-canteen-toggle">

        <button
          className={`canteen-toggle-btn ${
            selectedCanteen === "All" ? "active" : ""
          }`}
          onClick={() => setSelectedCanteen("All")}
        >
          <span className="canteen-toggle-icon">
            <HiShoppingBag />
          </span>

          <span className="canteen-toggle-info">
            <b>All</b>
            <small>All canteens</small>
          </span>
        </button>


        {vendorList.map((canteen) => (
          <button
            key={canteen.id}
            className={`canteen-toggle-btn ${
              selectedCanteen === canteen.name ? "active" : ""
            }`}
            onClick={() => setSelectedCanteen(canteen.name)}
          >

            <span className={`canteen-toggle-icon ${canteen.color}`}>
              {canteen.name === "Udupi" && <HiHome />}
              {canteen.name === "Tango" && <HiFire />}
              {canteen.name === "Munch" && <HiShoppingBag />}
              {canteen.name === "Nescafe" && <HiBolt />}
            </span>

            <span className="canteen-toggle-info">
              <b>{canteen.name}</b>
              <small>{canteen.subtitle}</small>
            </span>

            <span className="canteen-toggle-status">
              <i className={canteen.color}></i>
              {canteen.eta}
            </span>

          </button>
        ))}

      </div>


      {/* =====================================================
          ACTIVE CANTEEN INFORMATION
      ===================================================== */}

      {selectedCanteen !== "All" && (
        <div className="active-canteen-banner">

          <div className="active-canteen-left">

            <span className="active-canteen-icon">
              <HiShoppingBag />
            </span>

            <div>
              <span className="section-kicker">
                SELECTED CANTEEN
              </span>

              <h3>
                {selectedCanteen}
              </h3>

              <p>
                {
                  vendorList.find(
                    (canteen) =>
                      canteen.name === selectedCanteen
                  )?.subtitle
                }
              </p>
            </div>

          </div>


          <div className="active-canteen-right">

            <span>
              <i></i>

              {
                vendorList.find(
                  (canteen) =>
                    canteen.name === selectedCanteen
                )?.status
              }
            </span>

            {!isCanteenOpenNow(vendorList.find((canteen) => canteen.name === selectedCanteen)) && (
              <span className="listing-tag" style={{ fontWeight: 800 }}>Closed now</span>
            )}

            <b>
              {
                vendorList.find(
                  (canteen) =>
                    canteen.name === selectedCanteen
                )?.eta
              }
            </b>

          </div>

        </div>
      )}


      {/* =====================================================
          SEARCH
      ===================================================== */}

      <div className="searchbar compact wide-search">

        <HiMagnifyingGlass />

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search dosa, biryani, Maggi, coffee..."
          aria-label="Search food items"
        />

        {q && (
          <button
            className="search-clear"
            onClick={() => setQ("")}
            aria-label="Clear search"
          >
            <HiXMark />
          </button>
        )}

      </div>


      {/* =====================================================
          DIETARY FILTERS
      ===================================================== */}

      <div className="socialize-filter-row" style={{ marginTop: 12 }}>
        {dietaryOptions.map((tag) => (
          <button
            key={tag}
            className={dietFilters.has(tag) ? "chip active" : "chip"}
            onClick={() => toggleDietFilter(tag)}
          >
            {tag}
          </button>
        ))}
      </div>


      {/* =====================================================
          MENU TITLE
      ===================================================== */}

      <div className="food-menu-heading">

        <div>
          <span className="section-kicker">
            {selectedCanteen === "All"
              ? "CAMPUS MENU"
              : `${selectedCanteen.toUpperCase()} MENU`}
          </span>

          <h2>
            {selectedCanteen === "All"
              ? "Today's Menu"
              : `${selectedCanteen} Menu`}
          </h2>

          <p>
            {filtered.length} items available
          </p>
        </div>

        <div className="food-menu-count">
          {filtered.length}
          <small>items</small>
        </div>

      </div>


      {/* =====================================================
          MENU
      ===================================================== */}

      <div className="product-grid food-product-grid">

        {filtered.length === 0 && (
          <EmptyState
            title="No items match"
            text={q ? `Nothing matched "${q}" in ${selectedCanteen === "All" ? "any canteen" : selectedCanteen}.` : "This canteen has nothing available right now."}
          />
        )}

        {filtered.map((item) => (
          <FoodCard
            key={item.id}
            item={item}
            add={addFood}
          />
        ))}

      </div>


      {/* =====================================================
          EMPTY RESULT
      ===================================================== */}

      {filtered.length === 0 && (
        <div className="empty-food-results">

          <HiMagnifyingGlassCircle />

          <h3>No food found</h3>

          <p>
            Try another dish or switch to a different canteen.
          </p>

          <button
            className="ghost"
            onClick={() => {
              setSelectedCanteen("All");
              setQ("");
            }}
          >
            Show all food
          </button>

        </div>
      )}


      {/* =====================================================
          FLOATING CART
      ===================================================== */}

      {cart.length > 0 && (

        <div className="floating-cart">

          <div>

            <HiShoppingCart />

            <b>
              {cart.length} items
            </b>

            <span>
              ₹{total}
            </span>

          </div>

          <button
            onClick={() => openModal("food-cart")}
          >
            Checkout
            <HiArrowRight />
          </button>

        </div>

      )}

    </section>
  );
}

function FoodCard({ item, add }) {
  const variants = item.variants || [];
  const hasVariants = variants.length > 0;
  const [variantId, setVariantId] = useState(hasVariants ? variants[0].id : null);
  const selectedVariant = hasVariants ? variants.find((v) => v.id === variantId) || variants[0] : null;

  const addonGroups = item.addonGroups || [];
  const hasAddons = addonGroups.length > 0;
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState(() => new Set());

  const toggleAddon = (group, optionId) => {
    setSelectedAddons((prev) => {
      const next = new Set(prev);
      const groupOptionIds = group.options.map((o) => o.id);
      if (group.maxSelect === 1) {
        // Radio-style: clear any other selection from this same group first.
        groupOptionIds.forEach((id) => next.delete(id));
        next.add(optionId);
        return next;
      }
      if (next.has(optionId)) {
        next.delete(optionId);
        return next;
      }
      const currentInGroup = groupOptionIds.filter((id) => next.has(id)).length;
      if (currentInGroup >= group.maxSelect) return prev; // at the cap, ignore
      next.add(optionId);
      return next;
    });
  };

  const addonIds = [...selectedAddons];
  const addonPriceTotal = addonGroups
    .flatMap((g) => g.options)
    .filter((o) => selectedAddons.has(o.id))
    .reduce((sum, o) => sum + o.priceDelta, 0);
  const unmetRequiredGroup = addonGroups.find(
    (g) => g.minSelect > 0 && g.options.filter((o) => selectedAddons.has(o.id)).length < g.minSelect
  );

  const availableNow = isFoodItemAvailableNow(item);
  const basePrice = selectedVariant ? selectedVariant.price : item.price;
  const totalPrice = basePrice + addonPriceTotal;
  const canAdd = availableNow && (!hasVariants || (selectedVariant && selectedVariant.available)) && !unmetRequiredGroup;

  const handleAdd = () => {
    const variantSuffix = hasVariants ? ` (${selectedVariant.name})` : "";
    const addonNames = addonGroups
      .flatMap((g) => g.options)
      .filter((o) => selectedAddons.has(o.id))
      .map((o) => o.name);
    add({
      id: item.id,
      name: `${item.name}${variantSuffix}`,
      price: totalPrice,
      category: item.category,
      canteenId: item.canteenId,
      vendor: item.vendor,
      variantId: hasVariants ? selectedVariant.id : undefined,
      addonOptionIds: addonIds.length ? addonIds : undefined,
      addonKey: addonSelectionKey(addonIds),
      addonSummary: addonNames.length ? addonNames.join(", ") : undefined,
    });
    setCustomizeOpen(false);
  };

  return (
    <article className="product-card food-card">

      <div className="food-image-wrap">
        <img
          src={item.image}
          alt={item.name}
          loading="lazy"
        />
      </div>

      <div className="food-card-content">

        <div className="food-card-category">
          {item.category}
          {!availableNow && <span className="listing-tag" style={{ marginLeft: 8 }}>Not served now</span>}
        </div>

        <h3>{item.name}</h3>

        <p>
          {item.description || "Freshly prepared on campus."}
        </p>

        {(item.dietaryTags?.length > 0 || item.spiceLevel || item.calories != null) && (
          <div className="food-card-dietary" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {item.dietaryTags.map((tag) => (
              <span key={tag} className="listing-tag">{tag}</span>
            ))}
            {item.spiceLevel && <span className="listing-tag">{item.spiceLevel} spice</span>}
            {item.calories != null && <span className="listing-tag">{item.calories} cal</span>}
          </div>
        )}
        {item.allergens?.length > 0 && (
          <small style={{ display: "block", marginBottom: 8, opacity: 0.75 }}>
            Contains: {item.allergens.join(", ")}
          </small>
        )}

        {hasVariants && (
          <select value={selectedVariant.id} onChange={(e) => setVariantId(e.target.value)} aria-label={`Choose variant for ${item.name}`} style={{ marginBottom: 8, width: "100%" }}>
            {variants.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.available}>
                {v.name} · ₹{v.price}{!v.available ? " · unavailable" : ""}
              </option>
            ))}
          </select>
        )}

        {hasAddons && (
          <div style={{ marginBottom: 8 }}>
            <button className="ghost" style={{ width: "100%" }} onClick={() => setCustomizeOpen((v) => !v)}>
              {customizeOpen ? "Hide customization" : "Customize"} {addonIds.length > 0 ? `(${addonIds.length} selected)` : ""}
            </button>
            {customizeOpen && (
              <div className="food-addon-panel" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                {addonGroups.map((group) => (
                  <div key={group.id}>
                    <small>
                      <b>{group.name}</b>
                      {" "}
                      {group.minSelect > 0 ? `(choose ${group.minSelect === group.maxSelect ? group.minSelect : `${group.minSelect}-${group.maxSelect}`})` : `(choose up to ${group.maxSelect})`}
                    </small>
                    {group.options.map((o) => (
                      <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                        <input
                          type={group.maxSelect === 1 ? "radio" : "checkbox"}
                          name={`addon-group-${group.id}`}
                          disabled={!o.available}
                          checked={selectedAddons.has(o.id)}
                          onChange={() => toggleAddon(group, o.id)}
                        />
                        {o.name}{o.priceDelta > 0 ? ` (+₹${o.priceDelta})` : ""}{!o.available ? " · unavailable" : ""}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="product-bottom">

          <b>₹{totalPrice}</b>

          <button
            disabled={!canAdd}
            onClick={handleAdd}
          >
            <HiPlus />
            {!availableNow ? "Not served now" : unmetRequiredGroup ? `Pick ${unmetRequiredGroup.name}` : "Add"}
          </button>

        </div>

      </div>

    </article>
  );
}

export { Food, FoodCard };
