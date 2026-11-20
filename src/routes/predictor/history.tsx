import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { listAnalyses, type AnalysisRecord } from "@/lib/api";
import { Panel, DemoBadge, Skeleton, Field, inputCls, fmt } from "@/components/predictor/terminal";

export const Route = createFileRoute("/predictor/history")({
  component: PredictionHistory,
});

const NAMES: Record<string, string> = {
  aviator: "Aviator",
};

function PredictionHistory() {
  const [records, setRecords] = useState<AnalysisRecord[] | null>(null);
  const [gameFilter, setGameFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");

  useEffect(() => {
    listAnalyses().then(setRecords).catch(() => setRecords([]));
  }, []);

  const kinds = useMemo(() => [...new Set((records ?? []).map((r) => r.kind))], [records]);

  const filtered = (records ?? []).filter(
    (r) =>
      (gameFilter === "all" || r.gameId === gameFilter) &&
      (kindFilter === "all" || r.kind === kindFilter)
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-foreground md:text-2xl">Prediction history</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every saved analysis with its parameters, output and timestamp. Stored for this session —
          nothing here is a verified forecast.
        </p>
      </div>

      <Panel title="Filters" action={<DemoBadge />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Game">
            <select value={gameFilter} onChange={(e) => setGameFilter(e.target.value)} className={inputCls}>
              <option value="all">All games</option>
              {Object.entries(NAMES).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </Field>
          <Field label="Analysis type">
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className={inputCls}>
              <option value="all">All types</option>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
        </div>
      </Panel>

      <Panel title={`${filtered.length} record${filtered.length === 1 ? "" : "s"}`}>
        {!records ? (
          <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-bold text-muted-foreground">No analyses saved yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Run a target analysis on any crash game page and hit "Save to history" — it will appear here
              with its full parameters for later review.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((r) => (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-blue-500/15 px-2 py-0.5 text-[11px] font-bold text-blue-200">
                    {NAMES[r.gameId] ?? r.gameId}
                  </span>
                  <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{r.kind}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {r.note && <p className="mt-2 text-sm font-bold text-foreground">{r.note}</p>}
                <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
                  <div className="rounded-lg bg-white p-2.5">
                    <p className="mb-1 font-bold uppercase tracking-wider text-muted-foreground">Parameters</p>
                    <pre className="whitespace-pre-wrap tabular-nums text-muted-foreground">{JSON.stringify(r.params, null, 1)}</pre>
                  </div>
                  <div className="rounded-lg bg-white p-2.5">
                    <p className="mb-1 font-bold uppercase tracking-wider text-muted-foreground">Output</p>
                    <pre className="whitespace-pre-wrap tabular-nums text-muted-foreground">{JSON.stringify(summarize(r.output), null, 1)}</pre>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <Trash2 className="mt-0.5 size-3.5 shrink-0" />
          Records live in session memory and reset when the server restarts. A model is never
          judged on hit rate alone — calibration, sample size and out-of-sample behaviour matter more.
        </p>
      </Panel>
    </div>
  );
}

function summarize(output: Record<string, unknown>): Record<string, unknown> {
  const keep = ["hitRate", "wilson", "evPerUnit", "sampleSize", "target", "winRate", "netPnl"];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in output) out[k] = output[k];
  if (typeof out["hitRate"] === "number") out["hitRate"] = `${fmt(out["hitRate"] as number, 2)}%`;
  if (typeof out["evPerUnit"] === "number") out["evPerUnit"] = fmt(out["evPerUnit"] as number, 3);
  return out;
}
