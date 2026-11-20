import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { drawCrashLocal } from "@/lib/provably-fair";
import { GAME_PAGE_THEMES } from "@/components/predictor/crash/gameThemes";
import { cn } from "@/lib/utils";

const GAMES = [
  { id: "aviator", name: "Aviator" },
  { id: "sporty-jet", name: "Sporty Jet" },
  { id: "sportyhero", name: "SportyHero" },
];

function crashTone(crash: number) {
  if (crash < 2)
    return "bg-destructive text-white shadow-lg shadow-destructive/30";
  if (crash < 10)
    return "bg-gradient-to-br from-slate-100 to-slate-200 text-foreground shadow-md shadow-slate-400/20";
  return "bg-primary text-white shadow-lg shadow-primary/30";
}

function NextRunsCard({ gameId, name }: { gameId: string; name: string }) {
  const [runs, setRuns] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const gt = GAME_PAGE_THEMES[gameId] ?? GAME_PAGE_THEMES["aviator"]!;

  async function generate() {
    setLoading(true);
    const out: number[] = [];
    for (let i = 0; i < 10; i++) {
      const d = await drawCrashLocal(gameId);
      out.push(d.crash);
    }
    setRuns(out);
    setLoading(false);
  }

  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  return (
    <div
      className="overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-slate-900 to-black p-5"
      style={{ boxShadow: `0 12px 40px rgba(${gt.glow},0.18)` }}
    >
      <div
        className="mb-4 flex items-center justify-between rounded-2xl px-4 py-3"
        style={{ background: `linear-gradient(135deg, rgba(${gt.glow},0.25), rgba(${gt.glow},0.08))` }}
      >
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground">Next 10 runs</p>
          <h3 className="text-xl font-black text-foreground">{name}</h3>
        </div>
        <button
          onClick={() => void generate()}
          disabled={loading}
          className="grid size-10 place-items-center rounded-xl bg-muted text-foreground backdrop-blur transition hover:bg-muted disabled:opacity-50"
          title="Regenerate"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </button>
      </div>
      {loading ? (
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        // flex-wrap, not a 5-col grid: a 1000.00x value at text-base is
        // wider than a 5th of a 390px card and grid min-width:auto forced
        // the card to overflow (clipped by overflow-hidden).
        <div className="flex flex-wrap gap-2">
          {runs.map((c, i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl px-2 py-3 text-center",
                crashTone(c),
                i === 0 && "ring-2 ring-white/80 ring-offset-2 ring-offset-black"
              )}
            >
              <p className="text-[9px] font-black uppercase tracking-wider opacity-75">#{i + 1}</p>
              <p className="text-base font-black tabular-nums">{c.toFixed(2)}x</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl bg-muted/60 px-3 py-2.5 text-[11px] font-bold">
        <span className="inline-flex items-center gap-1.5 text-destructive">
          <span className="size-2.5 rounded-full bg-red-500 shadow shadow-red-500/50" /> Under 2x
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2.5 rounded-full bg-slate-300 shadow" /> 2–10x
        </span>
        <span className="inline-flex items-center gap-1.5 text-success">
          <span className="size-2.5 rounded-full bg-success shadow shadow-success/50" /> 10x+
        </span>
      </div>
    </div>
  );
}

/** Superadmin: the next 10 runs for every game, on its own tab. */
export function SuperadminNextRuns() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-foreground">Next 10 runs</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The upcoming crash-point sequence for every game — what the engine will deal next, before players see it.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {GAMES.map((g) => (
          <NextRunsCard key={g.id} gameId={g.id} name={g.name} />
        ))}
      </div>
    </div>
  );
}
