import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialIcon } from "@/components/ui/material-icon";
import { PaymentSuccess } from "@/components/ui/payment-success";
import { SendPaymentToCard, usePaymentDetails } from "@/components/ui/payment-details-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  api,
  ApiError,
  creditsForAmountGhs,
  GH_NETWORKS,
  NG_BANKS,
  PLAN_FALLBACK,
  usdApprox,
  userToken,
  type AccountUser,
  type Plan,
  type UploadData,
} from "@/lib/api";

export const Route = createFileRoute("/pricing")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { plan?: string | undefined; game?: string | undefined } => ({
    plan: typeof search["plan"] === "string" ? search["plan"] : undefined,
    game: typeof search["game"] === "string" ? search["game"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Top up credits — SignalVault" },
      {
        name: "description",
        content:
          "Four tiers from GH₵250 for 4 credits to GH₵1,000 for 20 credits. Every scan or play costs 4 credits — every engine, credits never expire. Pay by Mobile Money or bank transfer.",
      },
      { property: "og:title", content: "Top up credits — SignalVault" },
      {
        property: "og:description",
        content: "Four tiers from GH₵250 for 4 credits to GH₵1,000 for 20 credits. Each scan or play costs 4 credits. Credits never expire.",
      },
    ],
  }),
  component: PricingPage,
});

const GAME_NAMES: Record<string, string> = {
  aviator: "Aviator",
  mines: "Mines",
  bottle: "Spin da Bottle",
};

type PlanPayStatus = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  amount: number;
  currency: string;
  game: string;
  plan: string;
  rejectionReason?: string | null;
};

/**
 * The top-up page — four credit tiers, same price for every game.
 * Game-aware via ?game=: top up, transfer the amount, submit your proof,
 * and an admin credits your wallet. Credits work on every game + scan.
 */
function PricingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { plan: preselectedPlan, game: preselectedGame } = Route.useSearch();
  const [country, setCountry] = useState<"ghana" | "nigeria">("ghana");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [networkOrBank, setNetworkOrBank] = useState(GH_NETWORKS[0]!);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [activePlan, setActivePlan] = useState("");
  const [planChoice, setPlanChoice] = useState<string | null>(null);

  const { data: details } = usePaymentDetails();

  const token = typeof window !== "undefined" ? userToken.get() : null;
  const game = preselectedGame || "";
  const gameName = GAME_NAMES[game] ?? game;

  // Guests can BROWSE the packs freely — this is the shop window. Only
  // the purchase itself needs an account: subscribe() below sends
  // logged-out visitors to /login (with redirect back here). Do NOT
  // auto-redirect on mount: the old gate bounced every logged-out
  // visitor to /login within seconds, so nobody could read the prices.

  // Purchases require an account: this page already redirects logged-out
  // visitors to /login (same mechanism as the predictor gates). The
  // ["me"] read below also supplies the account email shown read-only in
  // the payment details card — the purchase itself is associated with the
  // account server-side via the session token (the /api/plans/pay/init
  // payload carries no email field today, so none is added).
  const { data: me, error: meError } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<AccountUser>("/api/auth/me", { token: token ?? null }),
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) {
      // Session died — clear the token but STAY on the page as a guest
      // (browsing is public; only buying needs a login).
      userToken.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meError]);

  const { data: plans = PLAN_FALLBACK } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api<Plan[]>("/api/plans/catalogue"),
    retry: false,
    placeholderData: PLAN_FALLBACK,
  });

  // One amount, one submit: the plan identity is fixed up front (URL
  // preselect wins, then an explicit choice, then the first plan), and the
  // amount card + submit below always refer to this plan.
  const selectedPlan =
    planChoice && plans.some((p) => p.plan === planChoice)
      ? planChoice
      : preselectedPlan && plans.some((p) => p.plan === preselectedPlan)
        ? preselectedPlan
        : (plans[0]?.plan ?? "PREMIUM");
  const selectedPlanObj = plans.find((p) => p.plan === selectedPlan) ?? plans[0];

  const { data: status } = useQuery({
    queryKey: ["plan-pay-status", paymentId],
    queryFn: () =>
      api<PlanPayStatus>(`/api/plans/pay/status/${paymentId}`, { token: token ?? null }),
    enabled: paymentId.length > 0,
    refetchInterval: (q) => {
      const s = (q.state.data as PlanPayStatus | undefined)?.status;
      return s === "PENDING" ? 4000 : false;
    },
    retry: false,
  });

  const done = status?.status === "APPROVED";
  const failed = status?.status === "REJECTED";

  function enterGame() {
    if (!status?.game) return;
    // pass-only games live on their own routes, not the engine page
    if (status.game === "mines") navigate({ to: "/predictor/mines" });
    else if (status.game === "bottle") navigate({ to: "/predictor/bottle" });
    else navigate({ to: "/predictor/$gameId", params: { gameId: status.game } });
  }

  useEffect(() => {
    if (done && status?.game) {
      // purchase recorded — drop stale entitlement caches (lobby tiles,
      // game guards) so the new plan shows up immediately everywhere
      void qc.invalidateQueries({ queryKey: ["entitlement"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(
        `${creditsForAmountGhs(status?.amount) ?? 12} credits added — entering ${GAME_NAMES[status.game] ?? status.game}!`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  async function subscribe(plan: string) {
    if (!token) {
      navigate({ to: "/login", search: { redirect: "/pricing" + (game ? `?game=${game}` : "") } });
      return;
    }
    if (!game) {
      toast.error("Pick a game first — tap a locked game in the casino.");
      navigate({ to: "/predictor" });
      return;
    }
    if (!accountName.trim() || !accountNumber.trim() || !reference.trim()) {
      toast.error("Fill in your payment details first.");
      return;
    }
    if (!file) {
      toast.error("Attach a screenshot of your payment.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Screenshot must be under 10MB.");
      return;
    }
    setBusy(plan);
    try {
      const upForm = new FormData();
      upForm.set("image", file);
      const up = await api<UploadData>("/api/upload", { form: upForm });
      const data = await api<{ id: string }>("/api/plans/pay/init", {
        method: "POST",
        token: token ?? null,
        body: {
          game,
          plan,
          accountName: accountName.trim(),
          accountNumber: accountNumber.trim(),
          networkOrBank: networkOrBank.trim(),
          reference: reference.trim(),
          screenshotUrl: up.url,
        },
      });
      setPaymentId(data.id);
      setActivePlan(plan);
      toast.success("Proof submitted — an admin will confirm it shortly.");
      // Fresh submits land on the waiting page (the inline status panel
      // below stays for any return path that still holds a payment id).
      void navigate({ to: "/payment/waiting", search: { rail: "pricing", id: data.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit payment");
      setBusy(null);
    }
  }

  return (
    <div>
      <section className="relative overflow-hidden border-b border-border bg-background-alt">
        <div className="relative mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-1.5 text-xs font-semibold text-foreground shadow-soft">
            <MaterialIcon name="schedule" className="text-[18px] text-primary" /> Credits never expire
          </span>
          <h1 className="animate-rise mt-5 text-4xl font-black text-foreground sm:text-5xl">
            {gameName ? `Top up to play ${gameName}` : "Top up credits"}
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-base leading-relaxed">
            {gameName
              ? `${selectedPlanObj?.credits ?? creditsForAmountGhs(selectedPlanObj?.amountCedis) ?? 12} credits unlocks ${gameName} — and every other game plus AI slip scans. Transfer the amount, submit your proof, and we'll credit your wallet.`
              : "Four tiers, no subscriptions, no auto-renew: GH₵250 for 4 credits up to GH₵1,000 for 20 credits. Every scan or play costs 4 credits."}
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        {done ? (
          <PaymentSuccess
            title="Payment confirmed"
            subtitle={`${creditsForAmountGhs(status?.amount) ?? 12} credits added to your wallet — each scan or play costs 4. ${status?.game ? `Jump back into ${GAME_NAMES[status.game] ?? status.game}.` : "Jump back into the casino."}`}
            onDone={enterGame}
          />
        ) : (
          <>
            <div className="mx-auto max-w-xl">
              {/* Four tiers — tap a card to pick it. GH₵1,000 (Vault) is best value. */}
              <div className="mb-6 grid grid-cols-2 gap-3">
                {plans.map((p) => {
                  const credits = p.credits ?? creditsForAmountGhs(p.amountCedis) ?? 12;
                  const best = p.plan === "VAULT";
                  const active = selectedPlan === p.plan;
                  return (
                    <button
                      key={p.plan}
                      type="button"
                      onClick={() => setPlanChoice(p.plan)}
                      className={`card-surface relative p-4 text-left transition ${active ? "ring-primary ring-2" : "hover:ring-primary/50 hover:ring-1"}`}
                    >
                      {best && (
                        <span className="bg-primary absolute -top-2.5 right-3 rounded-full px-2 py-0.5 text-[10px] font-black tracking-wide text-white uppercase">
                          Best value
                        </span>
                      )}
                      <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                        {p.plan}
                      </p>
                      <p className="mt-1 text-2xl font-extrabold tracking-tight">
                        {credits} <span className="text-sm font-bold">credits</span>
                      </p>
                      <p className="text-primary mt-1 text-base font-extrabold">
                        GHS {p.amountCedis}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {p.priceNgn != null ? `NGN ${p.priceNgn.toLocaleString()}` : "NGN to be set"} · {Math.floor(credits / 4)} uses
                      </p>
                    </button>
                  );
                })}
              </div>
              <Tabs
                value={country}
                onValueChange={(v) => {
                  const c = v as "ghana" | "nigeria";
                  setCountry(c);
                  setNetworkOrBank((c === "ghana" ? GH_NETWORKS : NG_BANKS)[0]!);
                }}
                className="mb-6"
              >
                <TabsList className="h-auto w-full rounded-2xl p-1.5">
                  <TabsTrigger value="ghana" className="rounded-xl px-4 py-2.5 text-sm">
                    Ghana
                  </TabsTrigger>
                  <TabsTrigger value="nigeria" className="rounded-xl px-4 py-2.5 text-sm">
                    Nigeria
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {selectedPlanObj && (
                <div className="card-surface mb-6 overflow-hidden">
                  <div className="kente-strip h-[6px] w-full" aria-hidden />
                  <div className="p-5 sm:p-6">
                    <p className="text-xs font-bold text-muted-foreground">Amount to pay</p>
                    <p className="mt-2 font-display text-5xl font-black tracking-tight text-foreground">
                      {country === "nigeria" ? "NGN — to be set" : `GHS ${selectedPlanObj.amountCedis}`}
                    </p>
                    {country === "ghana" && (
                      <p className="text-muted-foreground mt-1 font-mono text-sm tabular-nums">{usdApprox(selectedPlanObj.amountCedis)}</p>
                    )}
                    <p className="mt-2 text-sm text-muted-foreground">
                      <span className="font-mono font-semibold text-primary tabular-nums">
                        {selectedPlanObj.credits ?? creditsForAmountGhs(selectedPlanObj.amountCedis) ?? 12} credits
                      </span>
                      {` — 4 credits per scan or play · ${Math.floor((selectedPlanObj.credits ?? creditsForAmountGhs(selectedPlanObj.amountCedis) ?? 12) / 4)} uses per pack · never expires`}
                    </p>
                  </div>
                </div>
              )}

{country === "nigeria" && (
  <p className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">
    Nigeria packs are not priced yet — NGN prices are still to be set. Ghana (MoMo) packs are available now.
  </p>
)}
              <ol className="mb-6 space-y-0">
                {[
                  ["Send", "Transfer the amount to the details below."],
                  ["Submit proof", "Your name, number, reference and a screenshot."],
                  ["Approved", "Credits land in your wallet — usually within minutes."],
                ].map(([step, text], i, arr) => (
                  <li key={step} className="relative flex gap-4 pb-5 last:pb-0">
                    {i < arr.length - 1 && (
                      <span className="absolute top-10 left-[19px] h-[calc(100%-2.5rem)] border-l-2 border-dashed border-border-strong" aria-hidden />
                    )}
                    <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-white">
                      {i + 1}
                    </span>
                    <div className="pt-1">
                      <p className="text-sm font-bold">{step}</p>
                      <p className="text-sm text-muted-foreground">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {details && country === "ghana" && <SendPaymentToCard country={country} details={details} />}

              {!token && (
                <div className="card-surface mt-6 flex flex-col gap-3 p-5 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
                  <p className="text-sm font-medium">
                    You are browsing as a guest — log in or create an account to buy credits.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Link
                      to="/login"
                      search={{ redirect: "/pricing" + (game ? `?game=${game}` : "") }}
                      className="bg-primary rounded-xl px-4 py-2.5 text-sm font-black text-white"
                    >
                      Log in
                    </Link>
                    <Link
                      to="/register"
                      className="rounded-xl border px-4 py-2.5 text-sm font-bold"
                    >
                      Register
                    </Link>
                  </div>
                </div>
              )}

              <div className="card-surface mt-6 grid gap-4 p-5 sm:p-6">
                <h2 className="text-base font-bold">Your payment details</h2>
                <div className="space-y-2">
                  <Label htmlFor="pp-email">Account email</Label>
                  <Input
                    id="pp-email"
                    type="email"
                    readOnly
                    className="h-12 rounded-xl"
                    value={me?.email ?? ""}
                    placeholder={token ? "Loading…" : "Log in to see your account email"}
                  />
                  <p className="text-xs text-muted-foreground">
                    This purchase is tied to your account.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pp-name">Your account name</Label>
                    <Input
                      id="pp-name"
                      className="h-12 rounded-xl"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pp-num">
                      {country === "ghana" ? "Your MoMo number" : "Your account number"}
                    </Label>
                    <Input
                      id="pp-num"
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
                    <Label htmlFor="pp-ref">Transaction reference</Label>
                    <Input
                      id="pp-ref"
                      className="h-12 rounded-xl"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Payment screenshot</Label>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="border-input hover:border-primary hover:bg-accent/50 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 transition-colors"
                  >
                    <MaterialIcon name="upload" className="text-muted-foreground text-[24px]" />
                    <span className="text-sm font-medium">
                      {file ? file.name : "Tap to upload (png, jpg, webp — max 10MB)"}
                    </span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                {!game && (
                  <p className="text-muted-foreground text-xs">
                    No game selected —{" "}
                    <Link to="/predictor" className="text-primary font-semibold hover:underline">
                      pick a game in the casino
                    </Link>{" "}
                    first.
                  </p>
                )}
                <button
                  onClick={() => subscribe(selectedPlan)}
                  disabled={busy !== null || country === "nigeria"}
                  className="bg-primary flex h-13 w-full items-center justify-center gap-2 rounded-2xl text-base font-black text-white transition active:scale-[0.98] disabled:opacity-60"
                >
                  {busy === selectedPlan ? (
                    <MaterialIcon
                      name="progress_activity"
                      className="animate-spin text-[22px]"
                    />
                  ) : (
                    <MaterialIcon name="receipt_long" className="text-[22px]" />
                  )}
                  {token
                    ? `Submit proof for ${selectedPlanObj?.credits ?? creditsForAmountGhs(selectedPlanObj?.amountCedis) ?? 12} credits`
                    : "Log in to submit proof"}
                </button>
                <p className="text-center text-[11px] font-medium text-muted-foreground">
                  Manual transfer · activates on approval
                </p>
              </div>
            </div>

            {paymentId && !done && !failed && (
              <div className="card-surface animate-rise mx-auto mt-6 max-w-xl p-6 text-center">
                <div className="bg-warning/15 text-warning-foreground flex items-center justify-center gap-3 rounded-xl p-4 text-sm">
                  <MaterialIcon name="progress_activity" className="text-[20px] animate-spin" />
                  Proof submitted — an admin is reviewing it. Your {selectedPlanObj?.credits ?? creditsForAmountGhs(selectedPlanObj?.amountCedis) ?? 12} credits land on approval.
                </div>
                <p className="text-muted-foreground mt-3 font-mono text-xs break-all">
                  {paymentId}
                </p>
              </div>
            )}

            {paymentId && failed && (
              <div className="card-surface animate-rise mx-auto mt-6 max-w-xl p-6 text-center">
                <div className="flex items-center justify-center gap-3 rounded-xl bg-red-500/10 p-4 text-sm font-semibold text-red-600">
                  <MaterialIcon name="error" className="text-[20px]" />
                  {status?.rejectionReason
                    ? `Rejected: ${status.rejectionReason}`
                    : "That submission was rejected — check the details and try again."}
                </div>
                <button
                  onClick={() => {
                    setPaymentId("");
                    setBusy(null);
                  }}
                  className="text-primary mt-3 text-sm font-bold hover:underline"
                >
                  Try again
                </button>
              </div>
            )}

            <p className="mt-6 text-center text-sm">
              <Link
                to="/manual-payment"
                className="text-muted-foreground font-medium hover:underline"
              >
                Prefer the manual payment page instead? Top up there →
              </Link>
            </p>
          </>
        )}

        <div className="bg-muted/60 mt-12 grid gap-4 rounded-3xl p-6 text-sm sm:grid-cols-3 sm:p-8">
          {[
            [
              "Four tiers. Full stop.",
              "GH₵250 for 4 credits up to GH₵1,000 for 20 credits (NGN prices to be set in Nigeria) — every game, every scan, best value on Vault.",
            ],
            [
              "4 credits a play",
              "Each crash round, bottle spin, mines game or AI slip scan costs 4 credits. Failed scans cost nothing.",
            ],
            [
              "Never expires",
              "Credits stay in your wallet until you spend them. Top up again any time — balances stack.",
            ],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="font-semibold">{t}</h3>
              <p className="text-muted-foreground mt-1 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
