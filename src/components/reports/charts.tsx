"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatMoney } from "@/lib/domain/money";

/** Categorical slots (validated reference palette, light mode). Order is fixed. */
const SERIES = ["#2a78d6", "#eb6834"] as const;
const GRID = "#e6e7ea";
const AXIS_TEXT = "#6b6f76";

const dayLabel = (d: string) => format(parseISO(d), "d MMM");

type Fmt = (v: number) => string;

function ChartTooltip({ active, payload, label, fmt }: TooltipContentProps<number, string> & { fmt: Fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{typeof label === "string" && /^\d{4}-/.test(label) ? format(parseISO(label), "EEE d MMM yyyy") : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="tabular ml-auto pl-3 font-medium">{fmt(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: i.color, height: 3 }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

const tickInterval = (n: number) => (n <= 10 ? 0 : Math.ceil(n / 8) - 1);

export function RevenueProfitChart({ data, currency }: { data: { day: string; revenue: number; profit: number }[]; currency: string }) {
  const fmt = (v: number) => formatMoney(v, currency);
  const compact = (v: number) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
  return (
    <div className="space-y-2">
      <Legend items={[{ label: "Revenue", color: SERIES[0] }, { label: "Estimated profit", color: SERIES[1] }]} />
      <div className="h-64" role="img" aria-label="Daily revenue and estimated profit">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" tickFormatter={dayLabel} interval={tickInterval(data.length)} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={false} width={56} />
            <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} fmt={fmt} />} cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} />
            <Area isAnimationActive={false} type="monotone" dataKey="revenue" name="Revenue" stroke={SERIES[0]} strokeWidth={2} fill={SERIES[0]} fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} />
            <Area isAnimationActive={false} type="monotone" dataKey="profit" name="Estimated profit" stroke={SERIES[1]} strokeWidth={2} fill={SERIES[1]} fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DailyColumns({
  data,
  dataKey,
  name,
  fmt,
  ariaLabel,
}: {
  data: Record<string, number | string>[];
  dataKey: string;
  name: string;
  fmt: "count" | "grams";
  ariaLabel: string;
}) {
  const f: Fmt = fmt === "grams" ? (v) => `${Math.round(v * 10) / 10} g` : (v) => String(v);
  return (
    <div className="h-48" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="day" tickFormatter={dayLabel} interval={tickInterval(data.length)} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis allowDecimals={fmt === "grams"} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} fmt={f} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Bar isAnimationActive={false} dataKey={dataKey} name={name} fill={SERIES[0]} maxBarSize={24} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProductionColumns({ data }: { data: { day: string; printed: number; failed: number }[] }) {
  return (
    <div className="space-y-2">
      <Legend items={[{ label: "Printed", color: SERIES[0] }, { label: "Failed", color: SERIES[1] }]} />
      <div className="h-48" role="img" aria-label="Production jobs printed and failed per day">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" tickFormatter={dayLabel} interval={tickInterval(data.length)} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={false} width={32} />
            <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} fmt={(v) => String(v)} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar isAnimationActive={false} dataKey="printed" name="Printed" stackId="p" fill={SERIES[0]} maxBarSize={24} stroke="#fff" strokeWidth={1} />
            <Bar isAnimationActive={false} dataKey="failed" name="Failed" stackId="p" fill={SERIES[1]} maxBarSize={24} radius={[4, 4, 0, 0]} stroke="#fff" strokeWidth={1} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
