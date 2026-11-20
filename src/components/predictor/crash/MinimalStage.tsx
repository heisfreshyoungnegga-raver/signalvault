import type { CrashRun } from "./useCrashRun";
import { GAME_PAGE_THEMES } from "./gameThemes";
import { cn } from "@/lib/utils";

const BAR: Record<string, string> = {
  aviator: "bg-red-500",
  "sporty-jet": "bg-secondary",
  sportyhero: "bg-primary",
  "test-flight": "bg-success",
};

const SOLID: Record<string, string> = {
  aviator: "text-red-500",
  "sporty-jet": "text-secondary",
  sportyhero: "text-primary",
  "test-flight": "text-success",
};

/**
 * Minimal crash stage: just the crash-point value, huge, in the middle.
 * A whisper of glow, a hairline progress bar, nothing else.
 */
export function MinimalStage({ run, gameId, compact }: { run: CrashRun; gameId: string; compact?: boolean | undefined }) {
  const { phase, mult, draw, rtp, setRtp, countdown } = run;
  const gt = GAME_PAGE_THEMES[gameId] ?? GAME_PAGE_THEMES["aviator"]!;
  const glow = gt.glow;
  const bar = BAR[gameId] ?? BAR["aviator"]!;
  const solid = SOLID[gameId] ?? SOLID["aviator"]!;
  const crashedWord = gt.crashedWord;
  const target = draw?.crash ?? 2;
  const crashed = phase === "crashed";
  const counting = phase === "countdown";
  const active = phase === "drawing" || phase === "flying";

  const frac = draw
    ? Math.min(1, Math.log(Math.max(mult, 1)) / Math.log(Math.max(target, 1.01)))
    : 0;
  // heat: glow intensifies as the multiplier climbs
  const heat = Math.min(1, Math.log10(Math.max(mult, 1)) / 1.2);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-white">
      {/* faint ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{ background: `radial-gradient(ellipse at 50% 55%, rgba(${glow},${0.08 + heat * 0.14}), transparent 65%)` }}
      />
      {crashed && (
        <div className="pointer-events-none absolute inset-0 animate-[crashflash_0.6s_ease-out]" style={{ background: `rgba(${glow},0.12)` }} />
      )}

      <div className={cn(
        "relative flex flex-col items-center justify-center px-4",
        compact ? "min-h-[260px] py-8" : "min-h-[380px] px-6 py-14 md:min-h-[440px]"
      )}>
        {counting ? (
          <>
            <p className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-muted-foreground">
              Next round in
            </p>
            <p
              key={countdown}
              className="animate-[countpop_0.9s_ease-out] font-black tabular-nums leading-none tracking-tighter text-foreground"
              style={{
                fontSize: compact ? "clamp(4.5rem, 18vw, 6.5rem)" : "clamp(6rem, 22vw, 13rem)",
                textShadow: `0 0 90px rgba(${glow},0.55)`,
              }}
            >
              {countdown}
            </p>
            <div className="mt-8 h-[3px] w-56 overflow-hidden rounded-full bg-muted md:w-72">
              <div
                className={cn("h-full rounded-full", bar)}
                style={{ width: `${(countdown / 5) * 100}%`, boxShadow: `0 0 12px rgba(${glow},0.8)` }}
              />
            </div>
          </>
        ) : (
          <>
        {/* status */}
        <p className="mb-6 h-5 text-[11px] font-black uppercase tracking-[0.3em] text-muted-foreground">
          {phase === "idle" && "Ready"}
          {phase === "drawing" && <span className={cn("animate-pulse", solid)}>{"Drawing"}…</span>}
          {phase === "flying" && <span className={solid}>{"Flying"}</span>}
          {phase === "crashed" && <span className="text-destructive">{crashedWord} @ {target.toFixed(2)}x</span>}
        </p>

        {/* the number */}
        <p
          className={cn(
            "font-black tabular-nums leading-none tracking-tighter transition-colors duration-200",
            crashed ? "text-destructive" : "text-foreground",
            crashed && "animate-[numpop_0.45s_cubic-bezier(0.2,1.4,0.4,1)]"
          )}
          style={{
            fontSize: compact ? "clamp(4rem, 17vw, 6rem)" : "clamp(5.5rem, 20vw, 12rem)",
            textShadow: crashed
              ? `0 0 90px rgba(239,68,68,0.65)`
              : `0 0 ${30 + heat * 70}px rgba(${glow},${0.25 + heat * 0.45})`,
            transform: active ? `scale(${1 + heat * 0.05})` : undefined,
          }}
        >
          {mult.toFixed(2)}
          <span className={cn("align-top", crashed ? "text-destructive/80" : "text-muted-foreground")} style={{ fontSize: "0.35em" }}>
            x
          </span>
        </p>

        {/* hairline progress */}
        <div className="mt-8 h-[3px] w-56 overflow-hidden rounded-full bg-muted md:w-72">
          <div
            className={cn("h-full rounded-full transition-none", bar)}
            style={{ width: `${(phase === "idle" ? 0 : frac) * 100}%`, boxShadow: `0 0 12px rgba(${glow},0.8)` }}
          />
        </div>
          </>
        )}

        {/* lab RTP control stays minimal */}
        {gameId === "test-flight" && (
          <div className="mt-8 w-full max-w-xs">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <span>RTP</span>
              <span className="text-sm font-black tabular-nums text-success">{(rtp * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range" min={90} max={99} step={0.5}
              value={rtp * 100}
              disabled={phase !== "idle"}
              onChange={(e) => setRtp(Number(e.target.value) / 100)}
              className="mt-2 w-full accent-primary disabled:opacity-40"
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes crashflash { 0% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes numpop { 0% { transform: scale(1.18); } 100% { transform: scale(1); } }
        @keyframes countpop { 0% { transform: scale(1.25); opacity: 0.4; } 30% { opacity: 1; } 100% { transform: scale(1); } }
      `}</style>
    </div>
  );
}
