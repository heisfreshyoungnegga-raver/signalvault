import { useState } from "react";
import { Play, Dices } from "lucide-react";
import { simulate, type SimResults } from "@/lib/api";
import {
  Panel, StatCard, DemoBadge, Skeleton, Field, inputCls, btnPrimaryCls, fmt, fmtInt,
} from "@/components/predictor/terminal";
import { EquityChart } from "@/components/predictor/charts";

const GAMES = [
  { id: "sporty-jet", name: "Sporty Jet" },
  { id: "aviator", name: "Aviator" },
  { id: "sportyhero", name: "SportyHero" },
];

export function SimulationLab() {
  const [gameId, setGameId] = useState("aviator");
  const [rounds, setRounds] = useState(500);
  const [target, setTarget] = useState(2);
  const [stake, setStake] = useState(1);
  const [seed, setSeed] = useState<number | "">("");
  const [result, setResult] = useState<SimResults | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(randomSeed: boolean) {
    setRunning(true);
    setErr(null);
    try {
      const res = await simulate(gameId, {
        rounds: Math.min(5000, Math.max(10, rounds)),
        target: Math.max(1.01, target),
        stake: Math.max(0.01, stake),
        seed: randomSeed ? Math.floor(Math.random() * 1e9) : seed === "" ? undefined : seed,
      });
      setResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setRunning(false);
    }
  }

  const equity = (result?.results.equityCurve ?? []).map((equity, i) => ({ i: i + 1, equity }));
  const r = result?.results;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-foreground md:text-2xl">Simulation Lab</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Stress-test a fixed cash-out strategy against the engine's provably-fair distribution.
          Every run is synthetic and reproducible from its seed — never mixed into historical records.
        </p>
      </div>

      <Panel title="Configuration" action={<DemoBadge>Synthetic</DemoBadge>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Game">
            <select value={gameId} onChange={(e) => setGameId(e.target.value)} className={inputCls}>
              {GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Rounds" hint="10 – 5000">
            <input type="number" value={rounds} min={10} max={5000} onChange={(e) => setRounds(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Cash-out target">
            <input type="number" value={target} min={1.01} step={0.1} onChange={(e) => setTarget(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Stake per round">
            <input type="number" value={stake} min={0.01} step={0.1} onChange={(e) => setStake(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Random seed" hint="Blank = engine default">
            <input type="number" value={seed} placeholder="e.g. 42" onChange={(e) => setSeed(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={() => run(false)} disabled={running} className={btnPrimaryCls}>
            <Play className="size-4" /> {running ? "Running…" : "Run simulation"}
          </button>
          <button onClick={() => run(true)} disabled={running} className={btnPrimaryCls}>
            <Dices className="size-4" /> Random seed
          </button>
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      </Panel>

      {running && !result ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Skeleton className="h-[104px]" /><Skeleton className="h-[104px]" /><Skeleton className="h-[104px]" /><Skeleton className="h-[104px]" />
        </div>
      ) : r ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Win rate" value={`${fmt(r.winRate, 2)}%`} sub={`${fmtInt(r.wins)}W · ${fmtInt(r.losses)}L`} tone="info" tip="Share of simulated rounds reaching the target." />
            <StatCard label="Net P&L" value={`${r.netPnl >= 0 ? "+" : ""}${fmt(r.netPnl)}`} sub={`Stake ${result!.config.stake} × ${fmtInt(result!.config.rounds)} rounds`} tone={r.netPnl >= 0 ? "up" : "down"} />
            <StatCard label="Max drawdown" value={fmt(r.maxDrawdown)} sub="Worst peak-to-trough equity dip" tone="warn" tip="Largest drop from a previous equity peak — the pain you'd have felt." />
            <StatCard label="Theoretical win rate" value={`${fmt(r.theoreticalWinRate, 2)}%`} sub="0.97 ÷ target — the true probability" tip="What the math says before any simulation runs." />
          </div>

          <Panel
            title="Equity curve"
            subtitle={`Seed ${result!.config.seed} · ${fmtInt(result!.config.rounds)} rounds at ${result!.config.target}x — reproducible exactly with the same seed.`}
          >
            <EquityChart data={equity} />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Simulated vs theoretical: observed {fmt(r.winRate, 2)}% against theoretical {fmt(r.theoreticalWinRate, 2)}%.
              Larger samples converge toward theory — that convergence is the house edge made visible.
            </p>
          </Panel>
        </>
      ) : (
        <Panel title="No simulation yet">
          <p className="text-sm text-muted-foreground">Configure a strategy above and run it. Try 2,000 rounds at 2x to watch the edge grind.</p>
        </Panel>
      )}
    </div>
  );
}
