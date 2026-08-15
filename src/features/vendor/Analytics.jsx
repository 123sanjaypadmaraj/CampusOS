import React, { useEffect, useState } from "react";
import { LoadingState, ErrorState } from "../../components/ui/States";
import { TrendChart, BarChart, SlaBar, StatTile } from "../../components/ui/Charts";
import { supabase } from "../../lib/supabase";

const RANGES = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
];

const SLA_LABEL = {
  food_order: "Order fulfillment (30-min target)",
  print_job: "Print turnaround (2-hour target)",
  store_order: "Pickup turnaround (24-hour target)",
};

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

const money = (n) => `₹${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const HOUR_LABEL = (h) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

// Scoped entirely server-side to whatever the caller owns (their canteen,
// the print shop, or a campus store) -- see vendor_gmv_series()/
// vendor_sla_summary() in supabase/migrations/20260814005000_analytics.sql
// (extended for stores in 20260815000900_..._variants_stock_analytics.sql,
// and for top products/peak hours/repeat customers/cancellations & refunds
// in 20260815001300_analytics_platform.sql). Same component serves all
// three vendor types; the SLA domain returned tells us which one this is.
// vendor_top_products() returns an empty (not error) result for the print
// shop, which has no per-SKU catalog -- that section just doesn't render.
export default function VendorAnalytics() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [gmv, setGmv] = useState([]);
  const [sla, setSla] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [peakHours, setPeakHours] = useState([]);
  const [repeat, setRepeat] = useState(null);
  const [cancelRefund, setCancelRefund] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [gmvSeries, slaSummary, products, hours, repeatCustomers, cancellations] = await Promise.all([
        rpc("vendor_gmv_series", { p_days: days }),
        rpc("vendor_sla_summary", { p_days: days }),
        rpc("vendor_top_products", { p_days: days }),
        rpc("vendor_peak_hours", { p_days: days }),
        rpc("vendor_repeat_customers", { p_days: days }),
        rpc("vendor_cancellations_refunds", { p_days: days }),
      ]);
      setGmv(gmvSeries || []);
      setSla((slaSummary && slaSummary[0]) || null);
      setTopProducts(products || []);
      setPeakHours(hours || []);
      setRepeat((repeatCustomers && repeatCustomers[0]) || null);
      setCancelRefund((cancellations && cancellations[0]) || null);
    } catch (err) {
      setError(err.message || "Could not load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Crunching numbers…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const totalGmv = gmv.reduce((s, d) => s + Number(d.gmv || 0), 0);
  const totalOrders = gmv.reduce((s, d) => s + Number(d.orders_count || 0), 0);
  const overallAov = totalOrders > 0 ? totalGmv / totalOrders : 0;

  return (
    <div>
      <div className="analytics-range">
        {RANGES.map(([n, label]) => (
          <button key={n} className={days === n ? "chip active" : "chip"} onClick={() => setDays(n)}>{label}</button>
        ))}
      </div>

      <div className="analytics-grid">
        <StatTile label={`Revenue (${days}d)`} value={money(totalGmv)} sub={`${totalOrders} orders`} />
        <StatTile label="AOV" value={money(overallAov)} sub="Average order value" />
        <StatTile
          label="On-time %"
          value={sla?.sla_met_pct != null ? `${sla.sla_met_pct}%` : "—"}
          sub={sla?.total ? `${sla.total} completed in range` : "Nothing completed in range"}
        />
        <StatTile label="Avg. turnaround" value={sla?.avg_minutes != null ? `${sla.avg_minutes} min` : "—"} />
      </div>

      <TrendChart title="Revenue per day" points={gmv.map((d) => ({ x: d.day, y: d.gmv }))} valueFormatter={money} />

      <div className="chart-card" style={{ marginTop: 16 }}>
        <h4>SLA compliance</h4>
        <SlaBar label={sla ? SLA_LABEL[sla.domain] || sla.domain : "SLA"} withinPct={sla?.sla_met_pct || 0} total={sla?.total || 0} />
      </div>

      <div className="analytics-grid" style={{ marginTop: 16 }}>
        <StatTile label="Repeat customers" value={repeat?.repeat_rate_pct != null ? `${repeat.repeat_rate_pct}%` : "—"} sub={repeat ? `${repeat.repeat_customers}/${repeat.total_customers} ordered more than once` : "No orders in range"} />
        <StatTile label="Cancellation rate" value={cancelRefund?.cancelled_pct != null ? `${cancelRefund.cancelled_pct}%` : "—"} sub={cancelRefund ? `${cancelRefund.cancelled_count}/${cancelRefund.total_orders} cancelled` : "No orders in range"} />
        <StatTile label="Refunded" value={money(cancelRefund?.refunded_amount)} sub={cancelRefund?.refund_count ? `${cancelRefund.refund_count} refunds` : "No refunds in range"} />
      </div>

      <div className="analytics-charts-grid">
        {topProducts.length > 0 && (
          <BarChart
            title="Top products by revenue"
            bars={topProducts.map((p) => ({ label: p.item_name, value: p.revenue }))}
            valueFormatter={money}
            emptyText="No paid orders in this range"
          />
        )}
        <BarChart
          title="Peak hours"
          bars={peakHours
            .filter((h) => h.order_count > 0)
            .sort((a, b) => b.order_count - a.order_count)
            .slice(0, 8)
            .map((h) => ({ label: HOUR_LABEL(h.hour_of_day), value: h.order_count }))}
          emptyText="No orders in this range"
        />
      </div>
    </div>
  );
}
