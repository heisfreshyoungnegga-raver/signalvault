import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Copy, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  api,
  ApiError,
  creditsForAmountGhs,
  creditsForTierCode,
  picksLabel,
  scanPlanLabel,
  userToken,
  type ManualStatus,
  type ScanStatus,
} from "@/lib/api";

type Rail = "scan" | "pricing" | "manual";

type PlanPayStatus = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  amount: number;
  currency: string;
  game: string;
  plan: string;
  rejectionReason?: string | null;
};

type NormStatus = {
  id: string;
  status: string;
  rejectionReason?: string | null;
  game?: string;
  plan?: string;
  amount?: number;
  currency?: string;
  scanPlan?: string;
  maxPicks?: number | string;
  password?: string;
};

const RAILS: Record<Rail, { label: string; buyTo: string; buyLabel: string }> = {
  scan: { label: "AI slip scan", buyTo: "/scan", buyLabel: "Back to scan" },
  pricing: { label: "Credit top-up", buyTo: "/pricing", buyLabel: "Back to pricing" },
  manual: { label: "Subscription", buyTo: "/manual-payment", buyLabel: "Back to manual payment" },
};

export const Route = createFileRoute("/payment/waiting")({
  validateSearch: (search: Record<string, unknown>) => ({
    rail: typeof search.rail === "string" ? search.rail : "",
    id: typeof search.id === "string" ? search.id : "",
  }),
  head: () => ({
    meta: [
      { title: "Waiting for payment confirmation — SignalVault" },
      {
        name: "description",
        content: "Your payment is under review. This page updates automatically when an admin confirms it.",
      },
    ],
  }),
  component: PaymentWaitingPage,
});

function PaymentWaitingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { rail: railParam, id } = Route.useSearch();
  const rail: Rail | null =
    railParam === "scan" || railParam === "pricing" || railParam === "manual"
      ? railParam
      : null;
  const valid = rail !== null && id.length > 0;
  const token = typeof window !== "undefined" ? userToken.get() : null;

  const { data, error, isPending } = useQuery({
    queryKey: ["payment-waiting", rail, id],
    queryFn: async (): Promise<NormStatus> => {
      if (rail === "scan") {
        const s = await api<ScanStatus>(`/api/scan/payment/status/${id}`);
        return {
          id: s.id,
          status: s.status,
          rejectionReason: s.rejectionReason ?? null,
          scanPlan: s.scanPlan,
          maxPicks: s.maxPicks,
        };
      }
      if (rail === "manual") {
        const s = await api<ManualStatus>(`/api/payment/manual/status/${id}`);
        return {
          id: s.id,
          status: s.status,
          rejectionReason: s.rejectionReason ?? null,
          plan: s.plan,
          password: s.password,
        };
      }
      const s = await api<PlanPayStatus>(`/api/plans/pay/status/${id}`, {
        token: token ?? null,
      });
      return {
        id: s.id,
        status: s.status,
        rejectionReason: s.rejectionReason ?? null,
        game: s.game,
        plan: s.plan,
        amount: s.amount,
        currency: s.currency,
      };
    },
    enabled: valid,
    // Same polling each rail already uses on its own status panel.
    refetchInterval: (q) => {
      const s = (q.state.data as NormStatus | undefined)?.status;
      return s === "PENDING" || s === "AWAITING_PAYMENT"
        ? rail === "pricing"
          ? 4000
          : 5000
        : false;
    },
    retry: false,
  });

  const status = data?.status;
  const approved = status === "APPROVED" || status === "USED";
  const rejected = status === "REJECTED";
  // A fresh one-time password is shown once and must not be skipped past:
  // hold the auto-redirect while an unread password is on screen.
  const holdForPassword = rail === "manual" && !!data?.password;
  const navGuard = useRef(false);
  const [beatDone, setBeatDone] = useState(false);

  function gameDestination(): string {
    if (!data?.game) return "/predictor";
    if (data.game === "mines") return "/predictor/mines";
    if (data.game === "bottle") return "/predictor/bottle";
    return `/predictor/${data.game}`;
  }

  function onwardTo(): string {
    if (rail === "scan") return "/scan-slip";
    if (rail === "pricing") return gameDestination();
    return "/predictor";
  }

  function goOnward() {
    if (navGuard.current) return;
    navGuard.current = true;
    if (rail === "scan") {
      // Standalone slip-scan page (built in parallel): scan approval lands
      // there directly, not on the /scan Analyze tab.
      void navigate({ to: "/scan-slip" });
      return;
    }
    if (rail === "pricing") {
      // Mirror the pricing page: drop stale entitlement caches so the new
      // plan shows up immediately everywhere once approval lands.
      void qc.invalidateQueries({ queryKey: ["entitlement"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void navigate({ to: onwardTo() });
      return;
    }
    void navigate({ to: "/predictor" });
  }

  // Approved beat: show the confirmation briefly, then take the user
  // directly to the game (or the scanner, or the lobby) — no extra tap
  // required. The onward button below covers a blocked auto-nav.
  useEffect(() => {
    if (!approved || holdForPassword) return;
    const t = setTimeout(() => {
      setBeatDone(true);
      goOnward();
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, holdForPassword]);

  function copyId() {
    void navigator.clipboard.writeText(id);
    toast.success("Purchase ID copied");
  }

  const railMeta = rail ? RAILS[rail] : null;
  const tryAgainTo =
    rail === "pricing" && data?.game
      ? `/pricing?game=${data.game}`
      : (railMeta?.buyTo ?? "/predictor");

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 sm:py-16">
      {!valid ? (
        <div className="card-surface animate-rise p-6 text-center sm:p-8">
          <XCircle className="text-destructive mx-auto size-12" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
            Couldn&apos;t find this payment
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            This waiting link looks incomplete or the payment isn&apos;t there anymore. Head back
            and try again.
          </p>
          <Button asChild className="mt-6 w-full rounded-xl">
            <Link to="/predictor">Back to lobby</Link>
          </Button>
        </div>
      ) : error instanceof ApiError && error.status === 401 ? (
        <div className="card-surface animate-rise p-6 text-center sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">Session expired</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Log in again to keep waiting on this payment — you&apos;ll come straight back here.
          </p>
          <Button asChild className="mt-6 w-full rounded-xl">
            <Link
              to="/login"
              search={{ redirect: `/payment/waiting?rail=${rail}&id=${id}` }}
            >
              Log in
            </Link>
          </Button>
        </div>
      ) : error ? (
        <div className="card-surface animate-rise p-6 text-center sm:p-8">
          <XCircle className="text-destructive mx-auto size-12" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
            Couldn&apos;t find this payment
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            We couldn&apos;t load this payment right now. Check the link, or head back and try
            again.
          </p>
          <Button asChild className="mt-6 w-full rounded-xl">
            <Link to="/predictor">Back to lobby</Link>
          </Button>
        </div>
      ) : isPending || !data ? (
        <div className="card-surface animate-rise p-6 text-center sm:p-8">
          <Loader2 className="text-muted-foreground mx-auto size-10 animate-spin" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
            Checking your payment…
          </h1>
          <p className="text-muted-foreground mt-2 font-mono text-xs break-all">{id}</p>
        </div>
      ) : rejected ? (
        <div className="card-surface animate-rise p-6 text-center sm:p-8">
          <XCircle className="text-destructive mx-auto size-12" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">Payment rejected</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Reason: {data.rejectionReason ?? "no reason given"}.
          </p>
          <p className="text-muted-foreground mt-1 font-mono text-xs break-all">{id}</p>
          <div className="mt-6 grid gap-3">
            <Button asChild className="w-full rounded-xl">
              <Link to={tryAgainTo}>Try again</Link>
            </Button>
            <Button asChild variant="outline" className="w-full rounded-xl">
              <Link to="/predictor">Back to lobby</Link>
            </Button>
          </div>
        </div>
      ) : approved ? (
        <div className="card-surface animate-rise p-6 text-center sm:p-8">
          <span className="mx-auto grid size-20 place-items-center rounded-full bg-success shadow-soft">
            <CheckCircle2 className="size-10 text-white" />
          </span>
          <h1 className="mt-5 text-3xl font-black tracking-tight">Payment approved!</h1>
          {rail === "pricing" && data.game && (
            <p className="text-muted-foreground mt-2 text-sm">
              {creditsForAmountGhs(data.amount) ?? 30} credits added — entering {data.game}.
            </p>
          )}
          {rail === "scan" && (
            <p className="text-muted-foreground mt-2 text-sm">
              {creditsForTierCode(data.scanPlan) ?? 30} credits added — your slip scanner is ready.
            </p>
          )}
          {rail === "manual" && data.password && (
            <div className="border-primary/30 bg-primary/5 mt-5 rounded-2xl border-2 border-dashed p-5 text-left">
              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Your one-time password
              </p>
              <div className="mt-2 flex items-center gap-3">
                <code className="font-mono text-xl font-bold break-all">{data.password}</code>
                <Button
                  size="icon"
                  variant="outline"
                  className="ml-auto shrink-0 rounded-xl"
                  onClick={() => {
                    void navigator.clipboard.writeText(data.password ?? "");
                    toast.success("Password copied");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                Save it now — it won&apos;t be shown again.
              </p>
              <Button asChild className="mt-4 w-full rounded-xl">
                <Link to="/login">Go to login</Link>
              </Button>
            </div>
          )}
          {rail === "manual" && !data.password && (
            <p className="text-muted-foreground mt-2 text-sm">
              Approved — password already retrieved.
            </p>
          )}
          {!holdForPassword && (
            <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold tracking-widest text-muted-foreground uppercase">
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              {beatDone ? "Taking you there…" : "Taking you to the game…"}
            </p>
          )}
          <div className="mt-6 grid gap-3">
            <Button className="w-full rounded-xl" onClick={goOnward}>
              {rail === "scan"
                ? "Open the scanner"
                : rail === "pricing"
                  ? "Enter game"
                  : "Continue to lobby"}
            </Button>
            {rail === "manual" && data.password && (
              <Button asChild variant="outline" className="w-full rounded-xl">
                <Link to="/predictor">Continue to lobby</Link>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="card-surface animate-rise overflow-hidden p-6 text-center sm:p-8">
          <div className="kente-strip -mx-6 -mt-6 mb-6 h-[6px] w-[calc(100%+3rem)] sm:-mx-8 sm:-mt-8 sm:w-[calc(100%+4rem)]" aria-hidden />
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-success/10">
            <span className="size-2.5 animate-pulse rounded-full bg-success" />
          </span>
          <h1 className="mt-5 text-3xl font-black tracking-tight">
            Waiting for payment confirmation
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            An admin reviews every payment — usually within minutes. Access activates
            automatically on approval. This page updates on its own; no need to refresh.
          </p>
          <div className="bg-muted mt-6 rounded-2xl p-4 text-left">
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Purchase ID
            </p>
            <div className="mt-1 flex items-center gap-3">
              <code className="font-mono text-sm font-bold break-all">{data.id}</code>
              <Button
                size="icon"
                variant="outline"
                className="ml-auto shrink-0 rounded-xl"
                onClick={copyId}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="mt-3 text-sm">
              {railMeta?.label}
              {rail === "pricing" && data.game ? ` · ${data.game}` : ""}
              {rail === "pricing" && data.amount !== undefined
                ? ` · ${data.currency} ${data.amount}`
                : ""}
              {rail === "scan" && data.scanPlan ? ` · ${scanPlanLabel(data.scanPlan)}` : ""}
              {rail === "scan" && data.maxPicks !== undefined
                ? ` · ${picksLabel(data.maxPicks)}`
                : ""}
            </p>
          </div>
          <Button asChild variant="outline" className="mt-6 w-full rounded-xl">
            <Link to="/predictor">Back to lobby</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
