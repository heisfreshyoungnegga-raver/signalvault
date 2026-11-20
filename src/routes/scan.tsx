import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Sparkles, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useImagePreview } from "@/components/predictor/ScanMedia";
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
import {
  api,
  ApiError,
  creditsForAmountGhs,
  GH_NETWORKS,
  nairaForScanCode,
  NG_BANKS,
  picksLabel,
  SCAN_PLAN_FALLBACK,
  scanPlanLabel,
  scanPlanTagline,
  usdApprox,
  userToken,
  type AccountUser,
  type ScanPlan,
  type ScanResult,
  type ScanStatus,
  type UploadData,
} from "@/lib/api";
import { ResultCard } from "./scan-slip";

export const Route = createFileRoute("/scan")({
  // Optional ?tab=history|buy — the slip scanner lives on its own page
  // now (/scan-slip); an old ?tab=analyze deep link redirects there.
  // Absent or unknown: Buy.
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  head: () => ({
    meta: [
      { title: "AI betting-slip scan — SignalVault" },
      {
        name: "description",
        content: "Buy a scan plan and get AI predictions on your picks.",
      },
      { property: "og:title", content: "AI betting-slip scan — SignalVault" },
      {
        property: "og:description",
        content: "Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80. Each AI slip scan costs 5 credits — credits never expire.",
      },
    ],
  }),
  component: ScanPage,
});

function ScanPage() {
  const [email, setEmail] = useState("");
  const [purchaseId, setPurchaseId] = useState("");
  // Controlled tab state: the hero + plan cards render only outside the
  // Buy (payment submission) view, so the Buy steps sit at the top.
  const [tab, setTab] = useState<"buy" | "history">("buy");
  const { tab: tabParam } = Route.useSearch();
  const navigate = useNavigate();
  // Honor ?tab=… on mount (effect, not initial state, so the first render
  // still matches the server and can't hydrate-mismatch). An old
  // ?tab=analyze link lands on the standalone slip-scan page instead.
  useEffect(() => {
    if (tabParam === "analyze") {
      void navigate({ to: "/scan-slip", replace: true });
    } else if (tabParam === "history" || tabParam === "buy") {
      setTab(tabParam);
    }
  }, [tabParam, navigate]);

  useEffect(() => {
    const e = window.localStorage.getItem("darkweb_email");
    if (e) setEmail(e);
    const p = window.localStorage.getItem("darkweb_scan_id");
    if (p) setPurchaseId(p);
  }, []);

  // Purchases require an account: the same session mechanism as the
  // predictor gates — session token + GET /api/auth/me. The Buy form
  // renders only for a logged-in account, and it submits that account's
  // email (never a typed one). Analyze/History are post-purchase lookups
  // and keep their own email field, untouched.
  // The gate decision waits for mount: the server has no session token,
  // so deciding during render would hydrate-mismatch (React #418) between
  // the server's gate panel and the client's loading state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const token = typeof window !== "undefined" ? userToken.get() : null;
  const {
    data: me,
    isLoading: meLoading,
    error: meError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<AccountUser>("/api/auth/me", { token: token ?? null }),
    enabled: !!token,
    retry: false,
  });
  const meUnauthorized = meError instanceof ApiError && meError.status === 401;
  useEffect(() => {
    if (meUnauthorized) userToken.clear();
  }, [meUnauthorized]);
  const buyGated = !token || !!meError;

  const { data: plans = SCAN_PLAN_FALLBACK } = useQuery({
    queryKey: ["scan-plans"],
    queryFn: () => api<ScanPlan[]>("/api/scan/payment/plans"),
    retry: false,
    placeholderData: SCAN_PLAN_FALLBACK,
  });

  return (
    <div>
      {tab !== "buy" && (
      <section className="border-b border-border bg-background-alt">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <h1 className="animate-rise mt-5 text-4xl font-black text-foreground sm:text-5xl">
            AI betting-slip scan
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base leading-relaxed">
            Snap your slip. Our AI reads every pick printed on it and gives you its own call, with
            confidence and reasoning.
          </p>
          <img
            src="/games/instant-virtuals.png"
            alt="Slip Scan"
            className="mx-auto mt-8 aspect-[2/1] w-full max-w-xl rounded-2xl border border-border object-cover shadow-soft"
          />
        </div>
      </section>
      )}

      <section className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${tab === "buy" ? "pb-12 pt-2 sm:pb-16" : "py-12 sm:py-16"}`}>
        <>
          {tab !== "buy" && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((p, i) => (
              <div
                key={p.code}
                className={`card-surface card-hover animate-rise flex flex-col p-6 ${
                  p.name === "STANDARD" ? "ring-secondary/50 ring-2" : ""
                }`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <span className="text-xs font-bold text-muted-foreground">{p.name}</span>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-muted-foreground text-lg font-semibold">GHS</span>
                  <span className="font-display text-5xl font-black tracking-tight">{p.amountCedis}</span>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">{usdApprox(p.amountCedis)}</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  {p.maxPicks === "FULL"
                    ? "Every pick on the slip analysed"
                    : `${p.maxPicks} picks analysed per slip`}
                </p>
                <ul className="text-muted-foreground mt-5 flex-1 space-y-2.5 text-sm">
                  <li className="flex gap-2.5">
                    <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" /> {creditsForAmountGhs(p.amountCedis) ?? 30} credits — {Math.floor((creditsForAmountGhs(p.amountCedis) ?? 30) / 5)} scans per pack, 5 credits each
                  </li>
                  <li className="flex gap-2.5">
                    <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" /> Confidence +
                    reasoning per pick
                  </li>
                  <li className="flex gap-2.5">
                    <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" /> Saved to your
                    history
                  </li>
                </ul>
                <p className="bg-muted mt-5 rounded-lg px-3 py-2 text-center text-xs font-bold tracking-wide">
                  {scanPlanTagline(p)}
                </p>
              </div>
            ))}
          </div>
          )}

          <div className="mb-6">
            <Link
              to="/scan-slip"
              className="text-primary inline-flex items-center gap-1 text-sm font-bold hover:underline"
            >
              Already paid? Scan your slip →
            </Link>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "buy" | "history")} className={tab === "buy" ? "mt-4" : "mt-12"}>
            <TabsList className="h-auto w-full rounded-2xl p-1.5 sm:w-auto">
              <TabsTrigger value="buy" className="rounded-xl px-4 py-2 text-sm">
                1. Buy a scan
              </TabsTrigger>
              <TabsTrigger value="history" className="rounded-xl px-4 py-2 text-sm">
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="buy" className="mt-6">
              {!mounted || meLoading ? (
                <div className="grid place-items-center py-20">
                  <Loader2 className="text-muted-foreground size-8 animate-spin" />
                </div>
              ) : buyGated ? (
                <div className="card-surface space-y-4 p-6 text-center sm:p-8">
                  <h2 className="text-lg font-bold">You need an account to buy a scan</h2>
                  <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">
                    Log in to continue your purchase — the scan will be tied to your account
                    email.
                  </p>
                  <Button asChild size="lg" className="h-12 w-full rounded-xl sm:w-auto">
                    <Link to="/login" search={{ redirect: "/scan" }}>
                      Log in
                    </Link>
                  </Button>
                  <p className="text-muted-foreground text-sm">
                    No account yet?{" "}
                    <Link to="/register" className="text-primary font-semibold hover:underline">
                      Register
                    </Link>
                  </p>
                </div>
              ) : meLoading || !me ? (
                <div className="grid place-items-center py-20">
                  <Loader2 className="text-muted-foreground size-8 animate-spin" />
                </div>
              ) : (
                <BuyScan
                  plans={plans}
                  accountEmail={me.email}
                  onPurchasedEmail={setEmail}
                  purchaseId={purchaseId}
                  setPurchaseId={setPurchaseId}
                />
              )}
            </TabsContent>
            <TabsContent value="history" className="mt-6">
              <ScanHistory email={email} />
            </TabsContent>
          </Tabs>
        </>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buy a single-slip scan — manual transfer + proof + admin review     */
/* (Ghana: MoMo transfer; Nigeria: bank transfer)                      */
/* ------------------------------------------------------------------ */

function BuyScan({
  plans,
  accountEmail,
  onPurchasedEmail,
  purchaseId,
  setPurchaseId,
}: {
  plans: ScanPlan[];
  accountEmail: string;
  onPurchasedEmail: (v: string) => void;
  purchaseId: string;
  setPurchaseId: (v: string) => void;
}) {
  const navigate = useNavigate();
  const [country, setCountry] = useState<"ghana" | "nigeria">("ghana");
  const [plan, setPlan] = useState("");

  // Keep the selected plan in sync with the live catalogue (the code is
  // payload-only; the select renders human names).
  useEffect(() => {
    if (plans.length && !plans.some((p) => p.code === plan)) {
      setPlan(plans[0]!.code);
    }
  }, [plans, plan]);
  // Two-step Buy flow: step 1 shows the amount + receiving details with
  // a single "Paid" button; step 2 is the payment details form +
  // screenshot upload + submit on one page. The submit payload is unchanged.
  const [step, setStep] = useState<1 | 2>(1);
  const selectedPlan = plans.find((p) => p.code === plan) ?? plans[0];
  const [busy, setBusy] = useState(false);
  const { data: details } = usePaymentDetails();

  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [networkOrBank, setNetworkOrBank] = useState(GH_NETWORKS[0]!);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const preview = useImagePreview(file);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: status } = useQuery({
    queryKey: ["scan-status", purchaseId],
    queryFn: () => api<ScanStatus>(`/api/scan/payment/status/${purchaseId}`),
    enabled: purchaseId.length > 0,
    refetchInterval: (q) => {
      const s = (q.state.data as ScanStatus | undefined)?.status;
      return s === "PENDING" ? 5000 : false;
    },
    retry: false,
  });

  async function buyManual(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Attach a screenshot of your payment.");
      return;
    }
    setBusy(true);
    try {
      const upForm = new FormData();
      upForm.set("image", file);
      const up = await api<UploadData>("/api/upload", { form: upForm });
      const data = await api<ScanStatus>("/api/scan/payment/submit", {
        method: "POST",
        body: {
          email: accountEmail,
          plan,
          accountName: accountName.trim(),
          accountNumber: accountNumber.trim(),
          networkOrBank: networkOrBank.trim(),
          reference: reference.trim(),
          screenshotUrl: up.url,
        },
      });
      setPurchaseId(data.id);
      window.localStorage.setItem("darkweb_scan_id", data.id);
      window.localStorage.setItem("darkweb_email", accountEmail);
      onPurchasedEmail(accountEmail);
      toast.success("Scan payment submitted — awaiting review.");
      // Fresh submits land on the waiting page; the stored id above keeps
      // the inline status panel working for return visits.
      void navigate({ to: "/payment/waiting", search: { rail: "scan", id: data.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="min-w-0 space-y-6">
        {step === 1 ? (
          <>
            <p className="text-xs font-bold text-muted-foreground">Step 1 — Plan &amp; country</p>
            <div className="space-y-2">
              <Label htmlFor="sm-plan">Scan plan</Label>
              <select
                id="sm-plan"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="border-input bg-background h-12 w-full rounded-xl border px-3 text-sm"
              >
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {creditsForAmountGhs(p.amountCedis) ?? 30} credits —{" "}
                    {country === "nigeria"
                      ? `NGN ${(nairaForScanCode(p.code) ?? 0).toLocaleString()}`
                      : `GHS ${p.amountCedis}`}
                    {p.code === "SCAN_1000" ? " · Best value" : ""}
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
                <TabsTrigger value="ghana" className="min-w-0 rounded-xl px-3 py-2 text-sm whitespace-normal">
                  Ghana — MoMo transfer
                </TabsTrigger>
                <TabsTrigger value="nigeria" className="min-w-0 rounded-xl px-3 py-2 text-sm whitespace-normal">
                  Nigeria — Bank transfer
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="card-surface overflow-hidden p-6 sm:p-8">
              <div className="kente-strip -mx-6 -mt-6 mb-5 h-[6px] w-[calc(100%+3rem)] sm:-mx-8 sm:-mt-8 sm:w-[calc(100%+4rem)]" aria-hidden />
              <p className="text-xs font-bold text-muted-foreground">Amount to pay</p>
              <p className="mt-3 font-display text-5xl font-black tracking-tight">
                {country === "nigeria"
                  ? `NGN ${(selectedPlan ? nairaForScanCode(selectedPlan.code) ?? 0 : 0).toLocaleString()}`
                  : `GHS ${selectedPlan?.amountCedis}`}
              </p>
              {country === "ghana" && selectedPlan && (
                <p className="text-muted-foreground mt-1 text-sm">{usdApprox(selectedPlan.amountCedis)}</p>
              )}
              {selectedPlan && (
                <p className="text-muted-foreground mt-2 text-sm">
                  {creditsForAmountGhs(selectedPlan.amountCedis) ?? 30} credits — each completed scan costs 5 · credits never expire · {scanPlanTagline(selectedPlan)}
                </p>
              )}
            </div>

            {details && <SendPaymentToCard country={country} details={details} />}

            <Button
              type="button"
              size="lg"
              onClick={() => setStep(2)}
              className="h-12 w-full rounded-xl"
            >
              Paid
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs font-bold text-muted-foreground">Step 2 — Payment details</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(1)}
              className="h-11 rounded-xl"
            >
              ← Back
            </Button>

            <div className="card-surface p-6 sm:p-8">
              <form onSubmit={buyManual} className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sm-email">Account email</Label>
              <Input
                id="sm-email"
                type="email"
                required
                readOnly
                className="h-12 rounded-xl"
                value={accountEmail}
              />
              <p className="text-xs text-muted-foreground">
                This purchase is tied to your account.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-an">Your account name</Label>
              <Input
                id="s-an"
                required
                className="h-12 rounded-xl"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-num">
                {country === "ghana" ? "Your MoMo number" : "Your account number"}
              </Label>
              <Input
                id="s-num"
                required
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
              <Label htmlFor="s-ref">Transaction reference</Label>
              <Input
                id="s-ref"
                required
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
                {preview ? (
                  <>
                    <img
                      src={preview}
                      alt="Payment screenshot"
                      className="max-h-56 w-full rounded-xl object-contain"
                    />
                    <span className="text-sm font-medium">Tap to change</span>
                  </>
                ) : (
                  <>
                    <Upload className="text-muted-foreground size-6" />
                    <span className="text-sm font-medium">Tap to upload (max 10MB)</span>
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
            <div className="sm:col-span-2">
              <Button type="submit" size="lg" disabled={busy} className="h-12 w-full rounded-xl">
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Submit scan payment
              </Button>
            </div>
          </form>
            </div>
          </>
        )}
      </div>

      <div className="card-surface h-fit min-w-0 p-6">
        <h2 className="text-lg font-bold">Purchase status</h2>
        <div className="mt-4 space-y-2">
          <Label htmlFor="pid">Purchase ID</Label>
          <Input
            id="pid"
            className="h-12 rounded-xl font-mono text-xs"
            value={purchaseId}
            placeholder="3b1a9d2e-…"
            onChange={(e) => {
              setPurchaseId(e.target.value);
              window.localStorage.setItem("darkweb_scan_id", e.target.value);
            }}
          />
        </div>

        {status && (
          <div className="mt-5 space-y-3 text-sm">
            <StatusPill status={status.status} />
            <p className="text-muted-foreground">
              Plan: {scanPlanLabel(status.scanPlan)} · Picks: {picksLabel(status.maxPicks)}
            </p>
            {status.rejectionReason && (
              <p className="text-destructive">Reason: {status.rejectionReason}</p>
            )}
            {status.status === "PENDING" && (
              <p className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Waiting for admin review…
              </p>
            )}
            {status.status === "APPROVED" && (
              <p className="text-success flex gap-2">
                <Sparkles className="size-4 shrink-0" /> Approved —{" "}
                <Link to="/scan-slip" className="font-semibold hover:underline">
                  Scan your slip →
                </Link>
              </p>
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
    AWAITING_PAYMENT: "bg-warning/20 text-warning-foreground",
    APPROVED: "bg-success/15 text-success",
    REJECTED: "bg-destructive/12 text-destructive",
    USED: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold tracking-wide ${map[status] ?? "bg-muted"}`}
    >
      {status}
    </span>
  );
}

function ScanHistory({ email }: { email: string }) {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["scan-history", email],
    queryFn: () => api<ScanResult[]>(`/api/scan/history?email=${encodeURIComponent(email)}`, {}),
    enabled: false,
    retry: false,
  });

  return (
    <div className="space-y-6">
      <div className="card-surface flex flex-col gap-3 p-6 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label>Email</Label>
          <Input readOnly value={email} className="h-12 rounded-xl" />
        </div>
        <Button
          className="h-12 rounded-xl"
          disabled={!email || isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? <Loader2 className="size-4 animate-spin" /> : null} Load history
        </Button>
      </div>

      {data?.length ? (
        data.map((r) => <ResultCard key={r.id} result={r} />)
      ) : (
        <p className="text-muted-foreground text-sm">No scans loaded yet.</p>
      )}
    </div>
  );
}
