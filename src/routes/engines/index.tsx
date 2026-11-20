import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Brain, Flame, Loader2, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { listEngines, type EngineGame } from "@/lib/api";

export const Route = createFileRoute("/engines/")({
  head: () => ({
    meta: [
      { title: "Prediction Engines — SignalVault" },
      {
        name: "description",
        content:
          "Five live AI prediction engines — Sporty Jet, Aviator, SportyKick, SportyHero and Super Hero. Real-time calls with confidence scores.",
      },
      { property: "og:title", content: "Prediction Engines — SignalVault" },
    ],
  }),
  component: EnginesLobby,
});

/** Confidence thread — a sand track with a terracotta/indigo/teal fill. */
function ConfidenceThread({ value }: { value: number }) {
  const fill = value >= 70 ? "bg-success" : value >= 60 ? "bg-secondary" : "bg-primary";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums">{value}%</span>
    </div>
  );
}

function EngineCard({ game, i }: { game: EngineGame; i: number }) {
  const { stats, prediction } = game;
  return (
    <Link
      to="/engines/$gameId"
      params={{ gameId: game.id }}
      className="card-surface card-hover animate-rise group overflow-hidden"
      style={{ animationDelay: `${i * 70}ms` }}
    >
      <div className="relative aspect-[16/9] overflow-hidden">
        <img
          src={game.image}
          alt={game.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span className="absolute top-3 left-3 rounded-full border border-border bg-white/95 px-3 py-1 text-[11px] font-bold tracking-wide text-foreground uppercase backdrop-blur">
          {game.tag}
        </span>
        <span className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full border border-border bg-white/95 px-3 py-1 text-[11px] font-bold text-success uppercase backdrop-blur">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          Live
        </span>
      </div>

      <div className="p-5">
        <div>
          <h3 className="text-xl font-extrabold text-foreground">{game.name}</h3>
          <p className="text-xs text-muted-foreground">{game.provider}</p>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              <Brain className="size-3.5" /> AI call
            </p>
            <p className="mt-1 truncate text-sm font-bold">{prediction.summary}</p>
          </div>
          <ConfidenceThread value={prediction.confidence} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-muted/60 px-2 py-2.5">
            <p className="flex items-center justify-center gap-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
              <Target className="size-3" /> Accuracy
            </p>
            <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">{stats.accuracy}%</p>
          </div>
          <div className="rounded-xl bg-muted/60 px-2 py-2.5">
            <p className="flex items-center justify-center gap-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
              <Flame className="size-3" /> Streak
            </p>
            <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">{stats.streak}</p>
          </div>
          <div className="rounded-xl bg-muted/60 px-2 py-2.5">
            <p className="flex items-center justify-center gap-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
              <Activity className="size-3" /> Rounds
            </p>
            <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">{stats.rounds}</p>
          </div>
        </div>

        <Button className="mt-4 w-full rounded-xl" variant="secondary">
          Open engine <ArrowRight className="size-4" />
        </Button>
      </div>
    </Link>
  );
}

function EnginesLobby() {
  const engines = useQuery({ queryKey: ["engines"], queryFn: listEngines, refetchInterval: 15000 });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-success uppercase">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Engines online
          </p>
          <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Prediction Engines</h1>
          <p className="text-muted-foreground mt-2 max-w-xl">
            One live AI engine per game. Each one studies the room, calls the next round,
            and grades itself — hit or miss, on the record.
          </p>
        </div>
      </div>

      {engines.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Waking the engines…
        </div>
      ) : engines.isError ? (
        <div className="card-surface mt-8 p-8 text-center">
          <p className="font-bold">Engines are unreachable right now.</p>
          <p className="text-muted-foreground mt-1 text-sm">Check your connection and try again.</p>
          <Button className="mt-4 rounded-xl" onClick={() => engines.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(engines.data ?? []).map((g, i) => (
            <EngineCard key={g.id} game={g} i={i} />
          ))}
        </div>
      )}

      <div className="card-surface mt-10 p-6 sm:p-8">
        <h2 className="text-xl font-extrabold">How the engines think</h2>
        <div className="mt-4 grid gap-4 text-sm leading-relaxed text-muted-foreground sm:grid-cols-2">
          <p>
            <span className="font-bold text-foreground">Crash engines (Jet, Aviator, SportyHero)</span> run
            the verified provably-fair math — Jet and Aviator use the SHA-512 multi-seed construction,
            SportyHero the 32-bit variant — then pick a cash-out tier and size the stake from the true odds.
          </p>
          <p>
            <span className="font-bold text-foreground">SportyKick</span> profiles the keeper's dive
            habits and recommends the corner with the highest empirical goal rate.
          </p>
          <p>
            <span className="font-bold text-foreground">Super Hero</span> tracks hot-zone frequencies
            and bonus droughts, striking the zone with the strongest edge over random.
          </p>
        </div>
      </div>
    </div>
  );
}
