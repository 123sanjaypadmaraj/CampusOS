import React, { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { FEATURES } from "../../config/features";
import { getMyClubs, getMyEventRegistrations, getMyMarketplaceListings, getMyPayments, getOrCreateOrderInvoice } from "../../services/mvpService";
import { getMyApplicationsDetailed, getMyMentorRequests } from "../../services/opportunitiesService";
import { getOrCreateStoreOrderInvoice } from "../../services/storeService";
import { renewMarketplaceListing } from "../marketplace/api";
import { HiAcademicCap, HiBell, HiBriefcase, HiBuildingOffice2, HiBuildingStorefront, HiCalendarDays, HiCreditCard, HiPrinter, HiQrCode, HiShoppingBag, HiShoppingCart, HiUserGroup, HiWrenchScrewdriver } from "react-icons/hi2";
import { ModalShell, PageHeader } from "../../components/ui/Shell";
import { EventTicketModal } from "../events/EventTicketModal";

function activityStatusTone(status) {
  const s = (status || "").toString().toLowerCase();
  if (/(completed|delivered|paid|captured|confirmed|approved|accepted|sold|resolved|active)/.test(s)) return "good";
  if (/(cancel|reject|fail|declin|remov|expired|refund)/.test(s)) return "bad";
  if (/(pending|submitted|created|preparing|ready|reviewed|shortlisted|out_for_delivery|received|processing)/.test(s)) return "warn";
  return "neutral";
}

function formatStatusLabel(status) {
  if (!status) return "";
  return status.toString().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function activityMoney(value) {
  return `₹${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function ActivityRow({ icon, title, subtitle, meta, status, onClick, action }) {
  return (
    <div
      className={`activity-row${onClick ? " clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <span className="activity-row-icon">{icon}</span>
      <div className="activity-row-body">
        <b>{title}</b>
        {subtitle && <small>{subtitle}</small>}
      </div>
      <div className="activity-row-end">
        {status && <span className={`activity-status tone-${activityStatusTone(status)}`}>{formatStatusLabel(status)}</span>}
        {meta && <small className="activity-row-meta">{meta}</small>}
        {action}
      </div>
    </div>
  );
}

const ACTIVITY_CATEGORIES = [
  { key: "food", label: "Food orders", icon: <HiShoppingCart /> },
  { key: "store", label: "Store orders", icon: <HiBuildingStorefront /> },
  { key: "events", label: "Event registrations", icon: <HiCalendarDays /> },
  { key: "clubs", label: "Club activity", icon: <HiUserGroup /> },
  { key: "marketplace", label: "Marketplace", icon: <HiShoppingBag /> },
  { key: "services", label: "Service requests", icon: <HiWrenchScrewdriver /> },
  { key: "bookings", label: "Bookings", icon: <HiBuildingOffice2 /> },
  { key: "print", label: "Print jobs", icon: <HiPrinter /> },
  { key: "applications", label: "Applications", icon: <HiBriefcase /> },
  { key: "notifications", label: "Notifications", icon: <HiBell /> },
  { key: "payments", label: "Payments", icon: <HiCreditCard /> },
];

function YourActivity({
  profile,
  authUser,
  notify,
  go,
  orders = [],
  storeOrders = [],
  printJobs = [],
  serviceRequests = [],
  bookings = [],
  notifications = [],
}) {
  const userId = profile?.id || authUser?.id;
  const [tab, setTab] = useState(FEATURES.food ? "food" : "store");
  const [loading, setLoading] = useState(true);
  const [eventRegs, setEventRegs] = useState([]);
  const [clubActivity, setClubActivity] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [applications, setApplications] = useState([]);
  const [mentorRequests, setMentorRequests] = useState([]);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getMyEventRegistrations(userId),
      getMyClubs(userId),
      getMyMarketplaceListings(userId),
      getMyApplicationsDetailed(userId),
      getMyMentorRequests(userId),
      getMyPayments(userId),
    ])
      .then(([regs, clubMemberships, listings, apps, mentorReqs, pays]) => {
        if (cancelled) return;
        setEventRegs(regs);
        setClubActivity(clubMemberships);
        setMyListings(listings);
        setApplications(apps);
        setMentorRequests(mentorReqs);
        setPayments(pays);
      })
      .catch((error) => {
        console.error("Your Activity loading failed:", error);
        notify?.(error.message || "Could not load your activity");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!userId) {
    return (
      <ErrorState
        title="Sign in to view your activity"
        text="Your food orders, bookings, applications, payments and more all live here once you're signed in."
      />
    );
  }

  const counts = {
    food: orders.length,
    store: storeOrders.length,
    events: eventRegs.length,
    clubs: clubActivity.length,
    marketplace: myListings.length,
    services: serviceRequests.length,
    bookings: bookings.length,
    print: printJobs.length,
    applications: applications.length + mentorRequests.length,
    notifications: notifications.length,
    payments: payments.length,
  };

  return (
    <section className="page-section activity-page">
      <PageHeader
        kicker="YOUR HISTORY"
        title="Your activity"
        text="Everything you've ordered, booked, joined and applied to on CampusOS, in one place."
      />

      <div className="activity-layout">
        <nav className="activity-nav" aria-label="Activity categories">
          {ACTIVITY_CATEGORIES.filter((c) => FEATURES.food || c.key !== "food").map((c) => (
            <button
              key={c.key}
              className={`activity-nav-item${tab === c.key ? " active" : ""}`}
              onClick={() => setTab(c.key)}
            >
              <span className="activity-nav-icon">{c.icon}</span>
              <span className="activity-nav-label">{c.label}</span>
              <span className="activity-nav-count">{counts[c.key]}</span>
            </button>
          ))}
        </nav>

        <div className="activity-content">
          {loading ? (
            <LoadingState label="Loading your activity…" />
          ) : (
            <>
              {tab === "food" && <ActivityFoodOrders orders={orders} go={go} />}
              {tab === "store" && <ActivityStoreOrders orders={storeOrders} go={go} />}
              {tab === "events" && <ActivityEventRegistrations items={eventRegs} go={go} userId={userId} notify={notify} />}
              {tab === "clubs" && <ActivityClubs items={clubActivity} go={go} />}
              {tab === "marketplace" && (
                <ActivityMarketplace
                  items={myListings}
                  go={go}
                  notify={notify}
                  onRenewed={(updated) =>
                    setMyListings((list) => list.map((l) => (l.id === updated.id ? { ...l, status: updated.status, expires_at: updated.expires_at } : l)))
                  }
                />
              )}
              {tab === "services" && <ActivityServiceRequests items={serviceRequests} go={go} />}
              {tab === "bookings" && <ActivityBookings items={bookings} go={go} />}
              {tab === "print" && <ActivityPrintJobs items={printJobs} go={go} />}
              {tab === "applications" && (
                <ActivityApplications applications={applications} mentorRequests={mentorRequests} go={go} />
              )}
              {tab === "notifications" && <ActivityNotifications items={notifications} go={go} />}
              {tab === "payments" && <ActivityPayments items={payments} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ActivityFoodOrders({ orders, go }) {
  const [receiptOrder, setReceiptOrder] = useState(null);

  if (!orders.length) {
    return (
      <EmptyState
        icon={<HiShoppingCart />}
        title="No food orders yet"
        text="Order from a campus canteen and it'll show up here."
        action={<button className="ghost" onClick={() => go("food")}>Browse food</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {orders.map((order) => (
        <ActivityRow
          key={order.id}
          icon={<HiShoppingCart />}
          title={order.canteens?.name || "Canteen order"}
          subtitle={`${(order.order_items || []).length} item${(order.order_items || []).length === 1 ? "" : "s"} · ${order.created_at ? new Date(order.created_at).toLocaleString() : ""}${order.pickup_code ? ` · Pickup ${order.pickup_code}` : ""}`}
          meta={activityMoney(order.total)}
          status={order.status}
          action={
            ["paid", "refund_pending", "refunded"].includes(order.payment_status) ? (
              <button className="ghost" onClick={(e) => { e.stopPropagation(); setReceiptOrder(order); }}>
                Receipt
              </button>
            ) : undefined
          }
        />
      ))}

      {receiptOrder && <FoodReceiptModal order={receiptOrder} onClose={() => setReceiptOrder(null)} />}
    </div>
  );
}

function FoodReceiptModal({ order, onClose }) {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    getOrCreateOrderInvoice(order.id)
      .then((data) => { if (mounted) setInvoice(data); })
      .catch((err) => { if (mounted) setError(err.message || "Could not load the receipt"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [order.id]);

  return (
    <ModalShell kicker="RECEIPT" title={order.canteens?.name || "Order receipt"} onClose={onClose}>
      {loading && <LoadingState label="Loading receipt…" />}
      {error && <ErrorState title="Couldn't load the receipt" text={error} />}
      {invoice && (
        <div className="receipt-body">
          <div className="resource-row">
            <div>
              <b>{invoice.invoice_number}</b>
              <small>{new Date(invoice.issued_at).toLocaleString()}</small>
            </div>
          </div>

          <div className="price-preview"><span>Subtotal</span><b>₹{invoice.subtotal}</b></div>
          {Number(invoice.cgst_amount) > 0 || Number(invoice.sgst_amount) > 0 ? (
            <>
              <div className="price-preview"><span>CGST</span><b>₹{invoice.cgst_amount}</b></div>
              <div className="price-preview"><span>SGST</span><b>₹{invoice.sgst_amount}</b></div>
              {invoice.gst_number && <small>GSTIN: {invoice.gst_number}</small>}
            </>
          ) : (
            <div className="price-preview"><span>Tax</span><b>₹{invoice.tax_amount}</b></div>
          )}
          {Number(invoice.platform_fee) > 0 && <div className="price-preview"><span>Platform fee</span><b>₹{invoice.platform_fee}</b></div>}
          {Number(invoice.delivery_fee) > 0 && <div className="price-preview"><span>Delivery fee</span><b>₹{invoice.delivery_fee}</b></div>}
          {Number(invoice.discount_amount) > 0 && <div className="price-preview"><span>Discount</span><b>−₹{invoice.discount_amount}</b></div>}
          <div className="price-preview"><span>Total</span><b>₹{invoice.total}</b></div>

          <button className="ghost wide" style={{ marginTop: 16 }} onClick={() => window.print()}>Print / save as PDF</button>
        </div>
      )}
    </ModalShell>
  );
}

function ActivityStoreOrders({ orders, go }) {
  const [receiptOrder, setReceiptOrder] = useState(null);

  if (!orders.length) {
    return (
      <EmptyState
        icon={<HiBuildingStorefront />}
        title="No store orders yet"
        text="Order from a campus store and it'll show up here."
        action={<button className="ghost" onClick={() => go("store")}>Browse store</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {orders.map((order) => (
        <ActivityRow
          key={order.id}
          icon={<HiBuildingStorefront />}
          title={order.stores?.name || "Store order"}
          subtitle={`${(order.store_order_items || []).length} item${(order.store_order_items || []).length === 1 ? "" : "s"} · ${order.created_at ? new Date(order.created_at).toLocaleString() : ""}${order.pickup_code ? ` · Pickup ${order.pickup_code}` : ""}`}
          meta={activityMoney(order.total)}
          status={order.status}
          action={
            order.status === "COMPLETED" ? (
              <button className="ghost" onClick={(e) => { e.stopPropagation(); setReceiptOrder(order); }}>
                Receipt
              </button>
            ) : undefined
          }
        />
      ))}

      {receiptOrder && <StoreReceiptModal order={receiptOrder} onClose={() => setReceiptOrder(null)} />}
    </div>
  );
}

function StoreReceiptModal({ order, onClose }) {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    getOrCreateStoreOrderInvoice(order.id)
      .then((data) => { if (mounted) setInvoice(data); })
      .catch((err) => { if (mounted) setError(err.message || "Could not load the receipt"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [order.id]);

  return (
    <ModalShell kicker="RECEIPT" title={order.stores?.name || "Order receipt"} onClose={onClose}>
      {loading && <LoadingState label="Loading receipt…" />}
      {error && <ErrorState title="Couldn't load the receipt" text={error} />}
      {invoice && (
        <div className="receipt-body">
          <div className="resource-row">
            <div>
              <b>{invoice.invoice_number}</b>
              <small>{new Date(invoice.issued_at).toLocaleString()}</small>
            </div>
          </div>

          <div className="price-preview"><span>Subtotal</span><b>₹{invoice.subtotal}</b></div>
          {Number(invoice.cgst_amount) > 0 || Number(invoice.sgst_amount) > 0 ? (
            <>
              <div className="price-preview"><span>CGST</span><b>₹{invoice.cgst_amount}</b></div>
              <div className="price-preview"><span>SGST</span><b>₹{invoice.sgst_amount}</b></div>
              {invoice.gst_number && <small>GSTIN: {invoice.gst_number}</small>}
            </>
          ) : (
            <div className="price-preview"><span>Tax</span><b>₹{invoice.tax_amount}</b></div>
          )}
          {Number(invoice.platform_fee) > 0 && <div className="price-preview"><span>Platform fee</span><b>₹{invoice.platform_fee}</b></div>}
          <div className="price-preview"><span>Total</span><b>₹{invoice.total}</b></div>

          <button className="ghost wide" style={{ marginTop: 16 }} onClick={() => window.print()}>Print / save as PDF</button>
        </div>
      )}
    </ModalShell>
  );
}

function ActivityEventRegistrations({ items, go, userId, notify }) {
  const [ticketFor, setTicketFor] = useState(null);

  if (!items.length) {
    return (
      <EmptyState
        icon={<HiCalendarDays />}
        title="No event registrations yet"
        text="Register for a campus event and it'll show up here."
        action={<button className="ghost" onClick={() => go("events")}>Browse events</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((reg) => (
        <ActivityRow
          key={reg.event_id}
          icon={<HiCalendarDays />}
          title={reg.events?.title || "Campus event"}
          subtitle={`${reg.events?.category || "Event"}${reg.events?.place ? ` · ${reg.events.place}` : ""}${reg.events?.event_date ? ` · ${new Date(reg.events.event_date).toLocaleString()}` : ""}`}
          meta={reg.registered_at ? `Registered ${new Date(reg.registered_at).toLocaleDateString()}` : undefined}
          onClick={() => go("events")}
          action={
            <button
              className="ghost"
              onClick={(e) => { e.stopPropagation(); setTicketFor(reg.events); }}
            >
              <HiQrCode /> Ticket
            </button>
          }
        />
      ))}
      {ticketFor && (
        <EventTicketModal event={ticketFor} userId={userId} notify={notify} onClose={() => setTicketFor(null)} />
      )}
    </div>
  );
}

function ActivityClubs({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiUserGroup />}
        title="No club activity yet"
        text="Join a club and your membership will show up here."
        action={<button className="ghost" onClick={() => go("clubs")}>Browse clubs</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((membership) => (
        <ActivityRow
          key={membership.club_id}
          icon={<HiUserGroup />}
          title={membership.clubs?.name || "Campus club"}
          subtitle={`${membership.clubs?.category || "Club"}${membership.joined_at ? ` · Joined ${new Date(membership.joined_at).toLocaleDateString()}` : ""}`}
          meta={membership.role ? formatStatusLabel(membership.role) : undefined}
          onClick={() => go("clubs")}
        />
      ))}
    </div>
  );
}

function ActivityMarketplace({ items, go, notify, onRenewed }) {
  const [renewingId, setRenewingId] = useState(null);

  if (!items.length) {
    return (
      <EmptyState
        icon={<HiShoppingBag />}
        title="No marketplace listings yet"
        text="List something to sell and it'll show up here."
        action={<button className="ghost" onClick={() => go("market")}>Open Marketplace</button>}
      />
    );
  }

  const renew = async (e, listing) => {
    e.stopPropagation();
    try {
      setRenewingId(listing.id);
      const updated = await renewMarketplaceListing(listing.id);
      onRenewed?.(updated);
      notify?.("Listing renewed for another 60 days");
    } catch (err) {
      notify?.(err.message || "Could not renew this listing");
    } finally {
      setRenewingId(null);
    }
  };

  return (
    <div className="activity-list">
      {items.map((listing) => {
        const canRenew = listing.status === "expired" || (listing.status === "active" && listing.expires_at && new Date(listing.expires_at) - Date.now() < 7 * 24 * 60 * 60 * 1000);
        return (
          <ActivityRow
            key={listing.id}
            icon={<HiShoppingBag />}
            title={listing.title}
            subtitle={`${listing.category || "Other"} · ${listing.condition || "Used"}${listing.created_at ? ` · Listed ${new Date(listing.created_at).toLocaleDateString()}` : ""}`}
            meta={activityMoney(listing.price)}
            status={listing.status}
            onClick={() => go("market")}
            action={
              canRenew ? (
                <button className="ghost" disabled={renewingId === listing.id} onClick={(e) => renew(e, listing)}>
                  {renewingId === listing.id ? "Renewing…" : listing.status === "expired" ? "Renew" : "Extend"}
                </button>
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}

function ActivityServiceRequests({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiWrenchScrewdriver />}
        title="No service requests yet"
        text="Report a maintenance issue and it'll show up here."
        action={<button className="ghost" onClick={() => go("issues")}>Report an issue</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((request) => (
        <ActivityRow
          key={request.id}
          icon={<HiWrenchScrewdriver />}
          title={request.title || request.services?.name || "Service request"}
          subtitle={`${request.services?.name || "Campus service"}${request.locations?.building ? ` · ${request.locations.building}` : ""}${request.created_at ? ` · ${new Date(request.created_at).toLocaleDateString()}` : ""}`}
          status={request.status}
          onClick={() => go("issues")}
        />
      ))}
    </div>
  );
}

function ActivityBookings({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiBuildingOffice2 />}
        title="No bookings yet"
        text="Book a hall, lab or piece of equipment and it'll show up here."
        action={<button className="ghost" onClick={() => go("booking")}>Book a resource</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((booking) => (
        <ActivityRow
          key={booking.id}
          icon={<HiBuildingOffice2 />}
          title={booking.resources?.name || "Resource booking"}
          subtitle={`${booking.resources?.resource_type || "Resource"} · ${booking.start_time ? new Date(booking.start_time).toLocaleString() : ""}${booking.end_time ? ` – ${new Date(booking.end_time).toLocaleTimeString()}` : ""}`}
          status={booking.status}
          onClick={() => go("booking")}
        />
      ))}
    </div>
  );
}

function ActivityPrintJobs({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiPrinter />}
        title="No print jobs yet"
        text="Upload a document to print and it'll show up here."
        action={<button className="ghost" onClick={() => go("print")}>Print a document</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((job) => (
        <ActivityRow
          key={job.id}
          icon={<HiPrinter />}
          title={job.file_name || "Print job"}
          subtitle={`${job.copies || 1} copy${(job.copies || 1) === 1 ? "" : "ies"} · ${job.pages || 1} page${(job.pages || 1) === 1 ? "" : "s"} · ${job.color_mode === "colour" ? "Color" : "Black & white"}${job.created_at ? ` · ${new Date(job.created_at).toLocaleDateString()}` : ""}`}
          meta={job.price != null ? activityMoney(job.price) : undefined}
          status={job.status}
          onClick={() => go("print")}
        />
      ))}
    </div>
  );
}

function ActivityApplications({ applications, mentorRequests, go }) {
  if (!applications.length && !mentorRequests.length) {
    return (
      <EmptyState
        icon={<HiBriefcase />}
        title="No applications yet"
        text="Apply to an opportunity or request a mentor and it'll show up here."
        action={<button className="ghost" onClick={() => go("events")}>Browse opportunities</button>}
      />
    );
  }
  return (
    <div className="activity-list">
      {applications.map((app) => (
        <ActivityRow
          key={`app-${app.id}`}
          icon={<HiBriefcase />}
          title={app.opportunities ? `${app.opportunities.role} @ ${app.opportunities.company}` : "Opportunity application"}
          subtitle={`${app.opportunities?.type || "Opportunity"}${app.created_at ? ` · Applied ${new Date(app.created_at).toLocaleDateString()}` : ""}`}
          status={app.status}
          onClick={() => go("events")}
        />
      ))}
      {mentorRequests.map((req) => (
        <ActivityRow
          key={`mentor-${req.id}`}
          icon={<HiAcademicCap />}
          title={req.mentors ? `Mentorship · ${req.mentors.name}` : "Mentor request"}
          subtitle={`${req.mentors?.role || "Mentor"}${req.created_at ? ` · Requested ${new Date(req.created_at).toLocaleDateString()}` : ""}`}
          status={req.status}
          onClick={() => go("events")}
        />
      ))}
    </div>
  );
}

function ActivityNotifications({ items, go }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiBell />}
        title="No notifications yet"
        text="Campus updates, order alerts and service updates will show up here."
      />
    );
  }
  return (
    <div className="activity-list">
      {items.slice(0, 20).map((n) => (
        <ActivityRow
          key={n.id}
          icon={<HiBell />}
          title={n.title}
          subtitle={n.time || (n.created_at ? new Date(n.created_at).toLocaleString() : "")}
          meta={n.unread ? "Unread" : undefined}
          onClick={() => go("notifications")}
        />
      ))}
      {items.length > 20 && (
        <button className="ghost wide" onClick={() => go("notifications")}>
          View all {items.length} notifications
        </button>
      )}
    </div>
  );
}

function paymentTitle(payment) {
  if (payment.orders?.canteens?.name) return `Payment · ${payment.orders.canteens.name}`;
  if (payment.print_jobs) return `Payment · Print job${payment.print_jobs.pickup_code ? ` #${payment.print_jobs.pickup_code}` : ""}`;
  if (payment.event_registrations?.events?.title) return `Payment · ${payment.event_registrations.events.title}`;
  return "Payment";
}

function ActivityPayments({ items }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<HiCreditCard />}
        title="No payments yet"
        text="Payments for food orders, print jobs and paid events show up here once you've made one."
      />
    );
  }
  return (
    <div className="activity-list">
      {items.map((payment) => (
        <ActivityRow
          key={payment.id}
          icon={<HiCreditCard />}
          title={paymentTitle(payment)}
          subtitle={`${payment.gateway ? formatStatusLabel(payment.gateway) : "Gateway"}${payment.created_at ? ` · ${new Date(payment.created_at).toLocaleString()}` : ""}`}
          meta={activityMoney(payment.amount)}
          status={payment.status}
        />
      ))}
    </div>
  );
}

export { ACTIVITY_CATEGORIES, ActivityApplications, ActivityBookings, ActivityClubs, ActivityEventRegistrations, ActivityFoodOrders, ActivityMarketplace, ActivityNotifications, ActivityPayments, ActivityPrintJobs, ActivityRow, ActivityServiceRequests, ActivityStoreOrders, FoodReceiptModal, StoreReceiptModal, YourActivity, activityMoney, activityStatusTone, formatStatusLabel, paymentTitle };
