import { MaterialIcon } from "@/components/ui/material-icon";
import { cn } from "@/lib/utils";
import type { RunPhase } from "./useCrashRun";

const PHASE_STYLE: Record<RunPhase, { dot: string; text: string; ring: string }> = {
  idle: { dot: "bg-success", text: "text-success", ring: "rgba(15,118,110,0.5)" },
  drawing: { dot: "bg-warning", text: "text-warning-foreground", ring: "rgba(180,83,9,0.5)" },
  flying: { dot: "bg-secondary", text: "text-secondary", ring: "rgba(46,58,140,0.5)" },
  crashed: { dot: "bg-destructive", text: "text-muted-foreground", ring: "rgba(198,40,40,0.5)" },
  countdown: { dot: "bg-destructive", text: "text-destructive", ring: "rgba(198,40,40,0.5)" },
};

/** Top-right NEXT ROUND indicator — premium glass pill with live countdown bar. */
export function NextRunPanel({
  phase,
  mult,
  countdown,
  glow,
}: {
  phase: RunPhase;
  mult: number;
  countdown: number;
  glow?: string;
}) {
  const st = PHASE_STYLE[phase];
  // countdown runs 5 -> 1, bar depletes as it ticks
  const cdFrac = phase === "countdown" ? Math.max(0, Math.min(1, countdown / 4)) : 0;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border bg-white/90 px-4 pt-2.5 pb-3 shadow-soft backdrop-blur-xl"
      style={glow ? { boxShadow: `0 8px 30px rgba(${glow},0.12), 0 8px 30px rgba(0,0,0,0.08)` } : undefined}
    >
      <div className="flex items-center gap-3">
        <span className="relative flex size-2.5 shrink-0">
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", st.dot)} />
          <span className={cn("relative inline-flex size-2.5 rounded-full", st.dot)} />
        </span>
        <div className="leading-none">
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-muted-foreground">
            {phase === "flying" ? "Live round" : phase === "drawing" ? "Predicting" : "Next round"}
          </p>
          <p className={cn("mt-1 text-xl font-black tabular-nums tracking-tight text-foreground", st.text)}>
            {phase === "idle" && "Ready"}
            {phase === "drawing" && (
              <span className="inline-flex items-center gap-1.5 text-base">
                <MaterialIcon name="progress_activity" className="text-[18px] animate-spin" /> AI working…
              </span>
            )}
            {phase === "flying" && `${mult.toFixed(2)}x`}
            {phase === "crashed" && <span className="text-base text-muted-foreground">Settling…</span>}
            {phase === "countdown" && `${countdown}s`}
          </p>
        </div>
      </div>
      {/* countdown depletion bar */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-muted">
        {phase === "countdown" && (
          <div
            className="h-full rounded-r-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${cdFrac * 100}%`, background: st.ring, boxShadow: `0 0 12px ${st.ring}` }}
          />
        )}
        {phase === "flying" && (
          <div className="h-full w-full animate-pulse" style={{ background: st.ring }} />
        )}
      </div>
    </div>
  );
}

/** Recent predictions strip. */
export function RunHistory({ history }: { history: number[] }) {
  if (history.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {history.map((h, i) => (
        <span
          key={`${h}-${i}`}
          className={cn(
            "rounded-lg px-2.5 py-1 text-xs font-black tabular-nums",
            i === 0 && "ring-1 ring-border",
            h < 2
              ? "bg-destructive/10 text-destructive"
              : h < 10
                ? "bg-muted text-foreground"
                : "bg-success/10 text-success"
          )}
          style={{ opacity: 1 - i * 0.07 }}
        >
          {h.toFixed(2)}x
        </span>
      ))}
    </div>
  );
}
