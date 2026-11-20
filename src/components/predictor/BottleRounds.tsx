import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dices, Power, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  adminToken,
  getBottlePattern,
  getVirtualPredictions,
  setBottlePattern,
  setVirtualPredictions,
  type BottleCall,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Spin da Bottle pattern surfaces.
 * - BottlePatternView: admin read-only view of the live pattern + where
 *   the shared server-side sequence currently stands.
 * - BottleRoundsEditor: superadmin editor (mirrors the VirtuWin
 *   superadmin-bottle-rounds page + this panel's RoundCustomization UX)
 *   plus the virtual-predictions kill-switch toggle, which covers the
 *   bottle and mines pages too.
 */

export function BottlePatternChips({
  calls,
  nextRound,
}: {
  calls: BottleCall[];
  nextRound?: number | null;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {calls.map((c, i) => (
        <span
          key={i}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-[11px] font-black tabular-nums",
            c === "UP"
              ? "bg-success/10 text-success"
              : "bg-red-400/15 text-destructive",
            nextRound === i + 1 &&
              "ring-2 ring-amber-300/80 ring-offset-1 ring-offset-black",
          )}
          title={nextRound === i + 1 ? "Next call served" : undefined}
        >
          {i + 1} · {c === "UP" ? "▲ UP" : "▼ DOWN"}
        </span>
      ))}
    </div>
  );
}

function metaLine(updatedBy?: string | null, updatedAt?: string | null) {
  if (!updatedAt) return "";
  return `Last set by ${updatedBy || "super admin"} · ${new Date(updatedAt).toLocaleString("en-GB")}`;
}

export function BottlePatternView() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["bottle-pattern"],
    queryFn: () => getBottlePattern(),
    retry: false,
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-success/30 bg-success/10 p-4">
        <h2 className="text-sm font-black text-foreground">How it works</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The super admin can pin the next 10 Spin da Bottle calls. Players draw them{" "}
          <strong className="text-foreground">in order from one shared server sequence</strong> —
          round 1 to 10, then back to 1 — so every player stays in sync. With no pattern
          set, the AI predictor calls the rounds. Only a super admin can change the pattern.
        </p>
      </div>

      <div className="rounded-3xl border border-border bg-gradient-to-b from-slate-900 to-black p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground">
              Spin da Bottle
            </p>
            <h3 className="text-xl font-black text-foreground">Live pattern</h3>
          </div>
          <button
            onClick={() => void refetch()}
            className="grid size-10 place-items-center rounded-xl bg-muted text-foreground backdrop-blur transition hover:bg-muted"
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          </button>
        </div>

        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : data?.calls ? (
          <>
            <p className="mb-3 text-xs font-semibold text-success">
              Pattern is LIVE — players are calling these rounds in order. The ringed chip
              is the next call the server serves.
            </p>
            <BottlePatternChips calls={data.calls} nextRound={data.nextRound} />
            <p className="mt-3 text-[11px] text-muted-foreground">
              {metaLine(data.updatedBy, data.updatedAt)}
            </p>
          </>
        ) : (
          <>
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              No pattern set — the AI predictor is calling the rounds.
            </p>
            <span className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] font-black tracking-wider text-muted-foreground">
              AI PREDICTOR
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** AI mix — the source editor's generator (breaks runs at 3). */
function aiMix(): BottleCall[] {
  const out: BottleCall[] = [];
  let prev: BottleCall | null = null;
  let run = 0;
  for (let i = 0; i < 10; i++) {
    let c: BottleCall;
    if (prev && run >= 3) c = prev === "UP" ? "DOWN" : "UP";
    else c = Math.random() < 0.5 ? "UP" : "DOWN";
    if (c === prev) run++;
    else {
      prev = c;
      run = 1;
    }
    out.push(c);
  }
  return out;
}

export function BottleRoundsEditor() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<BottleCall[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["bottle-pattern"],
    queryFn: () => getBottlePattern(),
    retry: false,
  });
  const saved = data?.calls ?? null;

  useEffect(() => {
    if (data) setEdit(data.calls ? data.calls.slice() : aiMix());
  }, [data]);

  const { data: vp, refetch: refetchVp } = useQuery({
    queryKey: ["virtual-predictions"],
    queryFn: () => getVirtualPredictions(),
    retry: false,
  });

  const dirty = JSON.stringify(edit) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await setBottlePattern(edit, adminToken.get());
      setMsg("Live — players and staff now follow this pattern, in order, from round 1.");
      await qc.invalidateQueries({ queryKey: ["bottle-pattern"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save.");
    }
    setSaving(false);
  }

  async function clear() {
    if (!confirm("Clear the bottle pattern? The AI predictor takes over the calls.")) return;
    setSaving(true);
    setMsg(null);
    try {
      await setBottlePattern(null, adminToken.get());
      setMsg("Cleared — the AI predictor is calling again.");
      await qc.invalidateQueries({ queryKey: ["bottle-pattern"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to clear.");
    }
    setSaving(false);
  }

  async function toggleKillSwitch() {
    if (!vp) return;
    try {
      await setVirtualPredictions(!vp.enabled, adminToken.get());
      setMsg(
        !vp.enabled
          ? "Virtual predictions are ON — Mines, Spin da Bottle and the engines are live."
          : "Virtual predictions are OFF — every prediction page now shows the offline screen.",
      );
      await refetchVp();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to flip the switch.");
    }
  }

  return (
    <div className="space-y-5">
      {/* kill switch */}
      <div className="flex flex-wrap items-center gap-4 rounded-3xl border border-border bg-gradient-to-b from-slate-900 to-black p-5">
        <span
          className={cn(
            "grid size-11 place-items-center rounded-2xl",
            vp?.enabled ? "bg-success/10 text-success" : "bg-red-400/15 text-destructive",
          )}
        >
          <Power className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-black text-foreground">Virtual predictions kill switch</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Platform-wide. When OFF, every prediction surface — crash engines, Mines and
            Spin da Bottle — shows the “Predictions offline” screen. Passes keep their time.
          </p>
        </div>
        <button
          onClick={() => void toggleKillSwitch()}
          disabled={!vp}
          className={cn(
            "rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider text-foreground transition disabled:opacity-50",
            vp?.enabled
              ? "bg-red-500/80 hover:bg-red-500"
              : "bg-primary hover:brightness-110",
          )}
        >
          {!vp ? "Loading…" : vp.enabled ? "Switch off" : "Switch on"}
        </button>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider",
            vp?.enabled ? "bg-success/10 text-success" : "bg-red-400/15 text-destructive",
          )}
        >
          {!vp ? "…" : vp.enabled ? "Live" : "Offline"}
        </span>
      </div>

      {/* live now */}
      <div className="rounded-3xl border border-border bg-gradient-to-b from-slate-900 to-black p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground">
          Spin da Bottle
        </p>
        <h3 className="mt-1 text-xl font-black text-foreground">Live now</h3>
        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : saved ? (
          <>
            <p className="mb-3 mt-2 text-xs font-semibold text-success">
              Your pattern is LIVE — every game (players + staff) calls these rounds in
              order. The ringed chip is the next call the server serves.
            </p>
            <BottlePatternChips calls={saved} nextRound={data?.nextRound ?? null} />
            <p className="mt-3 text-[11px] text-muted-foreground">
              {metaLine(data?.updatedBy, data?.updatedAt)}
            </p>
          </>
        ) : (
          <>
            <p className="mb-3 mt-2 text-xs font-semibold text-muted-foreground">
              No pattern set — the AI predictor is calling the rounds.
            </p>
            <span className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] font-black tracking-wider text-muted-foreground">
              AI PREDICTOR
            </span>
          </>
        )}
      </div>

      {/* editor */}
      <div className="rounded-3xl border border-border bg-gradient-to-b from-slate-900 to-black p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground">
          Bottle Rounds editor
        </p>
        <h3 className="mt-1 text-xl font-black text-foreground">Set the next 10 rounds</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Tap UP or DOWN for each round, then Save. Saving restarts the shared sequence at
          round 1. Clear it and the AI predictor takes over again.
        </p>

        <div className="mt-4 space-y-2">
          {edit.map((c, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-2xl bg-white px-3 py-2"
            >
              <span className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                Round {i + 1}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setEdit((prev) => prev.map((v, j) => (j === i ? "UP" : v)))
                  }
                  className={cn(
                    "rounded-xl px-4 py-2 text-xs font-black transition",
                    c === "UP"
                      ? "bg-primary text-white shadow-[0_6px_18px_-6px_rgba(225,77,42,0.5)]"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted",
                  )}
                >
                  ▲ UP
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEdit((prev) => prev.map((v, j) => (j === i ? "DOWN" : v)))
                  }
                  className={cn(
                    "rounded-xl px-4 py-2 text-xs font-black transition",
                    c === "DOWN"
                      ? "bg-gradient-to-br from-red-400 to-rose-600 text-foreground shadow-[0_6px_18px_-6px_rgba(198,40,40,0.5)]"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted",
                  )}
                >
                  ▼ DOWN
                </button>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setEdit(aiMix())}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-foreground transition hover:bg-muted"
          >
            <Dices className="size-3.5" /> AI mix
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || (!dirty && !!saved)}
            className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <Save className="size-3.5" /> {saving ? "Saving…" : "Save — make live"}
          </button>
          <button
            onClick={() => void clear()}
            disabled={saving || !saved}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs font-bold text-destructive transition hover:bg-red-500/30 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" /> Clear — back to AI
          </button>
        </div>

        {msg && (
          <p
            className={cn(
              "mt-3 rounded-xl px-3 py-2 text-center text-xs font-semibold",
              msg.startsWith("Live") || msg.startsWith("Cleared") || msg.startsWith("Virtual")
                ? "bg-success/10 text-success"
                : "bg-warning/15 text-warning-foreground",
            )}
          >
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
