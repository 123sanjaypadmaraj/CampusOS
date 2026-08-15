import React, { useEffect, useState } from "react";
import { LoadingState, ErrorState } from "../../components/ui/States";
import { TrendChart, SlaBar, StatTile } from "../../components/ui/Charts";
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

// Scoped entirely server-side to whatever the caller owns (their canteen,
// the print shop, or a campus store) -- see vendor_gmv_series()/
// vendor_sla_summary() in supabase/migrations/20260814005000_analytics.sql
// (extended for stores in 20260815000900_..._variants_stock_analytics.sql).
// Same component serves all three vendor types; the SLA domain returned
// tells us which one this is.
export default function VendorAnalytics() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [gmv, setGmv] = useState([]);
  const [sla, setSla] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [gmvSeries, slaSummary] = await Promise.all([
        rpc("vendor_gmv_series", { p_days: days }),
        rpc("vendor_sla_summary", { p_days: days }),
      ]);
      setGmv(gmvSeries || []);
      setSla((slaSummary && slaSummary[0]) || null);
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
    </div>
  );
}
