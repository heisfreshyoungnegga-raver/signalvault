import { useState } from "react";
import { type ActionZoneMetric } from "@/lib/api";
import { Panel, DemoBadge, Skeleton, Field, inputCls, fmt, fmtInt } from "./terminal";
import { RateBars, DonutStat } from "./charts";
import { cn } from "@/lib/utils";

type Metric = "hotRate" | "smoothedRate" | "frequency";

const METRICS: { key: Metric; label: string; desc: string }[] = [
  { key: "hotRate", label: "Hot rate", desc: "Raw % of rounds each zone ran hot." },
  { key: "smoothedRate", label: "Smoothed rate", desc: "Shrunk toward the 20% baseline — safer on small samples." },
  { key: "frequency", label: "Round share", desc: "Share of all recorded rounds per zone." },
];

export function ActionAnalytics({ initialZones = [] }: { initialZones?: ActionZoneMetric[] }) {
  const [zones] = useState<ActionZoneMetric[]>(initialZones);
  const [metric, setMetric] = useState<Metric>("smoothedRate");
  const [selected, setSelected] = useState<string | null>(initialZones[0]?.zone ?? null);

  const totalRounds = (zones ?? []).reduce((a, z) => a + z.rounds, 0);
  const val = (z: ActionZoneMetric) =>
    metric === "hotRate" ? z.hotRate : metric === "smoothedRate" ? z.smoothedRate : (z.rounds / Math.max(1, totalRounds)) * 100;
  const ranked = [...(zones ?? [])].sort((a, b) => val(b) - val(a));
  const sel = (zones ?? []).find((z) => z.zone === selected);
  const maxV = Math.max(1, ...ranked.map(val));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Zone heatmap" subtitle="Tap a zone to inspect it. Colour intensity = selected metric." action={<DemoBadge />}>
          {!zones ? (
            <Skeleton className="h-56" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                {zones.map((z) => {
                  const v = val(z);
                  const t = v / maxV;
                  const isSel = z.zone === selected;
                  return (
                    <button
                      key={z.zone}
                      onClick={() => setSelected(z.zone)}
                      className={cn(
                        "rounded-xl border p-3 text-center transition",
                        isSel ? "border-secondary/50 shadow-[0_0_18px_rgba(46,58,140,0.2)]" : "border-border hover:border-border"
                      )}
                      style={{ background: `rgba(34,211,238,${0.04 + t * 0.22})` }}
                    >
                      <p className="text-sm font-extrabold capitalize text-foreground">{z.zone}</p>
                      <p className="mt-1 text-lg font-extrabold tabular-nums text-secondary">{fmt(v, 1)}%</p>
                      <p className="text-[10px] font-semibold text-muted-foreground">{fmtInt(z.rounds)} rounds</p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Field label="Heatmap metric">
                  <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className={inputCls}>
                    {METRICS.map((m) => (
                      <option key={m.key} value={m.key}>{m.label} — {m.desc}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Zone detail" subtitle={sel ? `Strike zone ${sel.zone}` : undefined}>
          {!sel ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="space-y-4">
              <DonutStat pct={sel.smoothedRate} label="smoothed hot rate" color="#22d3ee" />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-border bg-card p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Rounds</dt>
                  <dd className="mt-1 text-lg font-extrabold tabular-nums text-foreground">{fmtInt(sel.rounds)}</dd>
                </div>
                <div className="rounded-xl border border-border bg-card p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hot rounds</dt>
                  <dd className="mt-1 text-lg font-extrabold tabular-nums text-foreground">{fmtInt(sel.hotCount)}</dd>
                </div>
                <div className="rounded-xl border border-border bg-card p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Raw hot rate</dt>
                  <dd className="mt-1 text-lg font-extrabold tabular-nums text-foreground">{fmt(sel.hotRate, 1)}%</dd>
                </div>
                <div className="rounded-xl border border-border bg-card p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">95% Wilson interval</dt>
                  <dd className="mt-1 text-lg font-extrabold tabular-nums text-foreground">{fmt(sel.wilson.lower, 1)}–{fmt(sel.wilson.upper, 1)}%</dd>
                </div>
              </dl>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Zone ranking"
        subtitle="Ranked by the selected metric. Smoothing pulls thin samples toward the baseline so a 2-round fluke can't top the board."
      >
        {!zones ? (
          <Skeleton className="h-48" />
        ) : (
          <RateBars
            data={ranked.map((z) => ({
              label: `Zone ${z.zone}`,
              value: val(z),
              sub: `${fmtInt(z.rounds)} rounds`,
            }))}
            color="#22d3ee"
          />
        )}
        <p className="mt-4 rounded-xl border border-border bg-white p-3 text-[11px] leading-relaxed text-muted-foreground">
          If every zone's outcomes are independent with equal probability, historical hot and cold zones are
          variance, not edge — the heatmap describes the sample dataset; it does not predict the next round.
        </p>
      </Panel>
    </div>
  );
}
