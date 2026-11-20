import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  GH_NETWORKS,
  NG_BANKS,
  adminToken,
  simApprove,
  simDecline,
  simEntitlement,
  simPay,
  simStart,
  simExpire,
  userToken,
  type SimPayment,
  type SimRun,
} from "@/lib/api";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/simulator/payment")({
  validateSearch: (search: Record<string, unknown>) => ({
    game: typeof search.game === "string" ? search.game : undefined,
  }),
  component: PaymentPage,
});

// Every game the credit system governs — the same keys the
// real entitlement uses, so the payment covers exactly what a real
// payment would.
const GAMES: { id: string; name: string }[] = [
  { id: "aviator", name: "Aviator" },
  { id: "sporty-jet", name: "Sporty Jet" },
  { id: "sportyhero", name: "SportyHero" },
  { id: "sportykick", name: "SportyKick" },
  { id: "super-hero", name: "Super Hero" },
  { id: "test-flight", name: "Test Flight" },
  { id: "mines", name: "Mines" },
  { id: "bottle", name: "Spin da Bottle" },
  // Sim-only product: the Instant Virtuals tile's front door. Approval
  // grants scan access (not a 45-minute window) — see simulator.js.
  { id: "scan", name: "Instant Virtuals" },
];

const RUN_KEY = "darkweb_sim_run_id";
const NOTICE_KEY = "darkweb_sim_notice";

function PaymentPage() {
  const navigate = useNavigate();
  const { game: gameId } = Route.useSearch();
  const game = GAMES.find((g) => g.id === gameId);

  const [saToken, setSaToken] = useState<string | null>(null);
  const [run, setRun] = useState<SimRun | null>(null);
  // The sim account's email, from the run's own entitlement record
  // (simEntitlement returns email = the run's simIdentity). Shown
  // read-only in the payment details, mirroring the real flow where
  // purchases use the account email. Display only — the simPay payload
  // carries no email field and is unchanged.
  const [simEmail, setSimEmail] = useState("");
  const [payment, setPayment] = useState<SimPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual-payment form state — the same form a real user sees:
  // country toggle, receiving details, amount, sender details.
  const [country, setCountry] = useState<"ghana" | "nigeria">("ghana");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [networkOrBank, setNetworkOrBank] = useState<string>(GH_NETWORKS[0]!);
  const [reference, setReference] = useState("");
  // Payment screenshot: local state only, mirroring the sim scan step 3
  // upload — it is never sent to any endpoint and never added to the
  // simPay payload. Required before Submit enables.
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const screenshotRef = useRef<HTMLInputElement>(null);
  const { data: details } = usePaymentDetails();

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

  // Unknown game → back to the lobby.
  useEffect(() => {
    if (!game) navigate({ to: "/simulator" });
  }, [game, navigate]);

  // Restore the lobby's run (or start one) so the payment submits
  // against the same run the lobby rendered.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!saToken || startedRef.current) return;
    startedRef.current = true;
    const savedRunId = window.sessionStorage.getItem(RUN_KEY);
    const savedToken = userToken.get();
    const restore = async () => {
      if (savedRunId && savedToken?.startsWith("simtok_")) {
        setRun({ runId: savedRunId, simIdentity: "", simToken: savedToken, expiresAt: "" });
        try {
          const me = await simEntitlement(savedRunId, saToken);
          setSimEmail(me.email ?? "");
        } catch {
          /* account email stays blank; the payment itself needs no email */
        }
        return;
      }
      try {
        const r = await simStart(saToken);
        setRun(r);
        userToken.set(r.simToken);
        window.sessionStorage.setItem(RUN_KEY, r.runId);
        try {
          const me = await simEntitlement(r.runId, saToken);
          setSimEmail(me.email ?? "");
        } catch {
          /* account email stays blank; the payment itself needs no email */
        }
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

  const submitPayment = async () => {
    if (!run || !saToken || !game) return;
    if (!screenshot) {
      setError("Attach a screenshot of your payment.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await simPay(run.runId, game.id, saToken, {
        country,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        networkOrBank,
        reference: reference.trim(),
      });
      setPayment(p);
      // Fresh submits land on the waiting page (the 3-second
      // auto-approve runs there); Cancel during the wait lives there too.
      navigate({ to: "/simulator/waiting", search: { game: game.id, paymentId: p.id } });
    } catch {
      setError("Payment failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (paymentId?: string) => {
    const id = paymentId ?? payment?.id;
    if (!run || !saToken || !id || !game) return;
    clearApproveTimer();
    try {
      await simApprove(id, saToken);
      window.sessionStorage.setItem(
        NOTICE_KEY,
        `Payment approved — 30 credits added to your wallet.`,
      );
      navigate({ to: "/simulator" });
    } catch {
      setError("Payment failed. Please try again.");
    }
  };

  const cancel = async () => {
    if (!run || !saToken || !payment) return;
    clearApproveTimer();
    setBusy(true);
    try {
      await simDecline(payment.id, saToken);
      window.sessionStorage.setItem(NOTICE_KEY, "Payment cancelled — nothing was granted.");
      navigate({ to: "/simulator" });
    } catch {
      setError("Could not cancel. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!saToken || !game) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar: back-to-lobby icon only */}
      <div className="sticky top-0 z-40 px-4 py-2">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3">
          <Link
            to="/simulator"
            aria-label="Back to games"
            title="Back to games"
            className="grid size-10 place-items-center bg-card font-bold"
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
          <div className="border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

        {!run ? (
          <div className="grid place-items-center py-20">
            <MaterialIcon name="progress_activity" className="animate-spin text-[28px] text-muted-foreground" />
          </div>
        ) : !payment ? (
          <div className="space-y-6">
            <h1 className="text-xl font-black tracking-tight">Pay for {game.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              One pack = 30 credits for {game.name} and every other game, plus AI slip scans.
              Each scan or play costs 5 credits and credits never expire — transfer the
              amount, submit your details, and we&apos;ll credit your wallet.
            </p>
            <Tabs
              value={country}
              onValueChange={(v) => {
                const c = v as "ghana" | "nigeria";
                setCountry(c);
                setNetworkOrBank((c === "ghana" ? GH_NETWORKS : NG_BANKS)[0]!);
              }}
            >
              <TabsList className="h-auto w-full rounded-none p-1.5 sm:w-auto">
                <TabsTrigger value="ghana" className="rounded-none px-4 py-2 text-sm">
                  Ghana
                </TabsTrigger>
                <TabsTrigger value="nigeria" className="rounded-none px-4 py-2 text-sm">
                  Nigeria
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="border border-primary/15 bg-card p-5">
              <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                Amount to pay
              </p>
              <p className="mt-2 text-3xl font-black tracking-tight">
                Send exactly {country === "ghana" ? "GHS 400" : "NGN 75,000"} for 30 credits
              </p>
            </div>
            {details && (
              // Page-scoped flattening: the shared card keeps its own
              // classes (file untouched); this override squares its
              // corners for this page only.
              <div className="[&_*]:rounded-none!">
                <SendPaymentToCard country={country} details={details} />
              </div>
            )}
            <div className="grid gap-4">
              <h2 className="text-base font-bold">Your payment details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="pay-email">Account email</Label>
                  <Input
                    id="pay-email"
                    type="email"
                    readOnly
                    className="h-12 rounded-none"
                    value={simEmail}
                  />
                  <p className="text-xs text-muted-foreground">
                    This purchase is tied to this account.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-name">Your account name</Label>
                  <Input
                    id="pay-name"
                    className="h-12 rounded-none"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-num">
                    {country === "ghana" ? "Your MoMo number" : "Your account number"}
                  </Label>
                  <Input
                    id="pay-num"
                    className="h-12 rounded-none"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{country === "ghana" ? "Network" : "Your bank"}</Label>
                  <Select value={networkOrBank} onValueChange={setNetworkOrBank}>
                    <SelectTrigger className="h-12 w-full rounded-none">
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
                  <Label htmlFor="pay-ref">Transaction reference</Label>
                  <Input
                    id="pay-ref"
                    className="h-12 rounded-none"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Payment screenshot</Label>
                <button
                  type="button"
                  onClick={() => screenshotRef.current?.click()}
                  className="border-input hover:border-primary hover:bg-accent/50 flex w-full flex-col items-center gap-2 rounded-none border-2 border-dashed p-6 transition-colors"
                >
                  <MaterialIcon name="upload" className="text-[24px] text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {screenshot ? screenshot.name : "Tap to upload (max 10MB)"}
                  </span>
                </button>
                <input
                  ref={screenshotRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  The screenshot is only shown here — it is never sent anywhere.
                </p>
              </div>
              <div>
                <button
                  onClick={() => void submitPayment()}
                  disabled={
                    busy ||
                    !accountName.trim() ||
                    !accountNumber.trim() ||
                    !reference.trim() ||
                    !screenshot
                  }
                  className="bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  Submit payment
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="border border-dashed border-primary/30 bg-card p-4 text-sm">
              <p>
                <span className="text-muted-foreground">Game:</span> <strong>{game.name}</strong>
              </p>
              <p>
                <span className="text-muted-foreground">Country:</span>{" "}
                <strong>{payment.country === "nigeria" ? "Nigeria" : "Ghana"}</strong>
              </p>
              <p>
                <span className="text-muted-foreground">Amount:</span>{" "}
                <strong>
                  {payment.currency} {payment.amount}
                </strong>
              </p>
              <p>
                <span className="text-muted-foreground">Account:</span>{" "}
                <strong>
                  {payment.accountName} · {payment.accountNumber} ({payment.networkOrBank})
                </strong>
              </p>
              <p>
                <span className="text-muted-foreground">Reference:</span>{" "}
                <strong className="font-mono">{payment.reference}</strong>
              </p>
            </div>
            {payment.status === "PENDING" && (
              <div className="flex flex-wrap items-center gap-3 bg-warning/15 p-4 text-sm">
                <MaterialIcon
                  name="progress_activity"
                  className="animate-spin text-[20px] text-warning-foreground"
                />
                <p className="flex-1 font-semibold text-warning-foreground">
                  Confirming your transfer…
                </p>
                <button
                  onClick={() => void cancel()}
                  disabled={busy}
                  className="bg-destructive px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
