import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Brain, Loader2, ScanLine, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScanVideo, useImagePreview } from "@/components/predictor/ScanMedia";
import { FixtureHeader, PickBanner } from "@/components/predictor/ScanPickCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, scanPlanLabel, type ScanGrantSummary, type ScanResult } from "@/lib/api";
import { parseFixture, slipPickLabel } from "@/lib/team-crests";
import { downscaleSlipImage } from "@/lib/downscale-image";

export const Route = createFileRoute("/scan-slip")({
  head: () => ({
    meta: [
      { title: "Scan your slip — SignalVault" },
      {
        name: "description",
        content: "Upload your betting slip and get AI predictions on every pick.",
      },
      { property: "og:title", content: "Scan your slip — SignalVault" },
      {
        property: "og:description",
        content: "Credit packs from GH₵250. Each AI slip scan costs 4 credits — credits never expire.",
      },
    ],
  }),
  component: ScanSlipPage,
});

// Standalone slip-scan page: the Analyze tool moved verbatim out of the
// /scan tab bar — purchase ID/email + slip upload + full result cards
// with per-pick reasoning. No Buy hero, no plan cards, no Buy form here.
// Lookups stay exactly as the old Analyze tab: editable purchase ID and
// email, no account gate (the account-gate work left Analyze untouched).
// A completed scan gets its own page (/scan-result): the result is
// stored under this key and the scan page navigates there. The result
// page renders exactly what finalize returned — nothing pre-written.
export const SCAN_RESULT_KEY = "darkweb_scan_result";

function ScanSlipPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [purchaseId, setPurchaseId] = useState("");

  useEffect(() => {
    const e = window.localStorage.getItem("darkweb_email");
    if (e) setEmail(e);
    const p = window.localStorage.getItem("darkweb_scan_id");
    if (p) setPurchaseId(p);
  }, []);

  return (
    <div>
      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <Link to="/scan" search={{ tab: "buy" }} className="text-primary text-sm font-semibold hover:underline">
          ← Back to scan
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
          Scan your slip
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed sm:text-base">
          Snap your slip. Our AI reads every pick printed on it and gives you its own call, with
          confidence and reasoning.
        </p>
        <div className="mt-8">
          <AnalyzeSlip
            email={email}
            setEmail={setEmail}
            purchaseId={purchaseId}
            setPurchaseId={setPurchaseId}
          />
        </div>
      </section>
    </div>
  );
}

// Staged scan pipeline (async, past the 60s function wall). The old
// single-call /api/scan/analyze could run ~110s on dense slips, which
// Vercel kills at 60s with no result. Each stage below is its own
// invocation (<60s); the client orchestrates and shows real stage
// progress. No stage consumes anything — only finalize consumes, after
// a completed analysis, exactly like the old endpoint. Cancelling aborts
// the in-flight stage and stops the loop; nothing is consumed.
type ScanStageKey = "preparing" | "reading" | "filling" | "checking" | "saving";

const STAGE_META: Record<ScanStageKey, { label: string; pct: number }> = {
  preparing: { label: "Preparing your photo…", pct: 10 },
  reading: { label: "Reading teams…", pct: 35 },
  filling: { label: "Filling in missing games…", pct: 55 },
  checking: { label: "Double-checking teams…", pct: 75 },
  saving: { label: "Saving your result…", pct: 90 },
};

type ScanPick = NonNullable<ScanResult["predictions"]>[number];
type TranscribeOut = {
  picks: ScanPick[];
  totalPicksDetected: number;
  servingModel: string | null;
  missingPositions: number[];
};
type GapfillOut = {
  picks: ScanPick[];
  totalPicksDetected: number;
  recoveredPositions: number[];
  missingPositions: number[];
  gapfillFailed: boolean;
};
type VerifyOut = { predictions: ScanPick[]; totalPicksDetected: number };

function AnalyzeSlip({
  email,
  setEmail,
  purchaseId,
  setPurchaseId,
}: {
  email: string;
  setEmail: (v: string) => void;
  purchaseId: string;
  setPurchaseId: (v: string) => void;
}) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const preview = useImagePreview(file);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ScanStageKey | null>(null);
  const [grant, setGrant] = useState<ScanGrantSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<AbortController | null>(null);

  const refreshGrant = useCallback(async () => {
    if (!email.trim().includes("@")) return;
    try {
      const q = `email=${encodeURIComponent(email.trim())}${
        purchaseId.trim()
          ? `&purchaseId=${encodeURIComponent(purchaseId.trim())}`
          : ""
      }`;
      setGrant(await api<ScanGrantSummary>(`/api/scan/grant?${q}`));
    } catch {
      // Server gates every analysis anyway; a failed grant lookup must
      // never block the form.
    }
  }, [email, purchaseId]);

  useEffect(() => {
    void refreshGrant();
  }, [refreshGrant]);

  // CREDIT WALLET (2026-11-06): the panel reads the wallet, not the
  // legacy grant window. No countdown any more — credits never expire.
  const creditsBalance = grant?.credits?.balance ?? null;
  const scansAffordable = creditsBalance == null ? null : Math.floor(creditsBalance / 4);
  const outOfCredits = creditsBalance != null && creditsBalance < 4;

  const locked =
    grant != null &&
    (outOfCredits ||
      grant.state === "used-up" ||
      grant.state === "expired" ||
      grant.state === "awaiting" ||
      grant.state === "rejected" ||
      (grant.state === "no-grant" && purchaseId.trim() !== ""));

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Upload your slip image first.");
      return;
    }
    // A new scan clears the previous result page: a failed or
    // cancelled scan must never leave a stale result behind.
    try {
      window.localStorage.removeItem(SCAN_RESULT_KEY);
    } catch {
      // Storage unavailable — the result page shows its empty state.
    }
    const ctrl = new AbortController();
    cancelRef.current = ctrl;
    setBusy(true);
    try {
      // Downscale once; the SAME blob is re-sent for every stage so
      // transcription and verification judge the identical image.
      setStage("preparing");
      const down = await downscaleSlipImage(file);
      const blob = down.blob;
      const stageForm = (extra?: (f: FormData) => void) => {
        const form = new FormData();
        form.set("purchaseId", purchaseId.trim());
        form.set("email", email.trim());
        form.set("image", blob, "slip.jpg");
        if (extra) extra(form);
        return form;
      };
      const signal = ctrl.signal;

      setStage("reading");
      const t = await api<TranscribeOut>("/api/scan/stage/transcribe", {
        form: stageForm(),
        signal,
      });
      let picks = t.picks;
      let total = t.totalPicksDetected;
      let missing = t.missingPositions;

      // Gap-fill runs at most 2 rounds, like the old single-call path.
      // A failed round is non-fatal: verify lists the rest as
      // unpredicted rather than omitting or faking them.
      for (let round = 0; round < 2 && missing.length; round++) {
        setStage("filling");
        const g = await api<GapfillOut>("/api/scan/stage/gapfill", {
          form: stageForm((f) => {
            f.set("picks", JSON.stringify(picks));
            f.set("totalPicksDetected", String(total));
          }),
          signal,
        });
        picks = g.picks;
        total = g.totalPicksDetected;
        missing = g.missingPositions;
      }

      setStage("checking");
      const v = await api<VerifyOut>("/api/scan/stage/verify", {
        form: stageForm((f) => {
          f.set("picks", JSON.stringify(picks));
          f.set("totalPicksDetected", String(total));
          if (t.servingModel) f.set("servingModel", t.servingModel);
        }),
        signal,
      });

      setStage("saving");
      const data = await api<ScanResult>("/api/scan/stage/finalize", {
        method: "POST",
        body: {
          purchaseId: purchaseId.trim(),
          email: email.trim(),
          predictions: v.predictions,
          totalPicksDetected: v.totalPicksDetected,
        },
        signal,
      });
      // The result gets its own page: store exactly what finalize
      // returned — the AI's read of THIS slip, nothing pre-written —
      // and go there. No second countdown after the video.
      try {
        window.localStorage.setItem(SCAN_RESULT_KEY, JSON.stringify(data));
      } catch {
        // Storage unavailable — the result page shows its empty state.
      }
      toast.success("Scan complete!");
      navigate({ to: "/scan-result" });
    } catch (err) {
      // Cancellation is not a failure: nothing was consumed, and the
      // grant panel below refreshes to prove it.
      if (ctrl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        toast("Scan cancelled — nothing was used.");
      } else {
        // Backend messages are specific (rate-limited, window ended,
        // used-up, timed out) — surface them verbatim, never a generic
        // "Scan failed" that hides which one it was.
        toast.error(err instanceof Error ? err.message : "Scan failed");
      }
    } finally {
      setBusy(false);
      setStage(null);
      cancelRef.current = null;
      // Refresh either way: a completed scan consumes one, a failed or
      // cancelled scan consumes nothing — the panel always shows the truth.
      void refreshGrant();
    }
  }

  function cancel() {
    cancelRef.current?.abort();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <form onSubmit={run} className="card-surface h-fit p-6 sm:p-8">
        <h2 className="text-xl font-bold">Upload your slip</h2>
        {grant && creditsBalance != null && (
          <div className="mt-4 rounded-xl bg-primary/10 px-4 py-3 text-sm leading-relaxed">
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
        {grant && locked && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm leading-relaxed">
            {outOfCredits && (
              <>You&apos;re out of credits — each scan costs 4.</>
            )}
            {!outOfCredits && grant.state === "used-up" && (
              <>You&apos;ve used all the scans on this purchase.</>
            )}
            {!outOfCredits && grant.state === "expired" && <>Your scan window has ended.</>}
            {!outOfCredits && grant.state === "awaiting" && <>This purchase is still awaiting admin review.</>}
            {!outOfCredits && grant.state === "rejected" && <>This purchase was rejected.</>}
            {!outOfCredits && grant.state === "no-grant" && <>No active scan purchase for this email.</>}
            {(outOfCredits ||
              grant.state === "used-up" ||
              grant.state === "expired" ||
              grant.state === "rejected" ||
              grant.state === "no-grant") && (
              <>
                {" "}
                <Link to="/scan" search={{ tab: "buy" }} className="font-bold text-primary hover:underline">
                  Top up credits →
                </Link>
              </>
            )}
          </div>
        )}
        <div className="mt-5 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="a-pid">Purchase ID</Label>
            <Input
              id="a-pid"
              required
              className="h-12 rounded-xl font-mono text-xs"
              value={purchaseId}
              onChange={(e) => setPurchaseId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-email">Email</Label>
            <Input
              id="a-email"
              type="email"
              required
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
                <Upload className="text-muted-foreground size-6" />
                <span className="text-sm font-medium">Tap to upload slip</span>
              </>
            )}
          </button>
          {file && (
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-muted-foreground w-full text-sm font-semibold hover:underline"
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
        <Button type="submit" size="lg" disabled={busy || locked} className="mt-7 h-12 w-full rounded-xl">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
          Run AI scan
        </Button>
        {busy && (
          <button
            type="button"
            onClick={cancel}
            className="text-muted-foreground mt-3 w-full text-sm font-semibold hover:underline"
          >
            Cancel scan
          </button>
        )}
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          Credit packs from GH₵250. Each completed scan costs 4 credits — failed or
          cancelled scans cost nothing.
        </p>
      </form>

      <div>
        <EmptyResult busy={busy} stage={stage} onCancel={cancel} />
      </div>
    </div>
  );
}

function EmptyResult({
  busy,
  stage,
  onCancel,
}: {
  busy: boolean;
  stage: ScanStageKey | null;
  onCancel: () => void;
}) {
  const meta = stage ? STAGE_META[stage] : null;
  return (
    <div className="card-surface flex min-h-64 flex-col items-center justify-center p-10 text-center">
      {busy ? (
        <ScanVideo
          label={meta?.label ?? "Reading your slip…"}
          pct={meta?.pct ?? null}
          onCancel={onCancel}
          fallback={<Loader2 className="text-primary size-7 animate-spin" />}
        />
      ) : (
        <>
          <Brain className="text-muted-foreground size-8" />
          <p className="text-muted-foreground mt-4 text-sm">
            Your predictions will appear on the result page after the scan.
          </p>
        </>
      )}
    </div>
  );
}

export function ResultCard({ result }: { result: ScanResult }) {
  return (
    <div className="animate-rise card-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">Scan result</h2>
        <span className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-xs font-bold">
          {scanPlanLabel(result.scanPlan)}
        </span>
      </div>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {result.picksAnalyzed} of {result.totalPicksDetected} picks analysed
      </p>
      {result.coverageNote && (
        <p className="bg-muted text-muted-foreground mt-4 rounded-xl p-4 text-sm leading-relaxed">
          {result.coverageNote}
        </p>
      )}

      {result.predictions?.length ? (
        <ul className="mt-6 space-y-4">
          {result.predictions.map((p) => (
            <li key={`${p.sectionIndex}-${p.matchLabel}`} className="bg-muted/60 rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FixtureHeader matchLabel={p.matchLabel} />
                <span className="border-primary/40 text-primary rounded-full border px-2.5 py-0.5 text-xs font-semibold">
                  {p.confidence}
                </span>
              </div>
              {p.verification === 'mismatch' && (
                <p className="mt-2 rounded-lg bg-warning/15 px-3 py-2 text-xs font-semibold text-warning-foreground">
                  Check this one — the teams were hard to read, confirm against your slip.
                </p>
              )}
              {p.verification === 'unverified' && (
                <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                  Not double-checked — confirm the teams match your slip.
                </p>
              )}
              {p.recovered && (
                <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                  Recovered on a second look — confirm against your slip.
                </p>
              )}
              <PickBanner
                prediction={p.prediction}
                fixture={parseFixture(p.matchLabel)}
                confidence={p.confidence}
              />
              {p.prediction === 'unpredicted' || p.prediction === 'unreadable' ? (
                <p className="mt-4 text-sm">
                  <span className="text-muted-foreground font-bold">Not predicted</span>
                </p>
              ) : (
                <p className="mt-4 text-sm">
                  AI call: <span className="text-primary font-bold">{p.prediction}</span>
                </p>
              )}
              <p className="mt-2 text-sm">
                <span className="bg-muted rounded-full px-2.5 py-1 text-xs font-semibold">
                  Slip pick: {slipPickLabel(p.originalPick, parseFixture(p.matchLabel))}
                </span>
              </p>
              <p className="text-muted-foreground mt-2.5 text-sm leading-relaxed">{p.analysis}</p>
            </li>
          ))}
        </ul>
      ) : (
        <pre className="bg-muted mt-6 overflow-auto rounded-2xl p-5 text-xs whitespace-pre-wrap">
          {result.rawModelOutput ?? result.note ?? "No predictions returned."}
        </pre>
      )}
    </div>
  );
}
