import React, { useEffect, useState } from "react";
import { LoadingState, ErrorState } from "../../components/ui/States";
import { TrendChart, BarChart, SlaBar, StatTile } from "../../components/ui/Charts";
import { supabase } from "../../lib/supabase";

const RANGES = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
];

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

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [dauSeries, gmvSeries, canteens, slaSummary, wauCount, mauCount] = await Promise.all([
        rpc("admin_dau_series", { p_campus_id: campusId, p_days: days }),
        rpc("admin_gmv_series", { p_campus_id: campusId, p_days: days }),
        rpc("admin_top_canteens_gmv", { p_campus_id: campusId, p_days: days }),
        rpc("admin_sla_summary", { p_campus_id: campusId, p_days: days }),
        rpc("admin_active_users_window", { p_campus_id: campusId, p_days: 7 }),
        rpc("admin_active_users_window", { p_campus_id: campusId, p_days: 30 }),
      ]);
      setDau(dauSeries || []);
      setGmv(gmvSeries || []);
      setTopCanteens((canteens || []).filter((c) => c.orders_count > 0));
      setSla(slaSummary || []);
      setWau(wauCount || 0);
      setMau(mauCount || 0);
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
        <StatTile label={`GMV (${days}d)`} value={money(totalGmv)} sub={`${totalOrders} paid orders`} />
        <StatTile label="AOV" value={money(overallAov)} sub="Average order value" />
        <StatTile
          label="Ticket SLA"
          value={ticketSla?.sla_met_pct != null ? `${ticketSla.sla_met_pct}%` : "—"}
          sub={ticketSla?.total ? `${ticketSla.total} tickets in range` : "No tickets in range"}
        />
      </div>

      <div className="analytics-charts-grid">
        <TrendChart title="Daily active users" points={dau.map((d) => ({ x: d.day, y: d.dau }))} valueFormatter={(v) => `${v} active`} />
        <TrendChart title="GMV per day" points={gmv.map((d) => ({ x: d.day, y: d.gmv }))} valueFormatter={money} />
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
    </div>
  );
}
