import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/material-icon";
import { api, ApiError, userToken, type CreditSummary } from "@/lib/api";
import { OutOfCreditsOverlay } from "@/components/window-ui";
import { cn } from "@/lib/utils";

/**
 * Mines — "AI diamond locator" (ported from VirtuWin's mines.html).
 * Generation is 100% client-side: the grid is placed in the browser and
 * Run Predictor animates the reveal of every diamond (and mine).
 * No betting, no cashout — a predictor board, exactly like the source.
 *
 * CREDIT GATE (2026-11-06): each Run Predictor costs 5 credits — the
 * board spends via POST /api/mines/play BEFORE revealing anything, and
 * locks behind the out-of-credits overlay when the wallet is empty.
 * Sandbox (staff playtest) never spends.
 *
 * On SignalVault the mine-count cap is the Premium tier's: 10.
 */

export const MINES_PREMIUM_CAP = 10;

const GRID_SIZE = 25;
const MIN_MINES = 1;

const PREDICTION_STEPS = [
  "Warming up the SignalVault engine…",
  "Scanning the mines grid…",
  "Running smart analysis…",
  "Locating safe diamonds…",
  "Detecting mine positions…",
  "Calculating prediction…",
  "Prediction complete!",
];

type TileVisual = "diamond" | "bomb";

function shuffle(arr: number[]): number[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function MinesBoard({
  maxMines = MINES_PREMIUM_CAP,
  sandbox = false,
}: {
  maxMines?: number;
  sandbox?: boolean;
}) {
  const [bombCount, setBombCount] = useState(3);
  const [minePositions, setMinePositions] = useState<number[]>([]);
  const [tileVisuals, setTileVisuals] = useState<Record<number, TileVisual> | null>(null);
  const [gridGenerated, setGridGenerated] = useState(false);
  const [running, setRunning] = useState(false);
  const [scanPos, setScanPos] = useState(-1);
  const [flash, setFlash] = useState(false);
  const [status, setStatus] = useState("Ready to scan");
  const [message, setMessage] = useState(
    "Set mines and run the predictor to locate all diamonds.",
  );
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const generateGrid = useCallback(
    (count: number) => {
      clearTimers();
      const indices = shuffle(Array.from({ length: GRID_SIZE }, (_, i) => i));
      setMinePositions(indices.slice(0, count).sort((a, b) => a - b));
      setTileVisuals(null);
      setGridGenerated(true);
      setRunning(false);
      setScanPos(-1);
      setStatus("Grid ready");
      setMessage(
        `Grid updated. ${count} mines, ${GRID_SIZE - count} diamonds. Click "Run Predictor" to reveal them.`,
      );
    },
    [],
  );

  // first grid on mount
  useEffect(() => {
    generateGrid(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setCount(next: number) {
    const clamped = Math.max(MIN_MINES, Math.min(maxMines, next));
    setBombCount(clamped);
    generateGrid(clamped);
  }

  async function runPrediction() {
    if (!gridGenerated || running || tileVisuals) return;
    // Spend 5 credits BEFORE revealing anything (sandbox never spends).
    if (!sandbox) {
      try {
        const r = await api<{ credits: CreditSummary }>("/api/mines/play", {
          method: "POST",
          token: userToken.get(),
        });
        setCreditsLeft(r.credits.balance);
      } catch (err) {
        if (err instanceof ApiError && err.code === "CREDITS_EXHAUSTED") {
          setCreditsLeft(0);
          setOutOfCredits(true);
          setMessage("Out of credits — top up to keep playing.");
        }
        return;
      }
    }
    setRunning(true);
    setStatus("Scanning…");
    setMessage(PREDICTION_STEPS[0]!);
    // scan sweep highlight racing across the tiles while the engine "thinks"
    let pos = 0;
    const sweep = setInterval(() => {
      pos = (pos + 1) % GRID_SIZE;
      setScanPos(pos);
    }, 90);
    timers.current.push(sweep as unknown as ReturnType<typeof setTimeout>);

    let step = 0;
    const advance = () => {
      step++;
      if (step >= PREDICTION_STEPS.length) {
        clearInterval(sweep);
        finish();
        return;
      }
      setMessage(PREDICTION_STEPS[step]!);
      timers.current.push(setTimeout(advance, 550 + Math.random() * 250));
    };
    timers.current.push(setTimeout(advance, 550 + Math.random() * 250));

    function finish() {
      const visuals: Record<number, TileVisual> = {};
      for (let i = 0; i < GRID_SIZE; i++) {
        visuals[i] = minePositions.includes(i) ? "bomb" : "diamond";
      }
      setTileVisuals(visuals);
      setRunning(false);
      setScanPos(-1);
      setStatus("Scan complete");
      setMessage("Prediction complete — all diamonds located.");
      setFlash(true);
      timers.current.push(setTimeout(() => setFlash(false), 700));
    }
  }

  const revealed = tileVisuals !== null;
  const safeCount = GRID_SIZE - bombCount;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card p-4 shadow-soft sm:p-5">
      {flash && <div className="dw-win-flash pointer-events-none absolute inset-0 z-20" />}

      {/* header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MaterialIcon name="psychology" filled className="text-[22px] text-success" />
          <span className="text-sm font-black tracking-[0.18em] text-foreground">
            MINE GRID ENGINE
          </span>
        </div>
        <span className="flex items-center gap-2">
          {sandbox && (
            <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-warning-foreground">
              Staff playtest
            </span>
          )}
          {!sandbox && creditsLeft != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">
              <MaterialIcon name="account_balance_wallet" className="text-[13px]" />
              {creditsLeft} credits · 5 per game
            </span>
          )}
        </span>
      </div>

      {/* HUD */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-bold text-foreground">
          <MaterialIcon name="grid_view" className="text-[16px] text-success" />
          {bombCount} mines
        </span>
        <span
          className={cn(
            "text-xs font-black uppercase tracking-wider",
            status === "Scan complete" ? "text-success" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-bold text-foreground">
          <MaterialIcon name="diamond" className="text-[16px] text-success" />
          {safeCount} safe
        </span>
      </div>

      {/* grid */}
      <div className="relative mt-4">
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Mines grid">
          {Array.from({ length: GRID_SIZE }, (_, i) => {
            const visual = tileVisuals?.[i];
            return (
              <div
                key={i}
                className={cn(
                  "grid aspect-square place-items-center rounded-xl border transition-all duration-300",
                  visual === "diamond" &&
                    "border-primary/50 bg-primary/10 shadow-[0_0_18px_rgba(225,77,42,0.25)]",
                  visual === "bomb" && "border-red-400/40 bg-red-950/60",
                  !visual && "border-border bg-muted/40",
                  running && scanPos === i && "border-success/70 bg-success/10",
                )}
              >
                {visual === "diamond" ? (
                  <MaterialIcon
                    name="diamond"
                    filled
                    className="text-[26px] text-success drop-shadow-[0_0_6px_rgba(225,77,42,0.8)]"
                  />
                ) : visual === "bomb" ? (
                  <MaterialIcon
                    name="warning"
                    filled
                    className="text-[24px] text-destructive drop-shadow-[0_0_4px_rgba(255,85,102,0.5)]"
                  />
                ) : (
                  <span className="size-2 rounded-full bg-muted" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 min-h-5 text-center text-[13px] font-medium text-muted-foreground">{message}</p>

      {/* controls */}
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCount(bombCount - 1)}
            disabled={running}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-muted/60 text-foreground transition hover:bg-muted disabled:opacity-40"
            aria-label="Decrease mines"
          >
            <MaterialIcon name="remove" className="text-[18px]" />
          </button>
          <div className="w-14 shrink-0 text-center">
            <div className="text-3xl font-black tabular-nums text-foreground">{bombCount}</div>
            <div className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground">MINES</div>
          </div>
          <button
            type="button"
            onClick={() => setCount(bombCount + 1)}
            disabled={running}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-muted/60 text-foreground transition hover:bg-muted disabled:opacity-40"
            aria-label="Increase mines"
          >
            <MaterialIcon name="add" className="text-[18px]" />
          </button>
          <input
            type="range"
            min={MIN_MINES}
            max={maxMines}
            value={bombCount}
            disabled={running}
            onChange={(e) => setCount(parseInt(e.target.value, 10))}
            className="min-w-0 flex-1 accent-primary"
            aria-label="Mines count"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => generateGrid(bombCount)}
            disabled={running}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/60 px-3 py-3 text-xs font-black uppercase tracking-wider text-foreground transition hover:bg-muted disabled:opacity-40"
          >
            <MaterialIcon name="restart_alt" className="text-[16px]" /> Generate new grid
          </button>
          <button
            type="button"
            onClick={runPrediction}
            disabled={!gridGenerated || running || revealed}
            className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-3 text-xs font-black uppercase tracking-wider text-white shadow-[0_10px_28px_-10px_rgba(225,77,42,0.45)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
          >
            <MaterialIcon
              name={running ? "progress_activity" : "play_arrow"}
              className={cn("text-[16px]", running && "animate-spin")}
            />
            {running ? "Engine running…" : "Run Predictor"}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        AI diamond locator — no real money, for educational purposes only
      </p>

      {outOfCredits && <OutOfCreditsOverlay gameName="Mines" gameId="mines" />}
    </div>
  );
}
