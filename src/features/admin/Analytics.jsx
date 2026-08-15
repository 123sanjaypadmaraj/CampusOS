import React, { useEffect, useState } from "react";
import { LoadingState, ErrorState } from "../../components/ui/States";
import { TrendChart, BarChart, SlaBar, StatTile } from "../../components/ui/Charts";
import { supabase } from "../../lib/supabase";

const RANGES = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
];

const VENDOR_TYPE_LABEL = { canteen: "Canteen", print_shop: "Print Shop", store: "Store" };

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

const money = (n) => `₹${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function AdminAnalytics({ campusId }) {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dau, setDau] = useState([]);
  const [gmv, setGmv] = useState([]);
  const [topCanteens, setTopCanteens] = useState([]);
  const [sla, setSla] = useState([]);
  const [wau, setWau] = useState(0);
  const [mau, setMau] = useState(0);
  const [vendorPerformance, setVendorPerformance] = useState([]);
  const [eventsSummary, setEventsSummary] = useState(null);
  const [topEvents, setTopEvents] = useState([]);
  const [facilitiesSummary, setFacilitiesSummary] = useState(null);
  const [ticketsByCategory, setTicketsByCategory] = useState([]);
  const [marketplaceSummary, setMarketplaceSummary] = useState(null);
  const [notificationsSummary, setNotificationsSummary] = useState(null);
  const [platformHealth, setPlatformHealth] = useState(null);
  const [errorTrend, setErrorTrend] = useState([]);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [
        dauSeries, gmvSeries, canteens, slaSummary, wauCount, mauCount,
        vendorPerf, evSummary, evTop, facSummary, ticketsCat,
        mktSummary, notifSummary, health, errTrend,
      ] = await Promise.all([
        rpc("admin_dau_series", { p_campus_id: campusId, p_days: days }),
        rpc("admin_gmv_series", { p_campus_id: campusId, p_days: days }),
        rpc("admin_top_canteens_gmv", { p_campus_id: campusId, p_days: days }),
        rpc("admin_sla_summary", { p_campus_id: campusId, p_days: days }),
        rpc("admin_active_users_window", { p_campus_id: campusId, p_days: 7 }),
        rpc("admin_active_users_window", { p_campus_id: campusId, p_days: 30 }),
        rpc("admin_vendor_performance", { p_campus_id: campusId, p_days: days }),
        rpc("admin_events_summary", { p_campus_id: campusId, p_days: days }),
        rpc("admin_top_events", { p_campus_id: campusId, p_days: days }),
        rpc("admin_facilities_summary", { p_campus_id: campusId, p_days: days }),
        rpc("admin_tickets_by_category", { p_campus_id: campusId, p_days: days }),
        rpc("admin_marketplace_summary", { p_campus_id: campusId, p_days: days }),
        rpc("admin_notifications_summary", { p_campus_id: campusId, p_days: days }),
        rpc("admin_platform_health", { p_campus_id: campusId, p_days: days }),
        rpc("admin_error_trend", { p_campus_id: campusId, p_days: days }),
      ]);
      setDau(dauSeries || []);
      setGmv(gmvSeries || []);
      setTopCanteens((canteens || []).filter((c) => c.orders_count > 0));
      setSla(slaSummary || []);
      setWau(wauCount || 0);
      setMau(mauCount || 0);
      setVendorPerformance((vendorPerf || []).filter((v) => v.orders_count > 0));
      setEventsSummary((evSummary && evSummary[0]) || null);
      setTopEvents(evTop || []);
      setFacilitiesSummary((facSummary && facSummary[0]) || null);
      setTicketsByCategory(ticketsCat || []);
      setMarketplaceSummary((mktSummary && mktSummary[0]) || null);
      setNotificationsSummary((notifSummary && notifSummary[0]) || null);
      setPlatformHealth((health && health[0]) || null);
      setErrorTrend(errTrend || []);
    } catch (err) {
      setError(err.message || "Could not load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId, days]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Crunching numbers…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const todayDau = dau.length ? dau[dau.length - 1].dau : 0;
  const totalGmv = gmv.reduce((s, d) => s + Number(d.gmv || 0), 0);
  const totalOrders = gmv.reduce((s, d) => s + Number(d.orders_count || 0), 0);
  const overallAov = totalOrders > 0 ? totalGmv / totalOrders : 0;

  const foodSla = sla.find((s) => s.domain === "food_order");
  const ticketSla = sla.find((s) => s.domain === "ticket");

  return (
    <div>
      <div className="analytics-range">
        {RANGES.map(([n, label]) => (
          <button key={n} className={days === n ? "chip active" : "chip"} onClick={() => setDays(n)}>{label}</button>
        ))}
      </div>

      <div className="analytics-grid">
        <StatTile label="Today's DAU" value={todayDau} sub={`${wau} in last 7d · ${mau} in last 30d`} />
        <StatTile label={`Food GMV (${days}d)`} value={money(totalGmv)} sub={`${totalOrders} paid orders`} />
        <StatTile label="AOV" value={money(overallAov)} sub="Average order value" />
        <StatTile
          label="Ticket SLA"
          value={ticketSla?.sla_met_pct != null ? `${ticketSla.sla_met_pct}%` : "—"}
          sub={ticketSla?.total ? `${ticketSla.total} tickets in range` : "No tickets in range"}
        />
      </div>

      <div className="analytics-charts-grid">
        <TrendChart title="Daily active users" points={dau.map((d) => ({ x: d.day, y: d.dau }))} valueFormatter={(v) => `${v} active`} />
        <TrendChart title="Food GMV per day" points={gmv.map((d) => ({ x: d.day, y: d.gmv }))} valueFormatter={money} />
      </div>

      <div className="analytics-charts-grid">
        <BarChart
          title="GMV by canteen"
          bars={topCanteens.map((c) => ({ label: c.canteen_name, value: c.gmv }))}
          valueFormatter={money}
          emptyText="No paid food orders in this range"
        />
        <div className="chart-card">
          <h4>SLA compliance</h4>
          <SlaBar label={`Food order fulfillment (30-min target)${foodSla?.avg_minutes != null ? ` · avg ${foodSla.avg_minutes}min` : ""}`} withinPct={foodSla?.sla_met_pct || 0} total={foodSla?.total || 0} />
          <SlaBar label={`Facilities tickets (priority-based target)${ticketSla?.avg_minutes != null ? ` · avg resolution ${Math.round(ticketSla.avg_minutes / 60)}h` : ""}`} withinPct={ticketSla?.sla_met_pct || 0} total={ticketSla?.total || 0} />
        </div>
      </div>

      <h3 style={{ marginTop: 28 }}>Vendor performance</h3>
      <BarChart
        title="GMV by vendor -- every canteen, the print shop, and every campus store"
        bars={vendorPerformance.map((v) => ({ label: `${v.vendor_name} (${VENDOR_TYPE_LABEL[v.vendor_type] || v.vendor_type})`, value: v.gmv }))}
        valueFormatter={money}
        emptyText="No completed orders across any vendor in this range"
      />

      <h3 style={{ marginTop: 28 }}>Events</h3>
      <div className="analytics-grid">
        <StatTile label="Events" value={eventsSummary?.events_count ?? 0} sub={`${eventsSummary?.total_registrations ?? 0} registrations`} />
        <StatTile label="Avg. registrations/event" value={eventsSummary?.avg_registrations ?? 0} />
        <StatTile label="Registration cancellation rate" value={eventsSummary?.cancellation_rate != null ? `${eventsSummary.cancellation_rate}%` : "—"} />
      </div>
      <BarChart
        title="Most-registered events"
        bars={topEvents.map((e) => ({ label: e.event_name, value: e.registrations }))}
        emptyText="No registrations in this range"
      />

      <h3 style={{ marginTop: 28 }}>Facilities</h3>
      <div className="analytics-grid">
        <StatTile label="Tickets" value={facilitiesSummary?.tickets_count ?? 0} sub={facilitiesSummary?.tickets_resolved_pct != null ? `${facilitiesSummary.tickets_resolved_pct}% resolved` : "No tickets in range"} />
        <StatTile label="Bookings" value={facilitiesSummary?.bookings_count ?? 0} sub={facilitiesSummary?.bookings_approved_pct != null ? `${facilitiesSummary.bookings_approved_pct}% approved` : "No decided bookings in range"} />
      </div>
      <BarChart
        title="Tickets by category"
        bars={ticketsByCategory.map((t) => ({ label: t.category, value: t.ticket_count }))}
        emptyText="No tickets in this range"
      />

      <h3 style={{ marginTop: 28 }}>Marketplace &amp; notifications</h3>
      <div className="analytics-grid">
        <StatTile label="New listings" value={marketplaceSummary?.listings_count ?? 0} sub={`${marketplaceSummary?.active_count ?? 0} currently active`} />
        <StatTile label="Sold" value={marketplaceSummary?.sold_count ?? 0} sub={marketplaceSummary?.sold_pct != null ? `${marketplaceSummary.sold_pct}% of new listings` : undefined} />
        <StatTile label="Notifications sent" value={notificationsSummary?.sent_count ?? 0} />
        <StatTile label="Read rate" value={notificationsSummary?.read_pct != null ? `${notificationsSummary.read_pct}%` : "—"} sub={`${notificationsSummary?.read_count ?? 0} read`} />
      </div>

      <h3 style={{ marginTop: 28 }}>Platform health</h3>
      <div className="analytics-grid">
        <StatTile label="Errors" value={platformHealth?.error_count ?? 0} sub={platformHealth?.fatal_count ? `${platformHealth.fatal_count} fatal` : "No fatal errors"} />
        <StatTile label="Resolved" value={platformHealth?.resolved_pct != null ? `${platformHealth.resolved_pct}%` : "—"} sub={`${platformHealth?.resolved_count ?? 0} resolved`} />
      </div>
      <TrendChart title="Errors per day" points={errorTrend.map((d) => ({ x: d.day, y: d.error_count }))} valueFormatter={(v) => `${v} errors`} emptyText="No errors logged in this range -- also check the Errors tab" />
    </div>
  );
}
