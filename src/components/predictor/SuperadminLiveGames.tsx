import { useCrashRun } from "@/components/predictor/crash/useCrashRun";
import { NextRunPanel, RunHistory } from "@/components/predictor/crash/panels";
import { GAME_PAGE_THEMES } from "@/components/predictor/crash/gameThemes";

// Aviator is the only crash engine (owner order 2026-11-20).
const GAMES = [{ id: "aviator", name: "Aviator" }];

function LiveGameCard({ gameId, name }: { gameId: string; name: string }) {
  // Staff preview: send the staff token first (see useCrashRun) so a
  // lingering user token in the same tab can't shadow the staff bypass
  // and 403 every preview round.
  const run = useCrashRun(gameId, true);
  const gt = GAME_PAGE_THEMES[gameId] ?? GAME_PAGE_THEMES["aviator"]!;
  // auto-start the loop so superadmin sees live rounds
  if (!run.looping && !run.error && run.phase === "idle") {
    run.run();
  }
  return (
    <div
      className="rounded-3xl border border-border bg-white p-5 backdrop-blur-xl"
      style={{ boxShadow: `0 8px 30px rgba(${gt.glow},0.08)` }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground">Crash · Live</p>
          <h3 className="text-lg font-extrabold text-foreground">{name}</h3>
        </div>
        <NextRunPanel phase={run.phase} mult={run.mult} countdown={run.countdown} glow={gt.glow} />
      </div>
      <div className="rounded-2xl bg-white p-4 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground">Predicted crash point</p>
        <p
          className="mt-1 text-4xl font-black tabular-nums tracking-tight"
          style={{ color: `rgb(${gt.glow})`, textShadow: `0 0 24px rgba(${gt.glow},0.5)` }}
        >
          {run.draw ? `${run.draw.crash.toFixed(2)}x` : "—"}
        </p>
        {run.draw && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Provably fair · seed {run.draw.seed.slice(0, 8)}…
          </p>
        )}
      </div>
      <div className="mt-3 flex justify-center">
        <RunHistory history={run.history} />
      </div>
      {run.error && <p className="mt-2 text-center text-xs text-destructive">{run.error}</p>}
    </div>
  );
}

/** Superadmin live view: next round + crash point for every game. */
export function SuperadminLiveGames() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-foreground">Live games</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Real-time predictor state for every crash game — next round countdown and the predicted crash point, exactly as players see it.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {GAMES.map((g) => (
          <LiveGameCard key={g.id} gameId={g.id} name={g.name} />
        ))}
      </div>
    </div>
  );
}
