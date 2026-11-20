import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/material-icon";
import {
  ApiError,
  getBottlePattern,
  nextBottleCall,
  type BottleCall,
} from "@/lib/api";
import { OutOfCreditsOverlay } from "@/components/window-ui";
import { cn } from "@/lib/utils";

/**
 * Spin da Bottle — timed prediction arena (ported from VirtuWin's
 * spin-bottle.html). Every round the predictor issues a call — UP or
 * DOWN — with a confidence %, a 15 s countdown runs, then the bottle
 * spins (4.3 s) and lands. The call is the prediction.
 *
 * Pattern mode: when the superadmin pins the next-10 pattern, rounds
 * follow it in order and the bottle lands on the pinned calls (the
 * source's owner rule). In LIVE mode the calls are consumed from the
 * one shared server-side sequence (POST /api/bottle/next) so every
 * player stays in sync; in SANDBOX (staff) mode the pattern is read
 * and cycled locally, exactly like the source's staff mirrors, so
 * playtests never burn the players' shared sequence.
 *
 * The surface is deliberately minimal: bottle, countdown, the call, go.
 */

const ROUND_MS = 15000;
const SPIN_MS = 4300;
const GAP_MS = 2600;

type Phase = "calling" | "spinning" | "gap";
type CallInfo = {
  call: BottleCall;
  conf: number;
  pattern: boolean;
  patternRound?: number;
};

function stickyOutcome(last: BottleCall | null): BottleCall {
  const r = Math.random();
  if (last === null) return r < 0.5 ? "UP" : "DOWN";
  return r < 0.58 ? last : last === "UP" ? "DOWN" : "UP";
}

/** The client heuristic predictor — a direct port of the source's AI. */
function heuristicPredict(history: BottleCall[]): CallInfo {
  const recent = history.slice(-6);
  const ups = recent.filter((h) => h === "UP").length;
  const momentum: BottleCall | null = recent.length
    ? ups > recent.length / 2
      ? "UP"
      : ups < recent.length / 2
        ? "DOWN"
        : null
    : null;
  let alt: BottleCall | null = null;
  if (history.length >= 2) {
    const tail = history.slice(-4);
    let flips = 0;
    for (let i = 1; i < tail.length; i++) if (tail[i] !== tail[i - 1]) flips++;
    if (flips >= 2) alt = history[history.length - 1] === "UP" ? "DOWN" : "UP";
  }
  const totalUps = history.filter((h) => h === "UP").length;
  const zoneBias = history.length ? totalUps / history.length : 0.5;
  let score = 0;
  if (momentum) score += momentum === "UP" ? 2 : -2;
  if (alt) score += alt === "UP" ? 1.5 : -1.5;
  score += (zoneBias - 0.5) * 3;
  const call: BottleCall = score >= 0 ? "UP" : "DOWN";
  const conf = Math.min(94, Math.round(64 + Math.abs(score) * 7 + Math.random() * 6));
  return { call, conf, pattern: false };
}

function BottleSvg() {
  return (
    <svg viewBox="0 0 220 64" className="w-full drop-shadow-[0_10px_24px_rgba(0,0,0,0.6)]" aria-hidden>
      <defs>
        <linearGradient id="dwGlassV" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fe05a" />
          <stop offset=".38" stopColor="#57b52e" />
          <stop offset=".72" stopColor="#3f941e" />
          <stop offset="1" stopColor="#2a6613" />
        </linearGradient>
      </defs>
      <rect x="1" y="25" width="13" height="14" rx="3" fill="#d9a514" />
      <rect x="1" y="28.5" width="13" height="2.4" fill="#a87c08" />
      <rect x="1" y="34" width="13" height="2.4" fill="#a87c08" />
      <path
        d="M14 27 h20 c10 0 16 -8 26 -8 h128 c14 0 24 6 24 13 s-10 13 -24 13 h-128 c-10 0 -16 -8 -26 -8 h-20 z"
        fill="url(#dwGlassV)"
      />
      <rect x="96" y="19.5" width="52" height="25" rx="3" fill="#0a2e06" opacity=".92" />
      <text x="122" y="31" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="9.5" fontWeight="900" fill="#a3e635">
        SPIN
      </text>
      <text x="122" y="41.5" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="7" fontWeight="700" fill="#FFF7EA">
        DA BOTTLE
      </text>
      <path d="M62 24 h118" stroke="rgba(255,255,255,.5)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M30 28.5 h14" stroke="rgba(255,255,255,.45)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function BottleArena({ sandbox = false }: { sandbox?: boolean }) {
  // ---- render state ----
  const [round, setRound] = useState(1042);
  const [current, setCurrent] = useState<CallInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("calling");
  const [cdMs, setCdMs] = useState(ROUND_MS);
  const [rotation, setRotation] = useState(0);
  const [landed, setLanded] = useState<BottleCall | null>(null);
  const [message, setMessage] = useState(
    "The predictor calls every spin — UP or DOWN — before the bottle turns.",
  );
  const [flash, setFlash] = useState(false);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  // ---- engine refs ----
  const historyRef = useRef<BottleCall[]>([]);
  const currentRef = useRef<CallInfo | null>(null);
  // Once the wallet is empty the ticker must stop starting rounds —
  // otherwise it would hammer a 403 every 2.6s forever.
  const stoppedRef = useRef(false);
  const outcomeRef = useRef<BottleCall>("UP");
  const phaseRef = useRef<Phase>("calling");
  const endsAtRef = useRef(0);
  const neckRef = useRef(270);
  const acquiringRef = useRef(false);
  const sandboxPatternRef = useRef<{ calls: BottleCall[] | null; at: number; idx: number }>({
    calls: null,
    at: 0,
    idx: 0,
  });

  async function acquireCall(): Promise<CallInfo> {
    if (!sandbox) {
      try {
        const d = await nextBottleCall();
        if (typeof d.creditsLeft === "number") setCreditsLeft(d.creditsLeft);
        if (d.mode === "pattern") {
          return { call: d.call, conf: d.confidence, pattern: true, patternRound: d.round };
        }
      } catch (err) {
        // CREDIT GATE (2026-11-06): an empty wallet must NEVER fall
        // through to a free local prediction — rethrow so startRound
        // can lock the arena. Other errors still fall back.
        if (err instanceof ApiError && err.code === "CREDITS_EXHAUSTED") throw err;
        /* API unreachable — fall through to the local predictor */
      }
      return heuristicPredict(historyRef.current);
    }
    // sandbox: source-style — poll the pattern, cycle it locally
    const cache = sandboxPatternRef.current;
    if (!cache.at || Date.now() - cache.at > 15000) {
      cache.at = Date.now();
      try {
        const p = await getBottlePattern();
        const fresh = Array.isArray(p.calls) && p.calls.length === 10 ? p.calls : null;
        if (JSON.stringify(fresh) !== JSON.stringify(cache.calls)) cache.idx = 0;
        cache.calls = fresh;
      } catch {
        /* keep the stale cache */
      }
    }
    if (cache.calls) {
      const idx = cache.idx % 10;
      cache.idx++;
      return {
        call: cache.calls[idx]!,
        conf: 72 + Math.floor(Math.random() * 22),
        pattern: true,
        patternRound: idx + 1,
      };
    }
    return heuristicPredict(historyRef.current);
  }

  function setPhaseBoth(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  async function startRound() {
    if (acquiringRef.current || stoppedRef.current) return;
    acquiringRef.current = true;
    let info: CallInfo;
    try {
      info = await acquireCall();
    } catch (err) {
      acquiringRef.current = false;
      if (err instanceof ApiError && err.code === "CREDITS_EXHAUSTED") {
        stoppedRef.current = true;
        setCreditsLeft(0);
        setOutOfCredits(true);
      }
      return;
    }
    acquiringRef.current = false;
    currentRef.current = info;
    setCurrent(info);
    // The bottle lands on a pinned pattern call (owner's rule); in AI
    // mode it lands randomly with the source's momentum stickiness.
    const last = historyRef.current[historyRef.current.length - 1] ?? null;
    outcomeRef.current = info.pattern ? info.call : stickyOutcome(last);
    setLanded(null);
    setMessage("Call locked in — watch where the bottle lands.");
    setCdMs(ROUND_MS);
    setPhaseBoth("calling");
    endsAtRef.current = Date.now() + ROUND_MS;
  }

  function doSpin() {
    if (phaseRef.current !== "calling") return;
    setMessage("Bottle is turning — watch where the neck settles.");
    setCdMs(0);
    const outcome = outcomeRef.current;
    const turns = 5 + Math.floor(Math.random() * 3);
    const target =
      outcome === "UP" ? (282 + Math.random() * 156) % 360 : (102 + Math.random() * 156) % 360;
    const delta = turns * 360 + (((target - neckRef.current) % 360) + 360) % 360;
    neckRef.current += delta;
    setRotation(neckRef.current - 270);
    setPhaseBoth("spinning");
    endsAtRef.current = Date.now() + SPIN_MS + 120;
  }

  function doResolve() {
    const outcome = outcomeRef.current;
    const info = currentRef.current;
    historyRef.current.push(outcome);
    setLanded(outcome);
    const hit = !!info && info.call === outcome;
    setMessage(
      hit
        ? `Called it — the bottle landed ${outcome}.`
        : `Bottle landed ${outcome} — the engine recalibrates for the next round.`,
    );
    if (hit) {
      setFlash(true);
      setTimeout(() => setFlash(false), 700);
    }
    setRound((r) => r + 1);
    setPhaseBoth("gap");
    endsAtRef.current = Date.now() + GAP_MS;
  }

  // engine ticker
  useEffect(() => {
    // seed recent history like the source (7 sticky outcomes)
    let last: BottleCall | null = null;
    for (let i = 0; i < 7; i++) {
      last = stickyOutcome(last);
      historyRef.current.push(last);
    }
    void startRound();
    const t = setInterval(() => {
      const now = Date.now();
      if (phaseRef.current === "calling") {
        setCdMs(Math.max(0, endsAtRef.current - now));
        if (now >= endsAtRef.current) doSpin();
      } else if (phaseRef.current === "spinning") {
        if (now >= endsAtRef.current) doResolve();
      } else if (phaseRef.current === "gap") {
        if (now >= endsAtRef.current) void startRound();
      }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const up = current?.call === "UP";
  const ringFrac = phase === "calling" ? cdMs / ROUND_MS : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card p-4 shadow-soft sm:p-5">
      {flash && <div className="dw-win-flash pointer-events-none absolute inset-0 z-20" />}

      {/* header — title + round state only */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MaterialIcon name="casino" filled className="text-[22px] text-primary" />
          <span className="text-sm font-black tracking-[0.18em] text-foreground">SPIN DA BOTTLE</span>
          {sandbox && (
            <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-warning-foreground">
              Staff playtest
            </span>
          )}
        </div>
        <span className="flex items-center gap-2">
          {!sandbox && creditsLeft != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">
              <MaterialIcon name="account_balance_wallet" className="text-[13px]" />
              {creditsLeft} credits · 4 per spin
            </span>
          )}
          <span className="text-xs font-bold text-muted-foreground">Round #{round}</span>
        </span>
      </div>

      {/* board — bottle + countdown ring */}
      <div
        className="relative mx-auto mt-4 w-full max-w-[430px] rounded-[2rem] p-[3px]"
        style={{
          background: `conic-gradient(rgba(163,230,53,0.6) ${ringFrac * 360}deg, rgba(255,255,255,0.06) 0deg)`,
        }}
      >
        <div className="relative aspect-square overflow-hidden rounded-[calc(2rem-3px)] bg-background">
          <div
            className={cn(
              "absolute inset-x-0 top-0 flex h-1/2 items-start justify-center pt-4 transition-colors duration-500",
              landed === "UP"
                ? "bg-success/20"
                : current && phase !== "spinning" && up
                  ? "bg-success/10"
                  : "bg-success/5",
            )}
          >
            <span className="text-sm font-black tracking-[0.3em] text-success/80">UP</span>
          </div>
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 flex h-1/2 items-end justify-center pb-4 transition-colors duration-500",
              landed === "DOWN"
                ? "bg-red-400/25"
                : current && phase !== "spinning" && !up
                  ? "bg-destructive/10"
                  : "bg-red-400/[0.04]",
            )}
          >
            <span className="text-sm font-black tracking-[0.3em] text-destructive/80">DOWN</span>
          </div>
          <div className="absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-muted" />
          {/* bottle */}
          <div className="absolute inset-0 grid place-items-center">
            <div
              className="w-[76%]"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition:
                  phase === "spinning"
                    ? `transform ${SPIN_MS}ms cubic-bezier(.1,.7,.08,1)`
                    : "none",
              }}
            >
              <BottleSvg />
            </div>
          </div>
          <div className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary/30 bg-[#FBF6EC]/85 shadow-[0_0_20px_rgba(225,77,42,0.3)] backdrop-blur">
            <MaterialIcon name="star" filled className="text-[20px] text-primary" />
          </div>
        </div>
      </div>

      {/* the call — one big pill; pattern position as a single quiet line */}
      {current && (
        <div className="mt-4 text-center">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-2xl border px-6 py-3 text-3xl font-black tracking-wide",
              up
                ? "border-success/40 bg-success/10 text-success"
                : "border-red-300/40 bg-red-400/15 text-destructive",
            )}
          >
            <MaterialIcon name={up ? "arrow_upward" : "arrow_downward"} className="text-[28px]" />
            {current.call}
            <span className="text-base font-black opacity-80">{current.conf}%</span>
          </span>
          {current.pattern && (
            <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Pattern · Round {current.patternRound} of 10
            </p>
          )}
        </div>
      )}

      <p className="mt-3 min-h-5 text-center text-[13px] font-medium text-muted-foreground">{message}</p>

      {/* the one control row — countdown + spin */}
      <div className="mt-3 flex items-stretch gap-2">
        <div className="grid w-[74px] shrink-0 place-items-center rounded-xl border border-border bg-muted/60 py-2">
          <div className="text-2xl font-black tabular-nums leading-none text-foreground">
            {phase === "calling" ? Math.ceil(cdMs / 1000) : 0}
          </div>
          <div className="mt-1 text-[9px] font-bold tracking-[0.18em] text-muted-foreground">
            NEXT SPIN
          </div>
        </div>
        <button
          type="button"
          onClick={doSpin}
          disabled={phase !== "calling"}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-black uppercase tracking-wider text-white shadow-[0_10px_28px_-10px_rgba(225,77,42,0.45)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
        >
          <MaterialIcon
            name={phase === "spinning" ? "progress_activity" : "play_arrow"}
            className={cn("text-[18px]", phase === "spinning" && "animate-spin")}
          />
          {phase === "spinning" ? "Spinning…" : "Spin Now"}
        </button>
      </div>

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        AI bottle predictor — no real money, for educational purposes only
      </p>

      {outOfCredits && <OutOfCreditsOverlay gameName="Spin da Bottle" gameId="bottle" />}
    </div>
  );
}
