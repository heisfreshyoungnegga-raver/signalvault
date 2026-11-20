import { Play, Pause, RotateCcw, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EnginePrediction, EngineRound } from "@/lib/api";

type Bet = { round: number; stake: number; won: boolean; pnl: number; balance: number };

/**
 * Auto-follow simulator: paper-trade the engine's calls with its own
 * stake sizing and watch the equity curve. Paper money only.
 */
export function AutoFollow({
  prediction,
  lastRound,
}: {
  prediction: EnginePrediction;
  lastRound: EngineRound | null;
}) {
  const [active, setActive] = useState(false);
  const [startBank, setStartBank] = useState("100");
  const [balance, setBalance] = useState(100);
  const [bets, setBets] = useState<Bet[]>([]);
  const seen = useRef<Set<number>>(new Set());

  const reset = (bank?: number) => {
    const b = bank ?? (parseFloat(startBank) || 100);
    setBalance(b);
    setBets([]);
    seen.current = new Set();
  };

  useEffect(() => {
    if (!active || !lastRound || seen.current.has(lastRound.n)) return;
    seen.current.add(lastRound.n);

    const stake = Math.max(0.01, balance * (prediction.stakePct / 100));
    const o = lastRound.outcome;
    let won = false;
    let payout = 0;

    if (prediction.type === "crash" && prediction.cashout) {
      won = Number(o["multiplier"]) >= prediction.cashout;
      payout = prediction.cashout;
    } else if (prediction.type === "penalty" && prediction.goalRate) {
      // counterfactual: the recommended corner scores unless the keeper reads it
      const keeperThere = String(o["keeper"]).toLowerCase() === prediction.direction;
      const beatenHeadOn = String(o["shooter"]).toLowerCase() === prediction.direction && Boolean(o["goal"]);
      won = !keeperThere || beatenHeadOn;
      payout = Math.max(1.05, 0.97 / (prediction.goalRate / 100));
    } else if (prediction.type === "action" && prediction.hotPct) {
      won = String(o["hot"]).toLowerCase() === prediction.zone;
      payout = Math.max(1.05, 0.97 / (prediction.hotPct / 100));
    }

    const pnl = won ? stake * (payout - 1) : -stake;
    const nb = Math.max(0, balance + pnl);
    setBalance(nb);
    setBets((b) => [...b.slice(-59), { round: lastRound.n, stake, won, pnl, balance: nb }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRound, active]);

  const wins = bets.filter((b) => b.won).length;
  const totalPnl = bets.reduce((s, b) => s + b.pnl, 0);
  const start = parseFloat(startBank) || 100;

  // equity sparkline
  const points = bets.map((b) => b.balance);
  const min = Math.min(start, ...points);
  const max = Math.max(start, ...points);
  const span = max - min || 1;
  const path =
    points.length > 1
      ? points
          .map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - min) / span) * 24}`)
          .join(" ")
      : "";

  return (
    <div className="card-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-extrabold">
            <Wallet className="size-4 text-primary" /> Auto-follow <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning-foreground uppercase">paper money</span>
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Paper-trade every engine call with its suggested stake. Watch what following the engine does.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={active ? "destructive" : "default"}
            className="rounded-full"
            onClick={() => setActive((a) => !a)}
          >
            {active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {active ? "Stop" : "Start"}
          </Button>
          <Button size="sm" variant="ghost" className="rounded-full" onClick={() => reset()}>
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_2fr]">
        <div>
          <Label htmlFor="af-bank" className="text-xs font-bold tracking-wide uppercase text-muted-foreground">
            Start bank (GHS)
          </Label>
          <Input
            id="af-bank"
            inputMode="decimal"
            value={startBank}
            disabled={active}
            onChange={(e) => {
              setStartBank(e.target.value);
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v > 0 && bets.length === 0) setBalance(v);
            }}
            className="mt-1.5 rounded-xl"
          />
        </div>
        <div className="rounded-xl bg-muted/50 p-3.5">
          <p className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Balance</p>
          <p className={`mt-0.5 text-xl font-extrabold tabular-nums ${balance >= start ? "text-success" : "text-destructive"}`}>
            GHS {balance.toFixed(2)}
          </p>
          <p className={`text-xs font-bold tabular-nums ${totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
            {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} ({bets.length} bets, {bets.length ? Math.round((wins / bets.length) * 100) : 0}% won)
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3.5">
          <p className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Equity</p>
          {points.length > 1 ? (
            <svg viewBox="0 0 100 32" className="mt-1 h-12 w-full" preserveAspectRatio="none">
              <polyline points={path} fill="none" stroke={totalPnl >= 0 ? "#22c55e" : "#ef4444"} strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">{active ? "Waiting for the first settled round…" : "Press Start to begin paper-trading."}</p>
          )}
        </div>
      </div>

      {bets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {bets.slice(-20).map((b) => (
            <span
              key={b.round}
              title={`Round #${b.round}: ${b.won ? "+" : ""}${b.pnl.toFixed(2)} GHS`}
              className={`size-5 rounded-md text-[9px] font-extrabold flex items-center justify-center ${b.won ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
            >
              {b.won ? "W" : "L"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
