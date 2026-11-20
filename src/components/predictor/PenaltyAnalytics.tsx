import { useState } from "react";
import { type ZoneStat } from "@/lib/api";
import { Panel, StatCard, DemoBadge, Skeleton, fmt, fmtInt } from "./terminal";
import { RateBars, DonutStat } from "./charts";

const ZONE_ORDER = [
  "upper-left", "upper-center", "upper-right",
  "middle-left", "middle-center", "middle-right",
  "lower-left", "lower-center", "lower-right",
];

const ZONE_SHORT: Record<string, string> = {
  "upper-left": "UL", "upper-center": "UC", "upper-right": "UR",
  "middle-left": "ML", "middle-center": "MC", "middle-right": "MR",
  "lower-left": "LL", "lower-center": "LC", "lower-right": "LR",
};

export function PenaltyAnalytics({ gameName, initialZones = [] }: { gameName: string; initialZones?: ZoneStat[] }) {
  const [zones] = useState<ZoneStat[]>(initialZones);
  const [selected, setSelected] = useState<string>("middle-center");
  const window = 120;

  const byId = Object.fromEntries((zones ?? []).map((z) => [z.zone, z]));
  const sel = byId[selected];
  const ranked = [...(zones ?? [])].sort((a, b) => b.goalRate - a.goalRate);
  const totalShots = (zones ?? []).reduce((a, z) => a + z.shots, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* goal mouth */}
        <Panel
          title="Goal-mouth analyser"
          subtitle="Tap a zone to inspect its historical record. Colour = goal rate."
          action={<DemoBadge />}
        >
          {!zones ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              <GoalMouth byId={byId} selected={selected} onSelect={setSelected} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {fmtInt(totalShots)} simulated shots across 9 zones · last {window} rounds. Corner zones
                historically convert best — but this is a simulated keeper model, not a real goalkeeper's habits.
              </p>
            </>
          )}
        </Panel>

        {/* selected zone detail */}
        <Panel title="Zone detail" subtitle={selected ? `Historical record for ${selected.replace("-", " ")}` : undefined}>
          {!sel ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="space-y-4">
              <DonutStat pct={sel.goalRate} label={`goal rate · ${fmtInt(sel.shots)} shots`} color="#22d3ee" />
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Shots" value={fmtInt(sel.shots)} />
                <StatCard label="Goals" value={fmtInt(sel.goals)} tone="up" />
                <StatCard
                  label="95% Wilson interval"
                  value={`${fmt(sel.wilson.lower, 1)}–${fmt(sel.wilson.upper, 1)}%`}
                  sub="Uncertainty on the goal rate"
                />
                <StatCard label="Save rate" value={`${fmt(100 - sel.goalRate, 1)}%`} tone="warn" sub="Keeper stops + misses" />
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ranking */}
      <Panel
        title="Zone ranking"
        subtitle="Ranked by observed goal rate. Small samples are flagged — never trust a 100% rate from 3 shots."
      >
        {!zones ? (
          <Skeleton className="h-56" />
        ) : (
          <RateBars
            data={ranked.map((z) => ({
              label: `${ZONE_SHORT[z.zone] ?? z.zone} — ${z.zone.replace("-", " ")}`,
              value: z.goalRate,
              sub: `${fmtInt(z.shots)} shots${z.shots < 10 ? " · small sample" : ""}`,
            }))}
            color="#3b82f6"
          />
        )}
        <p className="mt-4 rounded-xl border border-border bg-white p-3 text-[11px] leading-relaxed text-muted-foreground">
          Limitations: raw historical goal rate is not a model-adjusted probability. A real recommendation
          engine would need per-shooter and per-keeper event data — none exists here, so the entire analysis
          illustrates the method — it is not a scouting report.
        </p>
      </Panel>
    </div>
  );
}

function GoalMouth({ byId, selected, onSelect }: {
  byId: Record<string, ZoneStat>;
  selected: string;
  onSelect: (z: string) => void;
}) {
  const W = 360, H = 220;
  const cw = W / 3, ch = H / 3;
  const maxRate = Math.max(1, ...Object.values(byId).map((z) => z.goalRate));

  const colorFor = (rate: number) => {
    const t = rate / maxRate;
    // slate -> cyan scale
    const r = Math.round(30 + t * 30);
    const g = Math.round(41 + t * 170);
    const b = Math.round(59 + t * 150);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label="Goal mouth zone map">
      {/* frame */}
      <rect x="4" y="4" width={W - 8} height={H - 8} rx="10" fill="#0d1424" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
      {ZONE_ORDER.map((zone, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const z = byId[zone];
        const rate = z?.goalRate ?? 0;
        const isSel = zone === selected;
        return (
          <g key={zone} onClick={() => onSelect(zone)} className="cursor-pointer">
            <rect
              x={col * cw + 8} y={row * ch + 8}
              width={cw - 16} height={ch - 16} rx="8"
              fill={colorFor(rate)}
              stroke={isSel ? "#22d3ee" : "rgba(255,255,255,0.12)"}
              strokeWidth={isSel ? 3 : 1.5}
              className="transition-all duration-200 hover:brightness-125"
            />
            <text x={col * cw + cw / 2} y={row * ch + ch / 2 - 6} textAnchor="middle" fill="#fff" fontSize="15" fontWeight="800">
              {ZONE_SHORT[zone]}
            </text>
            <text x={col * cw + cw / 2} y={row * ch + ch / 2 + 14} textAnchor="middle" fill="rgba(255,255,255,0.75)" fontSize="11" fontWeight="700">
              {z ? `${rate.toFixed(0)}%` : "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
