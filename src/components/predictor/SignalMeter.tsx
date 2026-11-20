import { TrendingDown, TrendingUp, Minus } from "lucide-react";

import type { SignalFactor } from "@/lib/api";

/** Weighted composite call gauge + per-factor breakdown bars. */
export function SignalMeter({ factors }: { factors: SignalFactor[] }) {
  if (!factors?.length) return null;

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1;
  const composite = Math.round(
    factors.reduce((s, f) => s + f.score * (f.weight / totalWeight), 0)
  );

  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c - (composite / 100) * c;
  const color = composite >= 70 ? "#22c55e" : composite >= 50 ? "#eab308" : "#f97316";
  const label = composite >= 70 ? "Strong call" : composite >= 50 ? "Moderate call" : "Weak call";

  return (
    <div className="card-surface p-6">
      <div className="flex flex-wrap items-center gap-6">
        <div className="relative size-32 shrink-0">
          <svg viewBox="0 0 128 128" className="size-32 -rotate-90">
            <circle cx="64" cy="64" r={r} fill="none" strokeWidth="11" className="stroke-muted" />
            <circle
              cx="64"
              cy="64"
              r={r}
              fill="none"
              stroke={color}
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={off}
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-extrabold">{composite}</span>
            <span className="px-2 text-center text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
              signal
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold">Confidence meter</h3>
          <p className="text-sm font-bold" style={{ color }}>{label}</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Weighted blend of every factor the engine reads. Not a guarantee —
            a measured read of the room.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3.5">
        {factors.map((f) => (
          <div key={f.name}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 font-bold">
                {f.direction === "bullish" ? (
                  <TrendingUp className="size-3.5 text-success" />
                ) : f.direction === "bearish" ? (
                  <TrendingDown className="size-3.5 text-destructive" />
                ) : (
                  <Minus className="size-3.5 text-muted-foreground" />
                )}
                {f.name}
                <span className="text-[10px] font-medium text-muted-foreground">· {f.weight}% weight</span>
              </span>
              <span className="font-extrabold tabular-nums">{f.score}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  f.direction === "bullish"
                    ? "bg-primary"
                    : f.direction === "bearish"
                      ? "bg-gradient-to-r from-red-500 to-orange-400"
                      : "bg-muted-foreground/50"
                }`}
                style={{ width: `${f.score}%` }}
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">{f.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
