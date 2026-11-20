import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronLeft,
  Flame,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PredictorReveal } from "@/components/predictor/PredictorReveal";
import { SignalMeter } from "@/components/predictor/SignalMeter";
import { FairnessVerifier } from "@/components/predictor/FairnessVerifier";
import { AutoFollow } from "@/components/predictor/AutoFollow";
import {
  getEngine,
  tickEngine,
  type EngineDetail,
  type EnginePrediction,
  type EngineRound,
  type EngineStats,
} from "@/lib/api";

export const Route = createFileRoute("/engines/$gameId")({
  component: EngineDashboard,
});

const TICK_MS = 8000;

function RiskBadge({ level }: { level: string }) {
  const styles =
    level === "Low"
      ? "bg-success/10 text-success border-success/30"
      : level === "Medium"
        ? "bg-warning/15 text-warning-foreground border-warning/30"
        : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${styles}`}>
      <ShieldAlert className="size-3.5" /> {level} risk
    </span>
  );
}

function BigConfidence({ value }: { value: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  const color = value >= 70 ? "#0F766E" : value >= 60 ? "#B45309" : "#E14D2A";
  return (
    <div className="relative size-36">
      <svg viewBox="0 0 128 128" className="size-36 -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-extrabold">{value}%</span>
        <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">confidence</span>
      </div>
    </div>
  );
}

function outcomeLabel(round: EngineRound, type: EnginePrediction["type"]): string {
  const o = round.outcome;
  if (type === "crash") return `${Number(o["multiplier"]).toFixed(2)}x`;
  if (type === "penalty")
    return `Keeper ${String(o["keeper"]).toUpperCase()} · shot ${String(o["shooter"]).toUpperCase()} — ${o["goal"] ? "GOAL" : "SAVED"}`;
  return `Zone ${String(o["hot"]).toUpperCase()} @ ${Number(o["multiplier"]).toFixed(1)}x${o["bonus"] ? " + BONUS" : ""}`;
}

function CrashViz({ p }: { p: EnginePrediction }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card-surface p-6">
        <h3 className="flex items-center gap-2 font-extrabold"><TrendingUp className="size-4" /> Cash-out tiers</h3>
        <div className="mt-4 space-y-3">
          {(p.tiers ?? []).map((t) => (
            <div key={t.key} className={`rounded-xl border p-3.5 ${p.tier === t.key ? "border-primary bg-primary/10" : "border-muted bg-muted/40"}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold">{t.label} <span className="text-muted-foreground">· {t.cashout}x</span></span>
                {p.tier === t.key && <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground uppercase">AI pick</span>}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.min(100, t.hitRate)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{t.hitRate}% of recent rounds clear this tier</p>
            </div>
          ))}
        </div>
      </div>
      <div className="card-surface p-6">
        <h3 className="flex items-center gap-2 font-extrabold"><Activity2 /> Room pulse</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          {[
            ["Avg multiplier", `${p.room?.avgMultiplier}x`],
            ["Volatility", `${p.room?.volatility}`],
            ["Trend", p.room?.trend],
            ["Bust streak", `${p.room?.bustStreak}`],
            ["Rounds since 10x", `${p.room?.roundsSince10x}`],
            ["Sample", `${p.room?.rounds} rounds`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-muted/50 px-3.5 py-3">
              <p className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">{k}</p>
              <p className="mt-0.5 text-lg font-extrabold capitalize">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Activity2() {
  return <Zap className="size-4" />;
}

function PenaltyViz({ p }: { p: EnginePrediction }) {
  const kp = p.keeperProfile ?? { left: 0, center: 0, right: 0 };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card-surface p-6">
        <h3 className="font-extrabold">Corner goal rates</h3>
        <div className="mt-4 space-y-3">
          {(p.corners ?? []).map((c) => (
            <div key={c.direction}>
              <div className="flex items-center justify-between text-sm">
                <span className={`font-bold uppercase ${p.direction === c.direction ? "text-primary" : ""}`}>
                  {c.direction} {p.direction === c.direction && "← AI pick"}
                </span>
                <span className="font-extrabold">{c.goalRate}%</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${p.direction === c.direction ? "bg-primary" : "bg-muted-foreground/40"}`}
                  style={{ width: `${c.goalRate}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card-surface p-6">
        <h3 className="font-extrabold">Keeper dive profile</h3>
        <p className="text-muted-foreground mt-1 text-xs">Where the keeper goes — shoot where he isn't.</p>
        <div className="mt-4 space-y-3">
          {(["left", "center", "right"] as const).map((d) => (
            <div key={d}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold uppercase">{d}</span>
                <span className="font-extrabold">{kp[d]}%</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-400 transition-all duration-700" style={{ width: `${kp[d]}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionViz({ p }: { p: EnginePrediction }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card-surface p-6">
        <h3 className="font-extrabold">Zone heat map</h3>
        <div className="mt-4 space-y-3">
          {(p.zones ?? []).map((z) => (
            <div key={z.zone}>
              <div className="flex items-center justify-between text-sm">
                <span className={`font-bold uppercase ${p.zone === z.zone ? "text-primary" : ""}`}>
                  {z.zone} {p.zone === z.zone && "← AI pick"}
                </span>
                <span className="font-extrabold">{z.hotPct}%</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${p.zone === z.zone ? "bg-primary" : "bg-muted-foreground/40"}`}
                  style={{ width: `${Math.min(100, z.hotPct * 2.5)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground mt-3 text-xs">Edge over random: {p.edgeOverRandom && p.edgeOverRandom >= 0 ? "+" : ""}{p.edgeOverRandom}%</p>
      </div>
      <div className="card-surface p-6">
        <h3 className="font-extrabold">Bonus radar</h3>
        <div className="mt-4 rounded-xl bg-muted/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Bonus spin rate</span>
            <span className="text-lg font-extrabold">{p.bonus?.ratePct}%</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-sm font-bold">Rounds since bonus</span>
            <span className="text-lg font-extrabold">{p.bonus?.roundsSince}</span>
          </div>
          {p.bonus?.overdue ? (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-warning/15 px-3 py-2 text-sm font-bold text-warning-foreground">
              <Flame className="size-4" /> Bonus overdue — worth a side stake
            </p>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">Bonus frequency normal — nothing unusual.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function EngineDashboard() {
  const { gameId } = Route.useParams();
  const [bankroll, setBankroll] = useState("100");
  const [ticking, setTicking] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const detail = useQuery({ queryKey: ["engine", gameId], queryFn: () => getEngine(gameId) });
  const [prediction, setPrediction] = useState<EnginePrediction | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [history, setHistory] = useState<EngineRound[]>([]);
  const [lastRound, setLastRound] = useState<EngineRound | null>(null);

  useEffect(() => {
    if (detail.data) {
      setPrediction(detail.data.prediction);
      setStats(detail.data.stats);
      setHistory(detail.data.history);
    }
  }, [detail.data]);

  const doTick = async () => {
    if (ticking) return;
    setTicking(true);
    try {
      const r = await tickEngine(gameId);
      setLastRound(r.round);
      setPrediction(r.prediction);
      setStats(r.stats);
      setHistory((h) => [r.round, ...h].slice(0, 30));
    } catch {
      /* keep the feed alive on transient errors */
    } finally {
      setTicking(false);
    }
  };

  useEffect(() => {
    timer.current = setInterval(doTick, TICK_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-32 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Waking the engine…
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-20 text-center">
        <p className="text-xl font-extrabold">Engine not found.</p>
        <Button asChild className="mt-4 rounded-xl">
          <Link to="/engines">Back to engines</Link>
        </Button>
      </div>
    );
  }

  const d: EngineDetail = detail.data;
  const p = prediction ?? d.prediction;
  const s = stats ?? d.stats;
  const stake = Math.max(0, (parseFloat(bankroll) || 0) * (p.stakePct / 100));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Link to="/engines" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> All engines
      </Link>

      {/* hero */}
      <div className="card-surface mt-4 overflow-hidden">
        <div className="relative h-44 sm:h-56">
          <img src={d.image} alt={d.name} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] text-teal-200 uppercase">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-300 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-teal-300" />
                </span>
                Live engine · {d.provider}
              </p>
              <h1 className="mt-1 text-3xl font-extrabold text-white sm:text-4xl">{d.name}</h1>
              <p className="mt-1 text-sm text-white/70">{d.blurb}</p>
            </div>
            <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold tracking-wide text-white uppercase backdrop-blur">
              {d.tag}
            </span>
          </div>
        </div>

        {/* prediction panel */}
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
              <Brain className="size-3.5" /> AI call · round #{p.round}
            </p>
            <p className="mt-2 text-2xl font-extrabold sm:text-3xl">{p.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <RiskBadge level={p.riskLevel} />
              <span className="inline-flex items-center gap-1.5 rounded-full border border-muted bg-muted/50 px-3 py-1 text-xs font-bold">
                <Wallet className="size-3.5" /> Suggested stake {p.stakePct}% of bankroll
              </span>
            </div>
            {p.disclaimer && (
              <p className="mt-3 max-w-xl rounded-xl border border-warning/30 bg-warning/15 px-3.5 py-2.5 text-xs leading-relaxed text-warning-foreground">
                {p.disclaimer}
              </p>
            )}
            <div className="mt-4 max-w-xs">
              <Label htmlFor="bankroll" className="text-xs font-bold tracking-wide uppercase text-muted-foreground">
                Your bankroll (GHS)
              </Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="bankroll"
                  inputMode="decimal"
                  value={bankroll}
                  onChange={(e) => setBankroll(e.target.value)}
                  className="rounded-xl"
                />
                <span className="rounded-xl bg-primary/15 px-3.5 py-2 text-sm font-extrabold whitespace-nowrap text-primary">
                  Stake GHS {stake.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <BigConfidence value={p.confidence} />
          </div>
        </div>
      </div>

      {/* predictor */}
      <div className="mt-5">
        <PredictorReveal prediction={p} />
      </div>

      {/* confidence meter */}
      {p.factors && p.factors.length > 0 && (
        <div className="mt-5">
          <SignalMeter factors={p.factors} />
        </div>
      )}

      {/* stats strip */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { icon: Target, label: "Accuracy", value: `${s.accuracy}%` },
          { icon: Flame, label: "Streak", value: `${s.streak}` },
          { icon: TrendingUp, label: "Best streak", value: `${s.bestStreak}` },
          { icon: Zap, label: "Calls made", value: `${s.predictions}` },
          { icon: Brain, label: "Rounds read", value: `${s.rounds}` },
        ].map((it) => (
          <div key={it.label} className="card-surface p-4 text-center">
            <p className="flex items-center justify-center gap-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
              <it.icon className="size-3" /> {it.label}
            </p>
            <p className="mt-1 text-2xl font-extrabold">{it.value}</p>
          </div>
        ))}
      </div>

      {/* reasoning */}
      <div className="card-surface mt-5 p-6">
        <h3 className="flex items-center gap-2 font-extrabold"><Lightbulb className="size-4" /> Why this call</h3>
        <ul className="mt-3 space-y-2.5">
          {p.reasoning.map((r, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <span><span className="font-medium text-foreground">{r.split("—")[0]}</span>{r.includes("—") ? `—${r.split("—").slice(1).join("—")}` : ""}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* type-specific viz */}
      <div className="mt-5">
        {p.type === "crash" && <CrashViz p={p} />}
        {p.type === "penalty" && <PenaltyViz p={p} />}
        {p.type === "action" && <ActionViz p={p} />}
      </div>

      {/* auto-follow paper trading */}
      <div className="mt-5">
        <AutoFollow prediction={p} lastRound={lastRound} />
      </div>

      {/* provably-fair verifier (crash engines) */}
      {p.type === "crash" && (
        <div className="mt-5">
          <FairnessVerifier gameId={gameId} maxRound={s.rounds} />
        </div>
      )}

      {/* live feed + history */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="card-surface p-6">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-extrabold">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              Live round feed
            </h3>
            <Button size="sm" variant="secondary" className="rounded-full" onClick={doTick} disabled={ticking}>
              <RefreshCw className={`size-3.5 ${ticking ? "animate-spin" : ""}`} /> Simulate
            </Button>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">New round every {TICK_MS / 1000}s — the engine grades its last call live.</p>
          {lastRound ? (
            <div className="mt-4 rounded-xl border border-muted bg-muted/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Round #{lastRound.n}</span>
                {lastRound.graded && (
                  lastRound.graded.hit ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-bold text-success">
                      <CheckCircle2 className="size-3.5" /> HIT
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive">
                      <XCircle className="size-3.5" /> MISS
                    </span>
                  )
                )}
              </div>
              <p className="mt-2 text-xl font-extrabold">{outcomeLabel(lastRound, p.type)}</p>
              {lastRound.graded && (
                <p className="text-muted-foreground mt-1 text-xs">Call was: {lastRound.graded.prediction}</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground mt-4 text-sm">Waiting for the next round…</p>
          )}
        </div>

        <div className="card-surface p-6">
          <h3 className="font-extrabold">Recent rounds</h3>
          <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {history.map((r) => (
              <div key={r.n} className="flex items-center justify-between rounded-lg bg-muted/40 px-3.5 py-2 text-sm">
                <span className="font-bold">#{r.n}</span>
                <span className="font-medium">{outcomeLabel(r, p.type)}</span>
                {r.graded ? (
                  r.graded.hit ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 mb-4 flex justify-center">
        <Button asChild variant="ghost" className="rounded-full">
          <Link to="/engines"><ArrowLeft className="size-4" /> Back to all engines</Link>
        </Button>
      </div>
    </div>
  );
}
