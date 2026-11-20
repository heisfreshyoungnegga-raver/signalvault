import { Sparkles, Radar, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { EnginePrediction } from "@/lib/api";

const PHASES = [
  "Reading recent rounds…",
  "Measuring volatility…",
  "Weighing the factors…",
  "Locking the call…",
];

/** The predictor moment: tap -> analyzing theater -> dramatic reveal. */
export function PredictorReveal({ prediction }: { prediction: EnginePrediction }) {
  const [stage, setStage] = useState<"idle" | "analyzing" | "revealed">("idle");
  const [phase, setPhase] = useState(0);
  const [displayConf, setDisplayConf] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => clear, []);

  const start = () => {
    clear();
    setStage("analyzing");
    setPhase(0);
    setDisplayConf(0);
    PHASES.forEach((_, i) => {
      timers.current.push(setTimeout(() => setPhase(i), i * 700));
    });
    timers.current.push(setTimeout(() => setStage("revealed"), PHASES.length * 700 + 200));
  };

  useEffect(() => {
    if (stage !== "revealed") return;
    const target = prediction.confidence;
    const t0 = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - t0) / 900);
      setDisplayConf(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) timers.current.push(setTimeout(tick, 30));
    };
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // A fresh prediction resets the theater.
  useEffect(() => {
    setStage("idle");
    setPhase(0);
  }, [prediction.round]);

  return (
    <div className="card-surface relative overflow-hidden p-6 sm:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,197,94,0.08),transparent_60%)]" />
      <div className="relative">
        <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] text-muted-foreground uppercase">
          <Radar className="size-4 text-primary" /> Predictor · round #{prediction.round}
        </p>

        {stage === "idle" && (
          <div className="mt-4 text-center">
            <p className="text-muted-foreground mx-auto max-w-sm text-sm">
              The engine has read the room. Tap to lock the call for the next round.
            </p>
            <Button size="lg" onClick={start} className="mt-5 rounded-2xl px-10 py-6 text-base font-extrabold shadow-glow">
              <Sparkles className="size-5" /> Predict next round
            </Button>
          </div>
        )}

        {stage === "analyzing" && (
          <div className="mt-6">
            <div className="flex items-center justify-center gap-2.5 text-sm font-bold">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="animate-pulse">{PHASES[phase]}</span>
            </div>
            <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${((phase + 1) / (PHASES.length + 0.4)) * 100}%` }}
              />
            </div>
            {/* fake scanning rows for theater */}
            <div className="mx-auto mt-5 max-w-md space-y-1.5 font-mono text-[11px] text-muted-foreground">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`flex justify-between ${i <= phase ? "" : "opacity-30"}`}>
                  <span>round #{prediction.round - 4 + i}</span>
                  <span className="animate-pulse">{i <= phase ? "✓ analyzed" : "· waiting"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stage === "revealed" && (
          <div className="animate-rise mt-4 text-center">
            <p className="text-[11px] font-bold tracking-[0.25em] text-success uppercase">Call locked</p>
            <p className="mt-2 text-3xl font-extrabold sm:text-4xl">{prediction.summary}</p>
            <div className="mt-3 inline-flex items-center gap-3 rounded-full border border-muted bg-muted/50 px-5 py-2">
              <span className="text-sm text-muted-foreground">Confidence</span>
              <span className="text-2xl font-extrabold tabular-nums text-primary">{displayConf}%</span>
            </div>
            <div className="mt-5">
              <Button variant="secondary" onClick={start} className="rounded-xl">
                Re-run prediction
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
