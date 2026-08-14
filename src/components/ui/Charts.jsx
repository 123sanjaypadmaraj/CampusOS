import React, { useId, useMemo, useState } from "react";

/**
 * Small, dependency-free SVG chart primitives for the analytics dashboards
 * (admin + vendor). No charting library is installed in this project, and
 * these dashboards only ever need a single-series trend line or a single
 * magnitude bar per category -- both are simple enough to hand-roll and it
 * keeps the bundle free of a new dependency.
 *
 * Colors are drawn entirely from the app's existing CSS custom properties
 * (--accent/--text/--muted/--border, set in src/index.css and swapped by
 * .dark-mode) so charts follow the app's own light/dark toggle instead of
 * carrying a second hardcoded palette.
 */

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 16, right: 16, bottom: 26, left: 40 };

function formatDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A single-series trend line with a hover crosshair + tooltip. `points` is
// [{ x: dateString, y: number }]. One series needs no legend (the chart
// title already names it) -- see dataviz skill, "final accessibility pass".
export function TrendChart({ points = [], title, valueFormatter = (v) => String(v), emptyText = "No data yet" }) {
  const gid = useId();
  const [hover, setHover] = useState(null);

  const clean = points.map((p) => ({ x: p.x, y: Number(p.y) || 0 }));
  const maxY = Math.max(1, ...clean.map((p) => p.y));

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const coords = useMemo(
    () =>
      clean.map((p, i) => ({
        ...p,
        px: PAD.left + (clean.length > 1 ? (i / (clean.length - 1)) * plotW : plotW / 2),
        py: PAD.top + plotH - (p.y / maxY) * plotH,
      })),
    [clean, maxY, plotW, plotH]
  );

  if (!clean.length || clean.every((p) => p.y === 0)) {
    return (
      <div className="chart-card">
        {title && <h4>{title}</h4>}
        <div className="chart-empty">{emptyText}</div>
      </div>
    );
  }

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.px.toFixed(1)},${c.py.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1].px.toFixed(1)},${PAD.top + plotH} L${coords[0].px.toFixed(1)},${PAD.top + plotH} Z`;

  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((maxY / tickCount) * i));

  const handleMove = (evt) => {
    const svg = evt.currentTarget;
    const rect = svg.getBoundingClientRect();
    const relX = ((evt.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let best = Infinity;
    coords.forEach((c, i) => {
      const d = Math.abs(c.px - relX);
      if (d < best) { best = d; nearest = i; }
    });
    setHover(nearest);
  };

  const active = hover != null ? coords[hover] : null;

  return (
    <div className="chart-card">
      {title && <h4>{title}</h4>}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="chart-svg"
        role="img"
        aria-label={title}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t, i) => {
          const y = PAD.top + plotH - (t / maxY) * plotH;
          return (
            <g key={i}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart-gridline" />
              <text x={PAD.left - 8} y={y + 3} className="chart-axis-label" textAnchor="end">
                {t}
              </text>
            </g>
          );
        })}

        {coords.map((c, i) =>
          i % Math.ceil(coords.length / 6 || 1) === 0 ? (
            <text key={i} x={c.px} y={HEIGHT - 6} className="chart-axis-label" textAnchor="middle">
              {formatDay(c.x)}
            </text>
          ) : null
        )}

        <path d={areaPath} fill={`url(#${gid}-fill)`} stroke="none" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {active && (
          <line x1={active.px} x2={active.px} y1={PAD.top} y2={PAD.top + plotH} className="chart-crosshair" />
        )}
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.px}
            cy={c.py}
            r={hover === i ? 5 : 3}
            fill="var(--surface)"
            stroke="var(--accent)"
            strokeWidth="2"
            style={{ transition: "r .1s ease" }}
          />
        ))}
      </svg>
      {active && (
        <div className="chart-tooltip" style={{ left: `${(active.px / WIDTH) * 100}%` }}>
          <b>{valueFormatter(active.y)}</b>
          <span>{formatDay(active.x)}</span>
        </div>
      )}
    </div>
  );
}

// A magnitude bar chart (single sequential hue -- category identity isn't
// the point here, size is), with a per-bar hover tooltip.
export function BarChart({ bars = [], title, valueFormatter = (v) => String(v), emptyText = "No data yet" }) {
  const [hover, setHover] = useState(null);
  const clean = bars.map((b) => ({ label: b.label, value: Number(b.value) || 0 }));
  const maxV = Math.max(1, ...clean.map((b) => b.value));

  if (!clean.length) {
    return (
      <div className="chart-card">
        {title && <h4>{title}</h4>}
        <div className="chart-empty">{emptyText}</div>
      </div>
    );
  }

  return (
    <div className="chart-card">
      {title && <h4>{title}</h4>}
      <div className="chart-bars">
        {clean.map((b, i) => (
          <div
            key={b.label + i}
            className="chart-bar-row"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          >
            <span className="chart-bar-label">{b.label}</span>
            <div className="chart-bar-track">
              <div
                className="chart-bar-fill"
                style={{ width: `${Math.max(2, (b.value / maxV) * 100)}%`, opacity: hover === null || hover === i ? 1 : 0.45 }}
              />
            </div>
            <span className="chart-bar-value">{valueFormatter(b.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// SLA status bar: a two-segment "within SLA / breached" strip. Status
// colors are reserved (good/critical) and always carry a text label, never
// color alone.
export function SlaBar({ label, withinPct, total }) {
  const pct = total > 0 ? Math.round(withinPct) : null;
  return (
    <div className="sla-row">
      <div className="sla-row-head">
        <b>{label}</b>
        <span>{pct == null ? "No completed items yet" : `${pct}% within SLA`}</span>
      </div>
      <div className="sla-track">
        <div
          className={pct == null ? "sla-fill sla-fill-empty" : pct >= 80 ? "sla-fill sla-fill-good" : pct >= 50 ? "sla-fill sla-fill-warn" : "sla-fill sla-fill-critical"}
          style={{ width: `${pct == null ? 0 : pct}%` }}
        />
      </div>
    </div>
  );
}

export function StatTile({ label, value, sub }) {
  return (
    <div className="stat-card">
      <small>{label}</small>
      <b>{value}</b>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
