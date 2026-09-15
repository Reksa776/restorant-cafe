"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ============================================================
// Analytics chart primitives (recharts).
//
// Every chart here is a PURE presentation component: it receives data that was
// already aggregated server-side and never derives business metrics itself.
// Money formatting and colours are shared so the dashboard reads as one
// surface (dark slate for revenue, blue for counts, explicit palette for
// categorical breakdowns).
// ============================================================

const RUPIAH = (v: unknown) =>
  `Rp${Math.round(Number(v) || 0).toLocaleString("id-ID")}`;

/** Axis-friendly money label (Rp1,2jt / Rp150rb). */
const COMPACT_RUPIAH = (v: number) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `Rp${Math.round(n / 1_000)}rb`;
  return `Rp${n}`;
};

export const CHART_COLORS = [
  "#111827",
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#65a30d",
];

const AXIS_TICK = { fontSize: 11, fill: "#6b7280" } as const;

const TOOLTIP_PROPS = {
  contentStyle: {
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
    fontSize: 12,
    padding: "8px 10px",
  },
  labelStyle: { fontWeight: 600, marginBottom: 4, color: "#374151" },
} as const;

const DAY_LABEL = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
});

/** Short axis label for a `YYYY-MM-DD` day key (parsed as a local day). */
function formatDayShort(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime()) ? key : DAY_LABEL.format(d);
}

/** Full tooltip label for a `YYYY-MM-DD` day key. */
function formatDayFull(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
}

// ------------------------------------------------------------
// Daily trends
// ------------------------------------------------------------

export interface SalesTrendPoint {
  date: string;
  orders: number;
  sales: number;
}

/** Sales (area, left axis) + order count (line, right axis) per day. */
export function SalesTrendChart({ data }: { data: SalesTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="salesTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#111827" stopOpacity={0.24} />
            <stop offset="95%" stopColor="#111827" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayShort}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          yAxisId="sales"
          tickFormatter={COMPACT_RUPIAH}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={62}
        />
        <YAxis
          yAxisId="orders"
          orientation="right"
          allowDecimals={false}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={34}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          labelFormatter={(label) => formatDayFull(String(label))}
          formatter={(value, name) =>
            String(name) === "Penjualan"
              ? RUPIAH(value)
              : `${Number(value)} order`
          }
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
        <Area
          yAxisId="sales"
          type="monotone"
          dataKey="sales"
          name="Penjualan"
          stroke="#111827"
          strokeWidth={2}
          fill="url(#salesTrendFill)"
        />
        <Line
          yAxisId="orders"
          type="monotone"
          dataKey="orders"
          name="Order"
          stroke="#2563eb"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface PurchasingTrendPoint {
  date: string;
  purchases: number;
  value: number;
}

/** Purchase value (bars) + purchase count (line, right axis) per day. */
export function PurchasingTrendChart({
  data,
}: {
  data: PurchasingTrendPoint[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayShort}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          yAxisId="value"
          tickFormatter={COMPACT_RUPIAH}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={62}
        />
        <YAxis
          yAxisId="count"
          orientation="right"
          allowDecimals={false}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={34}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          labelFormatter={(label) => formatDayFull(String(label))}
          formatter={(value, name) =>
            String(name) === "Nilai Pembelian"
              ? RUPIAH(value)
              : `${Number(value)} pembelian`
          }
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
        <Bar
          yAxisId="value"
          dataKey="value"
          name="Nilai Pembelian"
          fill="#0891b2"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
        />
        <Line
          yAxisId="count"
          type="monotone"
          dataKey="purchases"
          name="Jumlah"
          stroke="#111827"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------
// Categorical breakdowns
// ------------------------------------------------------------

/** Donut chart with a value legend (used for payment + order type). */
export function BreakdownDonut({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value, name) => [RUPIAH(value), String(name)]}
        />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="52%"
          outerRadius="80%"
          paddingAngle={2}
          stroke="#ffffff"
          strokeWidth={2}
        >
          {data.map((entry, index) => (
            <Cell
              key={entry.name}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
            />
          ))}
        </Pie>
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value) =>
            // Legend label with the rendered amount, so the donut is readable
            // without hovering.
            `${value} — ${RUPIAH(
              data.find((d) => d.name === value)?.value ?? 0
            )}`
          }
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Vertical bars for a small categorical set (payment method / order type). */
export function CategoryBarChart({
  data,
  height = 280,
}: {
  data: Array<{ name: string; value: number; count?: number }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="name"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
          tickFormatter={COMPACT_RUPIAH}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={62}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value) => [RUPIAH(value), "Nilai"]}
        />
        <Bar dataKey="value" name="Nilai" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((entry, index) => (
            <Cell
              key={entry.name}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal ranked bars — the readable option for long product/category names. */
export function RankedBarChart({
  data,
  height = 280,
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={132}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value) => [`${Number(value)} terjual`, "Jumlah"]}
        />
        <Bar dataKey="value" name="Terjual" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {data.map((entry, index) => (
            <Cell
              key={entry.name}
              fill={index === 0 ? "#111827" : CHART_COLORS[(index % 5) + 1]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------
// Peak hours
// ------------------------------------------------------------

/**
 * Orders per hour of day (bars, left axis) with revenue (line, right axis).
 *
 * NOTE — the hour buckets come from the report engine's existing
 * `HOUR(createdAt)` aggregation (a DB-side grouping); this chart does NOT
 * re-derive or shift the timezone.
 */
export function PeakHoursChart({
  data,
}: {
  data: Array<{ hour: number; orders: number; revenue: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="hour"
          tickFormatter={(h: number) => `${String(h).padStart(2, "0")}:00`}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          interval={1}
        />
        <YAxis
          yAxisId="orders"
          allowDecimals={false}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={34}
        />
        <YAxis
          yAxisId="revenue"
          orientation="right"
          tickFormatter={COMPACT_RUPIAH}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={62}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          labelFormatter={(label) =>
            `Pukul ${String(label).padStart(2, "0")}:00`
          }
          formatter={(value, name) =>
            String(name) === "Order" ? `${Number(value)} order` : RUPIAH(value)
          }
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
        <Bar
          yAxisId="orders"
          dataKey="orders"
          name="Order"
          fill="#2563eb"
          radius={[4, 4, 0, 0]}
          maxBarSize={34}
        />
        <Line
          yAxisId="revenue"
          type="monotone"
          dataKey="revenue"
          name="Penjualan"
          stroke="#111827"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
