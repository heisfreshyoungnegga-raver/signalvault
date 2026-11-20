import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  ReferenceLine,
} from "recharts";

const axisTick = { fill: "#64748b", fontSize: 11, fontWeight: 600 } as const;

const tooltipStyle = {
  backgroundColor: "#0d1424",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  fontSize: 12,
  color: "#e2e8f0",
} as const;

export function MultiplierHistogram({ data }: {
  data: { range: string; count: number; highlight?: boolean }[];
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="range" tick={axisTick} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#3b82f6" fillOpacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EquityChart({ data }: { data: { i: number; equity: number }[] }) {
  const positive = (data[data.length - 1]?.equity ?? 0) >= 0;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="i" tick={axisTick} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} tickFormatter={(v: number) => `${v}`} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${Number(v).toFixed(2)}`, "Equity"]} labelFormatter={(l: any) => `Round ${l}`} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="equity"
            stroke={positive ? "#34d399" : "#f87171"}
            strokeWidth={2}
            fill={positive ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RateBars({ data, color = "#22d3ee" }: {
  data: { label: string; value: number; sub?: string }[];
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-xs font-bold text-muted-foreground">{d.label}</span>
            <span className="text-xs font-extrabold tabular-nums text-foreground">
              {d.value.toFixed(1)}%{d.sub && <span className="ml-1.5 font-semibold text-muted-foreground">{d.sub}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (d.value / max) * 100)}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DonutStat({ pct, label, color = "#22d3ee" }: { pct: number; label: string; color?: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
        <circle
          cx="42" cy="42" r={r} fill="none"
          stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * Math.min(100, Math.max(0, pct))) / 100}
          className="transition-all duration-700"
        />
      </svg>
      <div>
        <p className="text-2xl font-extrabold tabular-nums text-foreground">{pct.toFixed(1)}%</p>
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
