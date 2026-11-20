import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  GH_NETWORKS,
  NG_BANKS,
  SCAN_PLAN_FALLBACK,
  adminToken,
  scanPlanLabel,
  scanPlanTagline,
  simApprove,
  simDecline,
  simEntitlement,
  simExpire,
  simPay,
  simScans,
  simStart,
  userToken,
  type SimPayment,
  type SimRun,
  type SimScan,
} from "@/lib/api";
import { ResultCard as CrestResultCard } from "./simulator.scan-slip";
import { MaterialIcon } from "@/components/ui/material-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SendPaymentToCard, usePaymentDetails } from "@/components/ui/payment-details-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/simulator/scan")({
  component: ScanPage,
});

// A complete mirror of the real AI betting-slip scan page — hero, plan
// cards and the Buy and History tabs — running on the simulator's own
// rails only. The slip scanner itself lives on its own page now
// (/simulator/scan-slip), linked from here.
// No real scan purchase, session, AI call, upload or endpoint is involved
// anywhere on this page: buying goes through the sim payment flow
// (3-second auto-approve), analyses are generated locally, history lives
// in the sim tables only, and the payment screenshot never leaves this
// page (it is kept in local state, never sent anywhere).
const RUN_KEY = "darkweb_sim_run_id";
const NOTICE_KEY = "darkweb_sim_notice";

type TabId = "buy" | "history";

function ScanPage() {
  const navigate = useNavigate();
  const [saToken, setSaToken] = useState<string | null>(null);
  const [run, setRun] = useState<SimRun | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [history, setHistory] = useState<SimScan[]>([]);
  const [tab, setTab] = useState<TabId>("buy");
  const [email, setEmail] = useState("");
  // The sim account's email, from the run's own entitlement record
  // (simEntitlement returns email = the run's simIdentity). The Buy tab
  // shows it read-only, mirroring the real flow where purchases use the
  // account email. Analyze/History keep the free-typed lookup email.
  const [simEmail, setSimEmail] = useState("");
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

  // Restore the lobby's run (or start one) so access and history load
  // against the same run the lobby rendered.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!saToken || startedRef.current) return;
    startedRef.current = true;
    const savedRunId = window.sessionStorage.getItem(RUN_KEY);
    const savedToken = userToken.get();
    const restore = async () => {
      if (savedRunId && savedToken?.startsWith("simtok_")) {
        const r: SimRun = { runId: savedRunId, simIdentity: "", simToken: savedToken, expiresAt: "" };
        setRun(r);
        try {
          const me = await simEntitlement(r.runId, saToken);
          setHasAccess(!!me.scanAccess);
          setSimEmail(me.email ?? "");
          if (me.scanAccess) setHistory(await simScans(r.runId, saToken));
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
        setSimEmail(me.email ?? "");
      } catch {
        setError("Could not start. Please try again.");
      }
    };
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saToken]);

  const end = async () => {
    if (run && saToken) {
      try {
        await simExpire(run.runId, saToken);
      } catch {
        /* run expiry is best-effort; the token is cleared regardless */
      }
    }
    userToken.clear();
    window.sessionStorage.removeItem(RUN_KEY);
    window.sessionStorage.removeItem(NOTICE_KEY);
    navigate({ to: "/superadmin" });
  };

  if (!saToken) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar: back-to-lobby icon only */}
      <div className="sticky top-0 z-40 px-4 py-2">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3">
          <Link
            to="/simulator"
            aria-label="Back to games"
            title="Back to games"
            className="grid size-10 place-items-center rounded-full bg-card font-bold"
          >
            <MaterialIcon name="arrow_back" className="text-[20px]" />
          </Link>
        </div>
      </div>

      <div className={`mx-auto w-full max-w-[1400px] space-y-6 px-4 md:px-6 ${tab === "buy" ? "pb-5 pt-0" : "py-5"}`}>
        <div className="rounded-2xl border border-secondary/30 bg-secondary-soft px-4 py-3 text-sm font-bold text-secondary">
          SIMULATION — practice play only. No real money, no real credits.
        </div>
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

        {!run || hasAccess === null ? (
          <div className="grid place-items-center py-20">
            <MaterialIcon name="progress_activity" className="animate-spin text-[28px] text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Hero + plan cards render only outside the Buy (payment
                submission) view, so the Buy steps sit at the top. */}
            {tab !== "buy" && (
            <>
            {/* Hero — mirrors the real scan page's hero */}
            <section className="py-6 text-center sm:py-10">
              <h1 className="mt-5 text-4xl font-extrabold sm:text-5xl">AI betting-slip scan</h1>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
                Snap your slip. Our AI reads every pick printed on it and gives you its own call,
                with confidence and reasoning.
              </p>
              <img
                src="/games/instant-virtuals.png"
                alt="Instant Virtuals"
                className="mx-auto mt-8 aspect-[2/1] w-full max-w-xl rounded-2xl object-cover shadow-2xl ring-1 ring-border"
              />
            </section>

            {/* Plan cards — the same plan data the real page renders */}
            <section className="grid gap-6 md:grid-cols-3">
              {SCAN_PLAN_FALLBACK.map((p) => (
                <div key={p.code} className="flex flex-col border border-primary/15 bg-card rounded-2xl p-6">
                  <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                    {p.name}
                  </span>
                  <div className="mt-3 flex items-end gap-1">
                    <span className="text-lg font-semibold text-muted-foreground">GHS</span>
                    <span className="text-5xl font-extrabold tracking-tight">{p.amountCedis}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {p.maxPicks === "FULL"
                      ? "Every pick on the slip analysed"
                      : `${p.maxPicks} picks analysed per slip`}
                  </p>
                  <ul className="mt-5 flex-1 space-y-2.5 text-sm text-muted-foreground">
                    <li className="flex gap-2.5">
                      <MaterialIcon name="check_circle" className="mt-0.5 shrink-0 text-[18px] text-success" />
                      30 credits — 6 scans per pack, 5 credits each
                    </li>
                    <li className="flex gap-2.5">
                      <MaterialIcon name="check_circle" className="mt-0.5 shrink-0 text-[18px] text-success" />
                      Confidence + reasoning per pick
                    </li>
                    <li className="flex gap-2.5">
                      <MaterialIcon name="check_circle" className="mt-0.5 shrink-0 text-[18px] text-success" />
                      Saved to your history
                    </li>
                  </ul>
                  <p className="mt-5 bg-muted px-3 py-2 text-center text-xs font-bold tracking-wide">
                    {scanPlanTagline(p)}
                  </p>
                </div>
              ))}
            </section>
            </>
            )}

            <div className="mb-2">
              <Link
                to="/simulator/scan-slip"
                className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
              >
                Already paid? Scan your slip →
              </Link>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className={tab === "buy" ? "mt-4" : "mt-6"}>
              <TabsList className="flex h-auto w-full rounded-2xl p-1.5">
                <TabsTrigger value="buy" className="flex-1 rounded-xl px-3 py-2 text-xs sm:text-sm">
                  1. Buy a scan
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-1 rounded-xl px-3 py-2 text-xs sm:text-sm">
                  History
                </TabsTrigger>
              </TabsList>

              <TabsContent value="buy" className="mt-6">
                <BuyTab
                  run={run}
                  saToken={saToken}
                  hasAccess={hasAccess}
                  accountEmail={simEmail}
                  setEmail={setEmail}
                  setPurchaseId={setPurchaseId}
                  onApproved={() => setHasAccess(true)}
                  goScanSlip={() => void navigate({ to: "/simulator/scan-slip" })}
                  goWaiting={(paymentId) =>
                    void navigate({
                      to: "/simulator/waiting",
                      search: { game: "scan", paymentId },
                    })
                  }
                  setError={setError}
                />
              </TabsContent>
              <TabsContent value="history" className="mt-6">
                <HistoryTab
                  run={run}
                  saToken={saToken}
                  email={email}
                  setEmail={setEmail}
                  history={history}
                  setHistory={setHistory}
                  setError={setError}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buy tab — manual transfer + screenshot + review, on the sim rails:  */
/* submit creates a sim payment, approval fires on its own after 3      */
/* seconds and grants scan access. The screenshot file is kept in       */
/* local state only and is never sent anywhere.                        */
/* ------------------------------------------------------------------ */

function BuyTab({
  run,
  saToken,
  hasAccess,
  accountEmail,
  setEmail,
  setPurchaseId,
  onApproved,
  goScanSlip,
  goWaiting,
  setError,
}: {
  run: SimRun;
  saToken: string;
  hasAccess: boolean;
  accountEmail: string;
  setEmail: (v: string) => void;
  setPurchaseId: (v: string) => void;
  onApproved: () => void;
  goScanSlip: () => void;
  goWaiting: (paymentId: string) => void;
  setError: (v: string | null) => void;
}) {
  const [country, setCountry] = useState<"ghana" | "nigeria">("ghana");
  const [plan, setPlan] = useState(SCAN_PLAN_FALLBACK[0]!.code);
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [networkOrBank, setNetworkOrBank] = useState<string>(GH_NETWORKS[0]!);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [payment, setPayment] = useState<SimPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: details } = usePaymentDetails();
  // Two-step Buy flow, mirroring the real /scan page: step 1 shows the
  // amount + receiving details with a single "Paid" button; step 2 is the
  // payment details form + screenshot upload + submit on one page.
  const [step, setStep] = useState<1 | 2>(1);
  const simAmount = country === "nigeria" ? "75,000" : SCAN_PLAN_FALLBACK[0]!.amountCedis;
  const simCurrency = country === "ghana" ? "GHS" : "NGN";

  // Approval timer: submitting starts a 3-second wait, then approval
  // fires on its own — unless Cancel is pressed during the wait.
  const approveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearApproveTimer = () => {
    if (approveTimer.current) {
      clearTimeout(approveTimer.current);
      approveTimer.current = null;
    }
  };
  useEffect(() => () => clearApproveTimer(), []);

  const submit = async () => {
    if (!accountEmail.trim() || !accountName.trim() || !accountNumber.trim() || !reference.trim()) {
      setError("Fill in every field before submitting.");
      return;
    }
    if (!file) {
      setError("Attach a screenshot of your payment.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const p = await simPay(run.runId, "scan", saToken, {
        country,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        networkOrBank,
        reference: reference.trim(),
      });
      setPayment(p);
      setPurchaseId(p.id);
      // Keep the standalone slip-scan page's lookup prefill in sync with
      // the account used for this purchase.
      window.sessionStorage.setItem("darkweb_sim_scan_id", p.id);
      setEmail(accountEmail);
      window.sessionStorage.setItem("darkweb_sim_scan_email", accountEmail);
      // Fresh submits land on the waiting page (the 3-second
      // auto-approve runs there); Cancel during the wait lives there too.
      goWaiting(p.id);
    } catch {
      setError("Payment failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (paymentId: string) => {
    clearApproveTimer();
    try {
      const p = await simApprove(paymentId, saToken);
      setPayment(p);
      onApproved();
    } catch {
      setError("Payment failed. Please try again.");
    }
  };

  const cancel = async () => {
    if (!payment) return;
    clearApproveTimer();
    setBusy(true);
    try {
      const p = await simDecline(payment.id, saToken);
      setPayment(p);
    } catch {
      setError("Could not cancel. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="min-w-0 space-y-6">
        {step === 1 ? (
          <>
            <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Step 1 · Plan &amp; country
            </p>
            <div className="space-y-2">
              <Label htmlFor="sim-sm-plan">Scan plan</Label>
              <select
                id="sim-sm-plan"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="border-input bg-background h-12 w-full rounded-xl border px-3 text-sm"
              >
                {SCAN_PLAN_FALLBACK.map((p) => (
                  <option key={p.code} value={p.code}>
                    30 credits — {country === "nigeria" ? "NGN 75,000" : `GHS ${p.amountCedis}`}
                  </option>
                ))}
              </select>
            </div>
            <Tabs
              value={country}
              onValueChange={(v) => {
                const c = v as "ghana" | "nigeria";
                setCountry(c);
                setNetworkOrBank((c === "ghana" ? GH_NETWORKS : NG_BANKS)[0]!);
              }}
            >
              <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl p-1.5">
                <TabsTrigger value="ghana" className="min-w-0 rounded-xl px-3 py-2 text-xs whitespace-normal sm:text-sm">
                  Ghana — MoMo transfer
                </TabsTrigger>
                <TabsTrigger value="nigeria" className="min-w-0 rounded-xl px-3 py-2 text-xs whitespace-normal sm:text-sm">
                  Nigeria — Bank transfer
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-6 border border-primary/15 bg-card rounded-2xl p-6">
              <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                Amount to pay
              </p>
              <p className="text-4xl font-extrabold tracking-tight">
                {simCurrency} {simAmount}
              </p>
              <p className="text-sm text-muted-foreground">
                30 credits — each completed scan costs 5 · credits never expire ·{" "}
                {scanPlanTagline(SCAN_PLAN_FALLBACK[0]!)}
              </p>
            </div>

            {details && <SendPaymentToCard country={country} details={details} />}

            <button
              type="button"
              onClick={() => setStep(2)}
              className="h-12 w-full rounded-xl bg-primary px-5 text-sm font-bold text-white"
            >
              Paid
            </button>
          </>
        ) : (
          <>
            <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Step 2 · Payment details
            </p>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="h-11 rounded-xl bg-card px-5 text-sm font-bold"
            >
              ← Back
            </button>

            <div className="space-y-6 border border-primary/15 bg-card rounded-2xl p-6">
              <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sim-sm-email">Account email</Label>
              <Input
                id="sim-sm-email"
                type="email"
                readOnly
                className="h-12 rounded-xl"
                value={accountEmail}
              />
              <p className="text-xs text-muted-foreground">
                This purchase is tied to this account.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-s-an">Your account name</Label>
              <Input
                id="sim-s-an"
                className="h-12 rounded-xl"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-s-num">
                {country === "ghana" ? "Your MoMo number" : "Your account number"}
              </Label>
              <Input
                id="sim-s-num"
                className="h-12 rounded-xl"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{country === "ghana" ? "Network" : "Your bank"}</Label>
              <Select value={networkOrBank} onValueChange={setNetworkOrBank}>
                <SelectTrigger className="h-12 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(country === "ghana" ? GH_NETWORKS : NG_BANKS).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-s-ref">Transaction reference</Label>
              <Input
                id="sim-s-ref"
                className="h-12 rounded-xl"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Payment screenshot</Label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="border-input hover:border-primary hover:bg-accent/50 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 transition-colors"
              >
                <MaterialIcon name="upload" className="text-[24px] text-muted-foreground" />
                <span className="text-sm font-medium">
                  {file ? file.name : "Tap to upload (max 10MB)"}
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                The screenshot is only shown here — it is never sent anywhere.
              </p>
            </div>
            <div className="sm:col-span-2">
              <button
                onClick={() => void submit()}
                disabled={busy || !!payment}
                className="h-12 w-full rounded-xl bg-primary px-5 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? "Submitting…" : "Submit scan payment"}
              </button>
            </div>
          </div>
            </div>
          </>
        )}
      </div>

      <div className="h-fit min-w-0 border border-primary/15 bg-card rounded-2xl p-6">
        <h2 className="text-lg font-bold">Purchase status</h2>
        {hasAccess && !payment && (
          <p className="mt-4 text-sm text-success">
            Scan access is already active —{" "}
            <Link to="/simulator/scan-slip" className="font-bold underline">
              Scan your slip →
            </Link>
          </p>
        )}
        <div className="mt-4 space-y-2">
          <Label htmlFor="sim-pid">Purchase ID</Label>
          <Input
            id="sim-pid"
            readOnly
            className="h-12 rounded-xl font-mono text-xs"
            value={payment?.id ?? ""}
            placeholder="3b1a9d2e-…"
          />
        </div>

        {payment && (
          <div className="mt-5 space-y-3 text-sm">
            <StatusPill status={payment.status} />
            <p className="text-muted-foreground">
              Plan: {scanPlanLabel(SCAN_PLAN_FALLBACK[0]!.code)} · Picks: Full coverage
            </p>
            {payment.status === "PENDING" && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <MaterialIcon name="progress_activity" className="animate-spin text-[18px]" />
                Waiting for admin review…
              </p>
            )}
            {payment.status === "APPROVED" && (
              <>
                <p className="flex gap-2 text-success">
                  <MaterialIcon name="auto_awesome" className="shrink-0 text-[18px]" />
                  Approved —{" "}
                  <Link to="/simulator/scan-slip" className="font-bold underline">
                    Scan your slip →
                  </Link>
                </p>
                <button
                  onClick={goScanSlip}
                  className="rounded-xl bg-primary px-5 py-2 text-sm font-bold text-white"
                >
                  Go to Scan slip
                </button>
              </>
            )}
            {payment.status === "PENDING" && (
              <button
                onClick={() => void cancel()}
                disabled={busy}
                className="bg-destructive px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "bg-warning/20 text-warning-foreground",
    APPROVED: "bg-success/15 text-success",
    REJECTED: "bg-destructive/12 text-destructive",
  };
  return (
    <span
      className={`inline-flex px-3 py-1 text-xs font-bold tracking-wide ${map[status] ?? "bg-muted"}`}
    >
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* History tab — email + load + full result cards, like the real page. */
/* ------------------------------------------------------------------ */

function HistoryTab({
  run,
  saToken,
  email,
  setEmail,
  history,
  setHistory,
  setError,
}: {
  run: SimRun;
  saToken: string;
  email: string;
  setEmail: (v: string) => void;
  history: SimScan[];
  setHistory: (h: SimScan[]) => void;
  setError: (v: string | null) => void;
}) {
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await simScans(run.runId, saToken));
    } catch {
      setError("Could not load history. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border border-primary/15 bg-card rounded-2xl p-6 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="sim-h-email">Email</Label>
          <Input
            id="sim-h-email"
            type="email"
            className="h-12 rounded-xl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white disabled:opacity-50"
        >
          {loading && (
            <MaterialIcon name="progress_activity" className="animate-spin text-[18px]" />
          )}
          Load history
        </button>
      </div>

      {history.length ? (
        history.map((r) => (
          <div key={r.id} className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              {r.slipName ?? "Slip"}
              {r.createdAt ? ` · ${new Date(r.createdAt).toLocaleString()}` : ""}
            </p>
            <ResultCard result={r} />
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">No scans loaded yet.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History rows all render through the shared crest ResultCard — the
   same card as the fresh result page — so club logos and named AI
   picks show everywhere, permanently. Legacy fixture rows (stored
   before the sim ran the real AI) are adapted into prediction shape
   first: pick code stays the AI call, numeric confidence becomes a
   "NN%" badge (no bar — bars need a High/Medium/Low band). */

function ResultCard({ result }: { result: SimScan }) {
  if (result.predictions) return <CrestResultCard result={result} />;
  const picks = result.picks ?? [];
  const predictions = picks.map((p, i) => ({
    sectionIndex: i + 1,
    matchLabel: String(p.match ?? ""),
    originalPick: String(p.originalPick ?? p.pick ?? ""),
    prediction: String(p.prediction ?? p.pick ?? ""),
    confidence: p.confidence != null ? `${p.confidence}%` : "—",
    analysis: String(
      p.analysis ?? "The numbers lean this way — recent form and head-to-head both point to this call.",
    ),
  }));
  const adapted: SimScan = {
    ...result,
    scanPlan: result.scanPlan ?? SCAN_PLAN_FALLBACK[0]!.code,
    picksAnalyzed: picks.length,
    totalPicksDetected: picks.length,
    predictions,
  };
  return <CrestResultCard result={adapted} />;
}
