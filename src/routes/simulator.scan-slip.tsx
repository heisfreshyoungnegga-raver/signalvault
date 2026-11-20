import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  adminToken,
  scanPlanLabel,
  simEntitlement,
  simScanFinalize,
  simScanGapfill,
  simScanTranscribe,
  simScanVerify,
  simStart,
  userToken,
  type CreditSummary,
  type Prediction,
  type ScanGrantState,
  type SimRun,
  type SimScan,
} from "@/lib/api";
import { downscaleSlipImage } from "@/lib/downscale-image";
import { ScanVideo, useImagePreview } from "@/components/predictor/ScanMedia";
import { FixtureHeader, PickBanner } from "@/components/predictor/ScanPickCard";
import { MaterialIcon } from "@/components/ui/material-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseFixture, slipPickLabel } from "@/lib/team-crests";

export const Route = createFileRoute("/simulator/scan-slip")({
  component: ScanSlipPage,
});

// Standalone sim slip-scan page: the Analyze section moved verbatim out
// of the /simulator/scan tab bar — slip upload + REAL AI analysis, on
// the simulator's own rails only. No real scan purchase, grant or
// result is involved anywhere on this page, and no simulator labels
// appear in the UI. The Buy tab keeps living on /simulator/scan; this
// page links back there.
const RUN_KEY = "darkweb_sim_run_id";
const EMAIL_KEY = "darkweb_sim_scan_email";
const PID_KEY = "darkweb_sim_scan_id";
// A completed sim scan gets its own page (/simulator/scan-result):
// the result is stored under this key and the scan page navigates
// there. The result page renders exactly what sim finalize returned —
// nothing pre-written.
export const SIM_SCAN_RESULT_KEY = "darkweb_sim_scan_result";

function ScanSlipPage() {
  const navigate = useNavigate();
  const [saToken, setSaToken] = useState<string | null>(null);
  const [run, setRun] = useState<SimRun | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [grant, setGrant] = useState<ScanGrantState | null>(null);
  const [credits, setCredits] = useState<CreditSummary | null>(null);
  const [email, setEmail] = useState("");
  const [purchaseId, setPurchaseId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Staff-only: superadmin session required, anything else is sent to
  // the superadmin login. A normal user token is NOT enough.
  useEffect(() => {
    const t = adminToken.get();
    if (!t || adminToken.role() !== "SUPER_ADMIN") {
      navigate({ to: "/superadmin/login" });
    } else {
      setSaToken(t);
    }
  }, [navigate]);

  // Restore the lobby's run (or start one) so access loads against the
  // same run the lobby rendered. Lookup fields prefill from the last
  // sim Buy submit, like the real page's localStorage prefill.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!saToken || startedRef.current) return;
    startedRef.current = true;
    setEmail(window.sessionStorage.getItem(EMAIL_KEY) ?? "");
    setPurchaseId(window.sessionStorage.getItem(PID_KEY) ?? "");
    const savedRunId = window.sessionStorage.getItem(RUN_KEY);
    const savedToken = userToken.get();
    const restore = async () => {
      if (savedRunId && savedToken?.startsWith("simtok_")) {
        const r: SimRun = { runId: savedRunId, simIdentity: "", simToken: savedToken, expiresAt: "" };
        setRun(r);
        try {
          const me = await simEntitlement(r.runId, saToken);
          setHasAccess(!!me.scanAccess);
          setGrant(me.scanGrant ?? null);
          setCredits(me.credits ?? null);
        } catch {
          setError("Could not load. Please try again.");
        }
        return;
      }
      try {
        const r = await simStart(saToken);
        setRun(r);
        userToken.set(r.simToken);
        window.sessionStorage.setItem(RUN_KEY, r.runId);
        const me = await simEntitlement(r.runId, saToken);
        setHasAccess(!!me.scanAccess);
        setGrant(me.scanGrant ?? null);
        setCredits(me.credits ?? null);
      } catch {
        setError("Could not start. Please try again.");
      }
    };
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saToken]);

  if (!saToken) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar: back-to-scan icon only */}
      <div className="sticky top-0 z-40 px-4 py-2">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3">
          <Link
            to="/simulator/scan"
            aria-label="Back to scan"
            title="Back to scan"
            className="grid size-10 place-items-center rounded-full bg-card font-bold"
          >
            <MaterialIcon name="arrow_back" className="text-[20px]" />
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-5 md:px-6">
        <div className="rounded-2xl border border-secondary/30 bg-secondary-soft px-4 py-3 text-sm font-bold text-secondary">
          SIMULATION — practice play only. No real money, no real credits.
        </div>
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

        <Link
          to="/simulator/scan"
          className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
        >
          ← Back to scan
        </Link>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Scan your slip</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Snap your slip. Our AI reads every pick printed on it and gives you its own call, with
            confidence and reasoning.
          </p>
        </div>

        {!run || hasAccess === null ? (
          <div className="grid place-items-center py-20">
            <MaterialIcon name="progress_activity" className="animate-spin text-[28px] text-muted-foreground" />
          </div>
        ) : (
          <AnalyzeTab
            run={run}
            saToken={saToken}
            hasAccess={hasAccess}
            grant={grant}
            credits={credits}
            onGrantRefresh={async () => {
              try {
                const me = await simEntitlement(run.runId, saToken);
                setHasAccess(!!me.scanAccess);
                setGrant(me.scanGrant ?? null);
                setCredits(me.credits ?? null);
              } catch {
                // Panel keeps its last state; the server gates scans.
              }
            }}
            email={email}
            setEmail={(v) => {
              setEmail(v);
              window.sessionStorage.setItem(EMAIL_KEY, v);
            }}
            purchaseId={purchaseId}
            setPurchaseId={(v) => {
              setPurchaseId(v);
              window.sessionStorage.setItem(PID_KEY, v);
            }}
            setError={setError}
            goBuy={() => void navigate({ to: "/simulator/scan" })}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analyze — slip upload + staged real-AI analysis, mirroring the      */
/* real page's form, stage progress, cancel and result card. Each      */
/* stage is its own invocation (<60s); only finalize consumes one     */
/* sim scan, after a completed analysis — failed or cancelled scans    */
/* consume nothing.                                                    */
/* ------------------------------------------------------------------ */

type SimScanStageKey = "preparing" | "reading" | "filling" | "checking" | "saving";

const SIM_STAGE_META: Record<SimScanStageKey, { label: string; pct: number }> = {
  preparing: { label: "Preparing your photo…", pct: 10 },
  reading: { label: "Reading teams…", pct: 35 },
  filling: { label: "Filling in missing games…", pct: 55 },
  checking: { label: "Double-checking teams…", pct: 75 },
  saving: { label: "Saving your result…", pct: 90 },
};

function AnalyzeTab({
  run,
  saToken,
  hasAccess,
  grant,
  credits,
  onGrantRefresh,
  email,
  setEmail,
  purchaseId,
  setPurchaseId,
  setError,
  goBuy,
}: {
  run: SimRun;
  saToken: string;
  hasAccess: boolean;
  grant: ScanGrantState | null;
  credits: CreditSummary | null;
  onGrantRefresh: () => Promise<void>;
  email: string;
  setEmail: (v: string) => void;
  purchaseId: string;
  setPurchaseId: (v: string) => void;
  setError: (v: string | null) => void;
  goBuy: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const preview = useImagePreview(file);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<SimScanStageKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<AbortController | null>(null);

  // CREDIT WALLET (2026-11-06): the panel reads the wallet, not the
  // legacy grant window. No countdown — credits never expire.
  const creditsBalance = credits?.balance ?? null;
  const scansAffordable = creditsBalance == null ? null : Math.floor(creditsBalance / 4);

  const analyze = async () => {
    if (!file) {
      setError("Upload your slip image first.");
      return;
    }
    // A new scan clears the previous result page: a failed or
    // cancelled scan must never leave a stale result behind.
    try {
      window.localStorage.removeItem(SIM_SCAN_RESULT_KEY);
    } catch {
      // Storage unavailable — the result page shows its empty state.
    }
    const ctrl = new AbortController();
    cancelRef.current = ctrl;
    const signal = ctrl.signal;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      // Downscale once; the SAME blob is re-sent for every stage so
      // transcription and verification judge the identical image.
      setStage("preparing");
      const down = await downscaleSlipImage(file);
      const blob = down.blob;

      setStage("reading");
      const t = await simScanTranscribe(run.runId, saToken, blob, signal);
      let picks: Prediction[] = t.picks;
      let total = t.totalPicksDetected;
      let missing = t.missingPositions;

      // Gap-fill runs at most 2 rounds, like the real page. A failed
      // round is non-fatal: verify lists the rest as unpredicted
      // rather than omitting or faking them.
      for (let round = 0; round < 2 && missing.length; round++) {
        setStage("filling");
        const g = await simScanGapfill(run.runId, saToken, blob, picks, total, signal);
        picks = g.picks;
        total = g.totalPicksDetected;
        missing = g.missingPositions;
      }

      setStage("checking");
      const v = await simScanVerify(run.runId, saToken, blob, picks, total, t.servingModel, signal);

      setStage("saving");
      const r = await simScanFinalize(run.runId, saToken, v.predictions, v.totalPicksDetected, file.name, signal);
      // The result gets its own page: store exactly what sim finalize
      // returned — the AI's read of THIS slip, nothing pre-written —
      // and go there. No second countdown after the video.
      try {
        window.localStorage.setItem(SIM_SCAN_RESULT_KEY, JSON.stringify(r));
      } catch {
        // Storage unavailable — the result page shows its empty state.
      }
      navigate({ to: "/simulator/scan-result" });
    } catch (err) {
      // Cancellation is not a failure: nothing was consumed, and the
      // grant panel below refreshes to prove it.
      if (ctrl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        setNotice("Scan cancelled — nothing was used.");
      } else {
        // Backend messages are specific (rate-limited, window ended,
        // used-up, timed out) — surface them verbatim, never a generic
        // "Analysis failed" that hides which one it was.
        setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
      }
    } finally {
      setBusy(false);
      setStage(null);
      cancelRef.current = null;
      // Refresh either way: a completed scan consumes one, a failed or
      // cancelled scan consumes nothing — the panel always shows the truth.
      await onGrantRefresh();
    }
  };

  function cancel() {
    cancelRef.current?.abort();
  }

  if (!hasAccess) {
    const lockedReason =
      creditsBalance != null && creditsBalance < 4
        ? "You're out of credits — each scan costs 4."
        : null;
    return (
      <div className="space-y-6 border border-primary/15 bg-card rounded-2xl p-6">
        <h2 className="text-xl font-bold">AI betting-slip scan</h2>
        <p className="text-sm text-muted-foreground">
          {lockedReason ??
            "Upload your slip and get AI picks on your selections. Top up credits first to unlock the scanner."}
        </p>
        <button
          onClick={goBuy}
          className="inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white"
        >
          Top up credits — GHS 400
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <div className="h-fit space-y-6 border border-primary/15 bg-card rounded-2xl p-6">
        <h2 className="text-xl font-bold">Upload your slip</h2>
        {notice && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-semibold">
            {notice}
          </div>
        )}
        {creditsBalance != null && (
          <div className="rounded-xl bg-primary/10 px-4 py-3 text-sm leading-relaxed">
            <span className="font-bold">{creditsBalance} credits</span>
            <span className="text-muted-foreground">
              {" "}· each scan costs 4 credits
              {scansAffordable != null && scansAffordable > 0 && (
                <> · {scansAffordable} {scansAffordable === 1 ? "scan" : "scans"} left</>
              )}
              {" "}· never expires
            </span>
          </div>
        )}
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="sim-a-pid">Purchase ID</Label>
            <Input
              id="sim-a-pid"
              className="h-12 rounded-xl font-mono text-xs"
              value={purchaseId}
              placeholder="Purchase ID (optional)"
              onChange={(e) => setPurchaseId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-a-email">Email</Label>
            <Input
              id="sim-a-email"
              type="email"
              className="h-12 rounded-xl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="border-input hover:border-primary hover:bg-accent/50 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 transition-colors"
          >
            {preview ? (
              <>
                <img
                  src={preview}
                  alt="Your slip"
                  className="max-h-56 w-full rounded-xl object-contain"
                />
                <span className="text-sm font-medium">Tap to change</span>
              </>
            ) : (
              <>
                <MaterialIcon name="upload" className="text-[24px] text-muted-foreground" />
                <span className="text-sm font-medium">Tap to upload slip</span>
              </>
            )}
          </button>
          {file && (
            <button
              type="button"
              onClick={() => setFile(null)}
              className="w-full text-sm font-semibold text-muted-foreground hover:underline"
            >
              Remove image
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <button
          onClick={() => void analyze()}
          disabled={busy || !file}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? (
            <MaterialIcon name="progress_activity" className="animate-spin text-[18px]" />
          ) : (
            <MaterialIcon name="document_scanner" className="text-[18px]" />
          )}
          Run AI scan
        </button>
        {busy && (
          <button
            type="button"
            onClick={cancel}
            className="mt-3 w-full text-sm font-semibold text-muted-foreground hover:underline"
          >
            Cancel scan
          </button>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          One pack = 12 credits. Each completed scan costs 4 credits — failed or
          cancelled scans cost nothing.
        </p>
      </div>

      <div>
        <div className="flex min-h-64 flex-col items-center justify-center border border-primary/15 bg-card rounded-2xl p-10 text-center">
            {busy ? (
              <ScanVideo
                label={stage ? SIM_STAGE_META[stage].label : "Reading your slip…"}
                pct={stage ? SIM_STAGE_META[stage].pct : null}
                onCancel={cancel}
                fallback={
                  <MaterialIcon name="progress_activity" className="animate-spin text-[28px] text-primary" />
                }
              />
            ) : (
              <>
                <MaterialIcon name="visibility" className="text-[32px] text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">
                  Your predictions will appear on the result page after the scan.
                </p>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result card — mirrors the real scan result: plan badge, analysed    */
/* counts, coverage note, and one card per pick (match, confidence     */
/* badge, slip pick, AI call, reasoning sentence) with the same        */
/* mismatch / unverified / unreadable flags as the real page.          */
/* ------------------------------------------------------------------ */

export function ResultCard({ result }: { result: SimScan }) {
  const predictions = result.predictions ?? [];
  return (
    <div className="border border-primary/15 bg-card rounded-2xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">Scan result</h2>
        <span className="bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
          {scanPlanLabel(result.scanPlan)}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {result.picksAnalyzed ?? predictions.length} of{" "}
        {result.totalPicksDetected ?? predictions.length} picks analysed
      </p>
      {result.coverageNote && (
        <p className="mt-4 rounded-xl bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
          {result.coverageNote}
        </p>
      )}

      {predictions.length ? (
        <ul className="mt-6 space-y-4">
          {predictions.map((p) => (
            <li key={`${p.sectionIndex}-${p.matchLabel}`} className="bg-muted/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FixtureHeader matchLabel={p.matchLabel} />
                <span className="border border-primary/40 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {p.confidence}
                </span>
              </div>
              {p.verification === "mismatch" && (
                <p className="mt-2 rounded-lg bg-warning/15 px-3 py-2 text-xs font-semibold text-warning-foreground">
                  ⚠ Check this one — the teams were hard to read, confirm against your slip.
                </p>
              )}
              {p.verification === "unverified" && (
                <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                  Not double-checked — confirm the teams match your slip.
                </p>
              )}
              {p.recovered && (
                <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                  Recovered on a second look — confirm against your slip.
                </p>
              )}
              <PickBanner
                prediction={p.prediction}
                fixture={parseFixture(p.matchLabel)}
                confidence={p.confidence}
              />
              {p.prediction === "unpredicted" || p.prediction === "unreadable" ? (
                <p className="mt-4 text-sm">
                  <span className="font-bold text-muted-foreground">Not predicted</span>
                </p>
              ) : (
                <p className="mt-4 text-sm">
                  AI call:{" "}
                  <span className="font-bold text-primary">{p.prediction}</span>
                </p>
              )}
              <p className="mt-2 text-sm">
                <span className="rounded-full bg-muted/60 px-2.5 py-1 text-xs font-semibold">
                  Slip pick: {slipPickLabel(p.originalPick, parseFixture(p.matchLabel))}
                </span>
              </p>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{p.analysis}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 bg-muted p-5 text-xs whitespace-pre-wrap">No predictions returned.</p>
      )}
    </div>
  );
}
