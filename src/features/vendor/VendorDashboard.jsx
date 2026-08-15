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
  HiArrowDownTray,
  HiArrowUpTray,
  HiExclamationTriangle,
  HiCubeTransparent,
  HiFlag,
  HiUserGroup,
  HiChatBubbleLeftEllipsis,
  HiBanknotes,
  HiSpeakerWave,
  HiSpeakerXMark,
  HiArrowUturnLeft,
  HiFire,
  HiChartBar,
  HiCurrencyRupee,
  HiChevronRight,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as vendorApi from "./api";
import VendorAnalytics from "./Analytics";
import * as storeApi from "../store/api";
import StoreDashboard from "../store/StoreDashboard";

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
  const [hasStore, setHasStore] = useState(false);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const myCanteen = await vendorApi.getMyCanteen(authUser.id);
      if (myCanteen) {
        setCanteen(myCanteen);
        setPrintRates([]);
        setHasStore(false);
        return;
      }
      const rates = await vendorApi.getMyPrintRateCard(authUser.id);
      if (rates.length) {
        setCanteen(null);
        setPrintRates(rates);
        setHasStore(false);
        return;
      }
      const myStore = await storeApi.getMyStore(authUser.id);
      setCanteen(null);
      setPrintRates([]);
      setHasStore(!!myStore);
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

  if (hasStore) {
    return <StoreDashboard notify={notify} authUser={authUser} />;
  }

  return (
    <section className="page-section admin-cms">
      <EmptyState
        title="No vendor profile assigned yet"
        text="This account isn't linked to a canteen, the print shop, or a Campus Store shop. Ask a campus admin to assign it."
      />
    </section>
  );
}

/* =========================================================
   DASHBOARD OVERVIEW -- a real "how's today going" home screen (the vendor
   app now defaults here instead of landing straight in the orders queue,
   same idea as a Swiggy/Zomato partner app's home tab: today's numbers +
   one-tap shortcuts, not a bare list). Two variants -- canteen and print
   shop -- share the same stat-tile/quick-link markup but pull different
   numbers, so they're kept as separate small components rather than one
   prop-heavy do-it-all component.
========================================================= */

const money = (n) => `₹${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function QuickLinkCard({ icon, label, sub, onClick, ariaLabel }) {
  return (
    // Explicit aria-label -- the visible <b>{label}</b> text alone (e.g.
    // "Menu") would otherwise give this button the same accessible name as
    // the tab-switcher chip it navigates to, which is confusing for screen
    // readers and ambiguous for anything that queries by accessible name.
    <button className="vendor-quicklink-card" onClick={onClick} aria-label={ariaLabel}>
      <span className="vendor-quicklink-icon">{icon}</span>
      <span className="vendor-quicklink-text">
        <b>{label}</b>
        <small>{sub}</small>
      </span>
      <HiChevronRight className="vendor-quicklink-chevron" />
    </button>
  );
}

// A dashboard stat should read at a glance whether it's fine or needs
// attention -- a flat, one-color grid of numbers (the shared analytics
// StatTile, built for a trend-over-time view) doesn't carry that signal.
// 'tone' borrows the exact amber/red/green already used for stock-alert
// pills elsewhere in this file, so "everything's fine" vs. "look at this"
// reads the same way here as it does on the Menu tab.
function DashboardStatCard({ icon, label, value, sub, tone = "default" }) {
  return (
    <div className={`vendor-stat-card tone-${tone}`}>
      <span className="vendor-stat-icon">{icon}</span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

function CanteenOverview({ canteen, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setStats(await vendorApi.getCanteenDashboardStats(canteen.id));
    } catch (err) {
      setError(err.message || "Could not load your dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [canteen.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading your dashboard…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const stockAlertCount = stats.lowStockCount + stats.outOfStockCount;

  return (
    <div>
      <div className="vendor-dashboard-greeting">
        <h2>Today at {canteen.name}</h2>
        <p>Here&apos;s what&apos;s happening right now — jump into any section below.</p>
      </div>

      <div className="analytics-grid">
        <DashboardStatCard icon={<HiClock />} label="Orders today" value={stats.ordersToday} />
        <DashboardStatCard icon={<HiCurrencyRupee />} label="Revenue today" value={money(stats.revenueToday)} tone="good" />
        <DashboardStatCard
          icon={<HiExclamationTriangle />}
          label="Needs your action"
          value={stats.pendingCount}
          sub={stats.pendingCount > 0 ? "In the order queue" : "All caught up"}
          tone={stats.pendingCount > 0 ? "warning" : "good"}
        />
        <DashboardStatCard
          icon={<HiCubeTransparent />}
          label="Stock alerts"
          value={stockAlertCount}
          sub={stats.outOfStockCount > 0 ? `${stats.outOfStockCount} out of stock` : stats.lowStockCount > 0 ? `${stats.lowStockCount} running low` : "All stocked"}
          tone={stats.outOfStockCount > 0 ? "critical" : stats.lowStockCount > 0 ? "warning" : "good"}
        />
      </div>

      <div className="item-form-section-label">Quick actions</div>
      <div className="vendor-quicklink-grid">
        <QuickLinkCard icon={<HiClock />} label="Order queue" sub="Accept, prepare, complete pickups" ariaLabel="Jump to the order queue" onClick={() => onNavigate("orders")} />
        <QuickLinkCard icon={<HiPencilSquare />} label="Menu" sub="Items, pricing, stock, availability" ariaLabel="Edit items and stock" onClick={() => onNavigate("menu")} />
        <QuickLinkCard icon={<HiChartBar />} label="Analytics" sub="Revenue, orders, SLA over time" ariaLabel="View performance stats" onClick={() => onNavigate("analytics")} />
      </div>
    </div>
  );
}

function PrintShopOverview({ onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setStats(await vendorApi.getPrintShopDashboardStats());
    } catch (err) {
      setError(err.message || "Could not load your dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading your dashboard…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="vendor-dashboard-greeting">
        <h2>Today at the Print Shop</h2>
        <p>Here&apos;s what&apos;s happening right now — jump into any section below.</p>
      </div>

      <div className="analytics-grid">
        <DashboardStatCard icon={<HiPrinter />} label="Jobs today" value={stats.jobsToday} />
        <DashboardStatCard
          icon={<HiExclamationTriangle />}
          label="In progress"
          value={stats.activeCount}
          sub={stats.activeCount > 0 ? "In the print queue" : "All caught up"}
          tone={stats.activeCount > 0 ? "warning" : "good"}
        />
        <DashboardStatCard
          icon={<HiCheck />}
          label="Ready for pickup"
          value={stats.readyCount}
          tone={stats.readyCount > 0 ? "warning" : "good"}
        />
      </div>

      <div className="item-form-section-label">Quick actions</div>
      <div className="vendor-quicklink-grid">
        <QuickLinkCard icon={<HiPrinter />} label="Print queue" sub="Process and hand off jobs" ariaLabel="Process incoming jobs" onClick={() => onNavigate("jobs")} />
        <QuickLinkCard icon={<HiCurrencyRupee />} label="Pricing" sub="Black & white / colour rates" ariaLabel="Edit page rates" onClick={() => onNavigate("pricing")} />
        <QuickLinkCard icon={<HiChartBar />} label="Analytics" sub="Turnaround & SLA over time" ariaLabel="View performance stats" onClick={() => onNavigate("analytics")} />
      </div>
    </div>
  );
}

/* =========================================================
   CANTEEN MENU (Udupi / Tango / Munch / Nescafe)
========================================================= */

function CanteenMenuManager({ canteen, notify, onCanteenChanged }) {
  const [tab, setTab] = useState("dashboard");
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canteenModal, setCanteenModal] = useState(false);
  const [itemModal, setItemModal] = useState(null); // {} for new, {...item} to edit
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all"); // all | available | unavailable | archived | low_stock | out_of_stock
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importModal, setImportModal] = useState(false);

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

  const lowStockItems = useMemo(
    () => items.filter((i) => i.active && i.track_stock && i.stock_quantity != null && i.stock_quantity > 0 && i.stock_quantity <= (i.low_stock_threshold ?? 5)),
    [items]
  );
  const outOfStockItems = useMemo(
    () => items.filter((i) => i.active && i.track_stock && i.stock_quantity != null && i.stock_quantity <= 0),
    [items]
  );

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (categoryFilter !== "all" && item.category_id !== categoryFilter) return false;
      if (statusFilter === "archived" && item.active) return false;
      if (statusFilter === "available" && !(item.active && item.available)) return false;
      if (statusFilter === "unavailable" && !(item.active && !item.available)) return false;
      if (statusFilter === "low_stock" && !(item.active && item.track_stock && item.stock_quantity != null && item.stock_quantity > 0 && item.stock_quantity <= (item.low_stock_threshold ?? 5))) return false;
      if (statusFilter === "out_of_stock" && !(item.active && item.track_stock && item.stock_quantity != null && item.stock_quantity <= 0)) return false;
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
        <button className={tab === "dashboard" ? "chip active" : "chip"} onClick={() => setTab("dashboard")}>Dashboard</button>
        <button className={tab === "orders" ? "chip active" : "chip"} onClick={() => setTab("orders")}>Orders</button>
        <button className={tab === "menu" ? "chip active" : "chip"} onClick={() => setTab("menu")}>Menu</button>
        <button className={tab === "analytics" ? "chip active" : "chip"} onClick={() => setTab("analytics")}>Analytics</button>
      </div>

      {tab === "dashboard" && <CanteenOverview canteen={canteen} notify={notify} onNavigate={setTab} />}

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
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="ghost" onClick={() => {
                    const csv = vendorApi.foodItemsToCsv(items, categories);
                    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${canteen.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-menu.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                  }} disabled={items.length === 0}>
                    <HiArrowDownTray /> Export CSV
                  </button>
                  <button className="ghost" onClick={() => setImportModal(true)}>
                    <HiArrowUpTray /> Import CSV
                  </button>
                  <button className="primary" onClick={() => setItemModal({ canteen_id: canteen.id })}>
                    <HiPlus /> New item
                  </button>
                </div>
              </div>

              {(lowStockItems.length > 0 || outOfStockItems.length > 0) && (
                <div className="stock-alert-banner">
                  <HiExclamationTriangle />
                  <span>
                    {outOfStockItems.length > 0 && (
                      <>
                        <b>{outOfStockItems.length}</b> item{outOfStockItems.length === 1 ? "" : "s"} out of stock
                        {lowStockItems.length > 0 ? " · " : ""}
                      </>
                    )}
                    {lowStockItems.length > 0 && (
                      <><b>{lowStockItems.length}</b> item{lowStockItems.length === 1 ? "" : "s"} running low</>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    {outOfStockItems.length > 0 && (
                      <button onClick={() => setStatusFilter("out_of_stock")}>View out of stock</button>
                    )}
                    {lowStockItems.length > 0 && (
                      <button onClick={() => setStatusFilter("low_stock")}>View low stock</button>
                    )}
                  </div>
                </div>
              )}

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
                    <option value="low_stock">Low stock</option>
                    <option value="out_of_stock">Out of stock</option>
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
                  onSetStock={(qty) => runBulk(
                    () => vendorApi.bulkSetStock(selectedIds, qty),
                    `Stock set on ${selectedIds.length} item(s)`
                  )}
                  onStopTracking={() => runBulk(
                    () => vendorApi.bulkStopTrackingStock(selectedIds),
                    `Stopped tracking stock on ${selectedIds.length} item(s)`
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

      {importModal && (
        <ImportCsvModal
          canteenId={canteen.id}
          categories={categories}
          existingItems={items}
          onClose={() => setImportModal(false)}
          onImported={reload}
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

const PRIORITY_RANK = { urgent: 2, high: 1, normal: 0 };
const KITCHEN_STATUSES = new Set(["RECEIVED", "ACCEPTED", "PREPARING", "CANCEL_REQUESTED"]);
const PICKUP_STATUSES = new Set(["READY", "OUT_FOR_DELIVERY"]);

function sortByPriority(orders) {
  return [...orders].sort((a, b) => {
    const p = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0);
    if (p !== 0) return p;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

// Two short beeps via the Web Audio API -- no asset to fetch/self-host, and
// it works the same on staging/prod/localhost. Best-effort: browsers that
// haven't seen a user gesture yet may reject autoplay; that's fine, the
// visible queue update still happened.
function playAlertSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.18].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.2);
    });
  } catch { /* best-effort */ }
}

function OrderQueue({ canteen, notify }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [history, setHistory] = useState(null); // null until "View recent history" is opened
  const [view, setView] = useState("all"); // all | kitchen | pickup
  const [staff, setStaff] = useState([]);
  const [staffModal, setStaffModal] = useState(false);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem(`vendor-sound-${canteen.id}`) !== "off");
  const knownReceivedIds = React.useRef(null); // null until first load, so mount never "alerts" for pre-existing orders

  const reload = async () => {
    try {
      setError("");
      const active = await vendorApi.listActiveCanteenOrders(canteen.id);
      const receivedIds = new Set(active.filter((o) => o.status === "RECEIVED").map((o) => o.id));
      if (knownReceivedIds.current && soundOn) {
        const isNew = [...receivedIds].some((id) => !knownReceivedIds.current.has(id));
        if (isNew) {
          playAlertSound();
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("New order received", { body: `${canteen.name} has a new order waiting` });
          }
        }
      }
      knownReceivedIds.current = receivedIds;
      setOrders(active);
    } catch (err) {
      setError(err.message || "Could not load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    vendorApi.listCanteenStaff(canteen.id).then(setStaff).catch(() => {});
    const unsubscribe = vendorApi.subscribeToCanteenOrders(canteen.id, reload);
    return unsubscribe;
  }, [canteen.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      localStorage.setItem(`vendor-sound-${canteen.id}`, next ? "on" : "off");
      if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
      return next;
    });
  };

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

  const saveOps = async (order, fields) => {
    try {
      await vendorApi.setOrderOpsFields(order.id, fields);
      await reload();
    } catch (err) {
      notify(err.message || "Could not save");
    }
  };

  const refund = async (order) => {
    const reason = window.prompt(`Refund ₹${order.total} for order #${order.id.slice(0, 8)}? Enter a reason:`);
    if (reason === null) return;
    try {
      setBusyId(order.id);
      await vendorApi.initiateRefund(order.id, order.total, reason || "Vendor-initiated refund");
      notify(`Refund initiated for order #${order.id.slice(0, 8)}`);
    } catch (err) {
      // request_refund() itself may have already succeeded (order flipped to
      // REFUND_PENDING) even if the follow-up gateway call failed -- reload
      // below regardless so the UI never goes stale on a partial failure.
      notify(err.message || "Could not initiate refund");
    } finally {
      setBusyId(null);
      await reload();
      if (history !== null) setHistory(await vendorApi.listCanteenOrderHistory(canteen.id));
    }
  };

  if (loading) return <LoadingState label="Loading order queue…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const visibleOrders = sortByPriority(
    view === "kitchen" ? orders.filter((o) => KITCHEN_STATUSES.has(o.status))
      : view === "pickup" ? orders.filter((o) => PICKUP_STATUSES.has(o.status))
      : orders
  );
  const kitchenCount = orders.filter((o) => KITCHEN_STATUSES.has(o.status)).length;
  const pickupCount = orders.filter((o) => PICKUP_STATUSES.has(o.status)).length;

  return (
    <>
      <div className="socialize-filter-row" style={{ marginBottom: 12 }}>
        <button className={view === "all" ? "chip active" : "chip"} onClick={() => setView("all")}>All ({orders.length})</button>
        <button className={view === "kitchen" ? "chip active" : "chip"} onClick={() => setView("kitchen")}><HiFire /> Kitchen ({kitchenCount})</button>
        <button className={view === "pickup" ? "chip active" : "chip"} onClick={() => setView("pickup")}><HiTruck /> Pickup ({pickupCount})</button>
        <button className="chip" onClick={toggleSound} title={soundOn ? "Turn off new-order alerts" : "Turn on new-order alerts"}>
          {soundOn ? <HiSpeakerWave /> : <HiSpeakerXMark />} Alerts {soundOn ? "on" : "off"}
        </button>
        <button className="chip" onClick={() => setStaffModal(true)}><HiUserGroup /> Staff ({staff.filter((s) => s.active).length})</button>
      </div>

      <div className="resource-list">
        {visibleOrders.length === 0 && (
          <EmptyState icon={<HiClock />} title="No orders here" text="New orders will appear the moment a student pays." />
        )}
        {visibleOrders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            busy={busyId === order.id}
            staff={staff}
            onAct={act}
            onChanged={reload}
            onSaveOps={saveOps}
            notify={notify}
          />
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
          {history.map((order) => {
            const refundable = ["REJECTED", "CANCELLED"].includes(order.status) && order.payment_status === "paid";
            return (
              <article className="resource-row" key={order.id}>
                <div>
                  <b>#{order.id.slice(0, 8)} · {order.status}</b>
                  <small>
                    {order.order_items.map((i) => `${i.quantity}× ${i.item_name}`).join(", ")} · {timeAgo(order.created_at)}
                  </small>
                </div>
                {refundable && (
                  <button disabled={busyId === order.id} onClick={() => refund(order)}>
                    <HiBanknotes /> Initiate refund
                  </button>
                )}
                {order.status === "REFUND_PENDING" && <span className="status-pill low-stock">Refund processing…</span>}
                {order.status === "REFUNDED" && <span className="status-pill in-stock">Refunded</span>}
              </article>
            );
          })}
        </div>
      )}

      {staffModal && (
        <StaffRosterModal
          canteenId={canteen.id}
          staff={staff}
          onClose={() => setStaffModal(false)}
          onChanged={async () => setStaff(await vendorApi.listCanteenStaff(canteen.id))}
          notify={notify}
        />
      )}
    </>
  );
}

function StaffRosterModal({ canteenId, staff, onClose, onChanged, notify }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Modal kicker="ORDERS" title="Kitchen staff roster" onClose={onClose}>
      <p>Names here appear in the &ldquo;Assign to&rdquo; dropdown on each order — this doesn&apos;t create a login, just a label for who&apos;s handling it.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Staff member name"
          style={{ flex: 1 }}
        />
        <button
          className="primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            try {
              setBusy(true);
              await vendorApi.addCanteenStaff(canteenId, name);
              setName("");
              await onChanged();
            } catch (err) { notify(err.message || "Could not add staff"); } finally { setBusy(false); }
          }}
        >
          <HiPlus /> Add
        </button>
      </div>
      <div className="resource-list">
        {staff.length === 0 && <EmptyState title="No staff added yet" text="Add names so orders can be assigned to someone." />}
        {staff.map((s) => (
          <article className="resource-row" key={s.id}>
            <div><b>{s.name}</b>{!s.active && <small> · inactive</small>}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => {
                try { await vendorApi.setCanteenStaffActive(s.id, !s.active); await onChanged(); }
                catch (err) { notify(err.message || "Could not update"); }
              }}>
                {s.active ? "Deactivate" : "Reactivate"}
              </button>
              <button onClick={async () => {
                if (!window.confirm(`Remove ${s.name} from the roster?`)) return;
                try { await vendorApi.removeCanteenStaff(s.id); await onChanged(); }
                catch (err) { notify(err.message || "Could not remove"); }
              }}>
                <HiTrash />
              </button>
            </div>
          </article>
        ))}
      </div>
    </Modal>
  );
}

const PRIORITY_LABEL = { normal: "Normal", high: "High", urgent: "Urgent" };

function OrderCard({ order, busy, staff, onAct, onChanged, onSaveOps, notify }) {
  const [pickupModal, setPickupModal] = useState(false);
  const [noteDraft, setNoteDraft] = useState(order.internal_note || "");
  const [noteOpen, setNoteOpen] = useState(false);
  const next = NEXT_STEP[order.status];

  return (
    <article className="resource-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <div>
        <b>
          #{order.id.slice(0, 8)} · {order.status}{" "}
          <span className="social-type" style={{ marginLeft: 6 }}>{order.fulfillment_type}</span>
          {order.priority !== "normal" && (
            <span className={`status-pill priority-${order.priority}`} style={{ marginLeft: 6 }}>
              <HiFlag /> {PRIORITY_LABEL[order.priority]}
            </span>
          )}
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
        {order.notes && <small>Student note: {order.notes}</small>}
        {order.assigned_staff_name && <small>Assigned to: {order.assigned_staff_name}</small>}
        {order.internal_note && <small>Staff note: {order.internal_note}</small>}
        <small>{timeAgo(order.created_at)} · Order code {order.pickup_code}</small>

        <div className="order-ops-row">
          <select
            aria-label="Priority"
            value={order.priority}
            disabled={busy}
            onChange={(e) => onSaveOps(order, { priority: e.target.value, internalNote: order.internal_note, assignedStaffName: order.assigned_staff_name })}
          >
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
            <option value="urgent">Urgent</option>
          </select>
          <select
            aria-label="Assign to"
            value={order.assigned_staff_name || ""}
            disabled={busy}
            onChange={(e) => onSaveOps(order, { priority: order.priority, internalNote: order.internal_note, assignedStaffName: e.target.value })}
          >
            <option value="">Unassigned</option>
            {staff.filter((s) => s.active || s.name === order.assigned_staff_name).map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
          <button onClick={() => setNoteOpen((v) => !v)}>
            <HiChatBubbleLeftEllipsis /> {order.internal_note ? "Edit note" : "Add note"}
          </button>
        </div>

        {noteOpen && (
          <div className="order-note-form">
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Internal note for kitchen/staff -- never shown to the student"
              rows={2}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                await onSaveOps(order, { priority: order.priority, internalNote: noteDraft, assignedStaffName: order.assigned_staff_name });
                setNoteOpen(false);
              }}
            >
              Save note
            </button>
          </div>
        )}
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
        {order.status === "CANCEL_REQUESTED" && (
          <>
            <button disabled={busy} onClick={() => onAct(order, "CANCELLED", "Cancellation confirmed")}>
              <HiXCircle /> Confirm cancellation
            </button>
            <button className="primary" disabled={busy} onClick={() => onAct(order, "PREPARING", "Resumed by vendor")}>
              <HiArrowUturnLeft /> Resume preparing
            </button>
          </>
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

// null when the item doesn't track stock -- ItemCard renders nothing extra
// in that case, same as every item behaved before this feature existed.
function stockLabel(item) {
  if (!item.track_stock || item.stock_quantity == null) return null;
  if (item.stock_quantity <= 0) return { text: "Out of stock", cls: "out-of-stock" };
  if (item.stock_quantity <= (item.low_stock_threshold ?? 5)) return { text: `Low stock: ${item.stock_quantity}`, cls: "low-stock" };
  return { text: `Stock: ${item.stock_quantity}`, cls: "in-stock" };
}

function ItemCard({ item, selected, onToggleSelect, onEdit, onDelete, onToggleAvailable }) {
  const status = statusLabel(item);
  const stock = stockLabel(item);
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
        {stock && <span className={`status-pill ${stock.cls}`}>{stock.text}</span>}
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

function BulkActionsBar({ count, categories, busy, onClear, onAvailable, onArchive, onCategory, onPriceAdjust, onSetStock, onStopTracking }) {
  const [priceMode, setPriceMode] = useState("percent"); // 'percent' | 'amount'
  const [priceDirection, setPriceDirection] = useState("1"); // '1' increase, '-1' decrease
  const [priceValue, setPriceValue] = useState("");
  const [stockValue, setStockValue] = useState("");

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

        <div className="bulk-stock-form">
          <HiCubeTransparent />
          <input
            type="number"
            min="0"
            step="1"
            value={stockValue}
            onChange={(e) => setStockValue(e.target.value)}
            placeholder="Set stock"
            aria-label="Set stock quantity"
            style={{ width: 66 }}
          />
          <button
            disabled={busy || stockValue === "" || Number(stockValue) < 0}
            onClick={() => { onSetStock(stockValue); setStockValue(""); }}
          >
            Apply
          </button>
        </div>
        <button disabled={busy} onClick={onStopTracking}>Stop tracking stock</button>

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
    track_stock: Boolean(item.track_stock), stock_quantity: item.stock_quantity ?? "",
    low_stock_threshold: item.low_stock_threshold ?? 5,
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

          <div className="item-form-section-label">Inventory</div>
          <ToggleSwitch
            label="Track stock"
            checked={form.track_stock}
            onChange={(v) => change("track_stock", v)}
          />
          {form.track_stock && (
            <div className="form-grid">
              <label>Stock quantity
                <input
                  type="number"
                  min="0"
                  value={form.stock_quantity}
                  onChange={(e) => change("stock_quantity", e.target.value)}
                  placeholder="e.g. 20"
                />
              </label>
              <label>Low stock alert below
                <input
                  type="number"
                  min="0"
                  value={form.low_stock_threshold}
                  onChange={(e) => change("low_stock_threshold", e.target.value)}
                />
              </label>
            </div>
          )}

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
            {form.track_stock && (
              <small>
                {form.stock_quantity === "" ? "Stock not set yet" : `${form.stock_quantity} in stock`}
                {" "}(low-stock alert below {form.low_stock_threshold || 5})
              </small>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================
   CSV IMPORT (doc §17-19) -- parse client-side, show a preview + any
   per-row problems, and only write to the DB once the vendor confirms.
========================================================= */

function ImportCsvModal({ canteenId, categories, existingItems, onClose, onImported, notify }) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null); // { rows, errors }
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // { created, updated, errors } once import runs

  const onFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setParsed(vendorApi.parseFoodItemsCsv(String(reader.result || ""), categories));
    reader.onerror = () => notify("Could not read that file");
    reader.readAsText(file);
  };

  const willUpdate = parsed ? parsed.rows.filter((r) => r.id || existingItems.some((i) =>
    (r.sku && i.sku && i.sku.toLowerCase() === r.sku.toLowerCase()) || i.name.toLowerCase() === r.name.toLowerCase()
  )).length : 0;
  const willCreate = parsed ? parsed.rows.length - willUpdate : 0;

  return (
    <Modal kicker="MENU" title="Import menu from CSV" onClose={onClose}>
      <p>
        Upload a CSV with at least <b>name</b> and <b>price</b> columns. Rows matching an existing item
        (by id, SKU, or name) update it; everything else is created as a new item.
      </p>
      <label className="file-drop">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {fileName || "Choose a CSV file…"}
      </label>

      {parsed && (
        <>
          {parsed.rows.length > 0 && (
            <p style={{ marginTop: 14 }}>
              Ready to import: <b>{willCreate}</b> new item{willCreate === 1 ? "" : "s"}, <b>{willUpdate}</b> existing item{willUpdate === 1 ? "" : "s"} will be updated.
            </p>
          )}
          {parsed.errors.length > 0 && (
            <div className="resource-list" style={{ marginTop: 10 }}>
              {parsed.errors.map((e, i) => (
                <article className="resource-row" key={i}><small style={{ color: "#d0562f" }}>{e}</small></article>
              ))}
            </div>
          )}
          <button
            className="primary wide"
            style={{ marginTop: 16 }}
            disabled={importing || parsed.rows.length === 0}
            onClick={async () => {
              try {
                setImporting(true);
                const outcome = await vendorApi.bulkImportFoodItems(canteenId, parsed.rows, existingItems);
                setResult(outcome);
                const parts = [];
                if (outcome.created) parts.push(`${outcome.created} created`);
                if (outcome.updated) parts.push(`${outcome.updated} updated`);
                if (outcome.errors.length) parts.push(`${outcome.errors.length} failed`);
                notify(parts.length ? parts.join(", ") : "Nothing to import");
                if (outcome.created + outcome.updated > 0) onImported();
              } catch (err) {
                notify(err.message || "Import failed");
              } finally {
                setImporting(false);
              }
            }}
          >
            {importing ? "Importing…" : `Import ${parsed.rows.length} row(s)`}
          </button>

          {result && result.errors.length > 0 && (
            <div className="resource-list" style={{ marginTop: 10 }}>
              <p><b>{result.errors.length}</b> row(s) failed to save:</p>
              {result.errors.map((e, i) => (
                <article className="resource-row" key={i}><small style={{ color: "#d0562f" }}>{e}</small></article>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* =========================================================
   PRINT SHOP PRICING
========================================================= */

const RATE_LABELS = { black_white: "Black & White (per page)", colour: "Colour (per page)" };

function PrintPricingManager({ rates, notify, onChanged }) {
  const [tab, setTab] = useState("dashboard");

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
        <button className={tab === "dashboard" ? "chip active" : "chip"} onClick={() => setTab("dashboard")}>Dashboard</button>
        <button className={tab === "jobs" ? "chip active" : "chip"} onClick={() => setTab("jobs")}>Print Queue</button>
        <button className={tab === "pricing" ? "chip active" : "chip"} onClick={() => setTab("pricing")}>Pricing</button>
        <button className={tab === "analytics" ? "chip active" : "chip"} onClick={() => setTab("analytics")}>Analytics</button>
      </div>

      {tab === "dashboard" && <PrintShopOverview notify={notify} onNavigate={setTab} />}

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
