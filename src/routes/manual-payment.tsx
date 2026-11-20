import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Copy, Loader2, ShieldAlert, Smartphone, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SendPaymentToCard, usePaymentDetails } from "@/components/ui/payment-details-card";
import {
  api,
  ApiError,
  GH_NETWORKS,
  NG_BANKS,
  PLAN_FALLBACK,
  usdApprox,
  userToken,
  type AccountUser,
  type ManualStatus,
  type Plan,
  type UploadData,
} from "@/lib/api";

export const Route = createFileRoute("/manual-payment")({
  head: () => ({
    meta: [
      { title: "Manual payment — SignalVault" },
      {
        name: "description",
        content:
          "Ghana pays by Mobile Money transfer, Nigeria by bank transfer — send the amount, submit your proof, and get approved.",
      },
      { property: "og:title", content: "Manual payment — SignalVault" },
      {
        property: "og:description",
        content: "Submit your payment proof and get your one-time password after review.",
      },
    ],
  }),
  component: ManualPaymentPage,
});

function ManualPaymentPage() {
  const [country, setCountry] = useState<"ghana" | "nigeria">("ghana");
  // Plan first, then country: the plan select lives on the page (above the
  // country tabs) so the choice survives the country-keyed form remount.
  const [plan, setPlan] = useState("PREMIUM");
  const { data: plans = PLAN_FALLBACK } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api<Plan[]>("/api/payment/plans"),
    retry: false,
    placeholderData: PLAN_FALLBACK,
  });
  const selectedPlan = plans.find((p) => p.plan === plan) ?? plans[0];

  // Purchases require an account: the same session mechanism as the
  // predictor gates — session token + GET /api/auth/me. The form renders
  // only for a logged-in account, and it submits that account's email
  // (never a typed one). Hero, plan select, country tabs, and amount stay
  // visible; only the purchase form itself is gated.
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
  const formGated = !token || !!meError;

  return (
    <div>
      <section className="border-b border-border bg-background-alt">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-18">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-1.5 text-xs font-semibold text-foreground shadow-soft">
            <Smartphone className="size-3.5 text-primary" /> No card needed
          </span>
          <h1 className="animate-rise mt-5 text-4xl font-black text-foreground sm:text-5xl">
            Pay your way
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-base">
            Four tiers, from GH₵250 for 20 credits to GH₵1,000 for 80 — pick your pack below.
            Each scan or play costs 5 credits, and credits never expire. Ghana pays by Mobile
            Money transfer, Nigeria by bank transfer. Both are reviewed manually — send the
            amount, submit your proof, and we confirm it.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-xl space-y-2">
          <Label>Plan</Label>
          <Select value={plan} onValueChange={setPlan}>
            <SelectTrigger className="h-12 w-full rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {plans.map((p) => (
                <SelectItem key={p.plan} value={p.plan}>
                  {p.credits ?? "?"} credits — GHS {p.amountCedis}
                  {p.plan === "VAULT" ? " · Best value" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs
          value={country}
          onValueChange={(v) => setCountry(v as "ghana" | "nigeria")}
          className="mx-auto mt-6 max-w-xl"
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

        {selectedPlan && (
          <div className="mx-auto mt-4 max-w-xl">
            <p className="text-muted-foreground text-sm">
              Amount to pay:{" "}
              <span className="text-foreground text-base font-extrabold">
                {country === "nigeria"
                  ? `NGN ${(selectedPlan.priceNgn ?? 0).toLocaleString()}`
                  : `GHS ${selectedPlan.amountCedis}`}
              </span>{" "}
              <span className="text-xs">
                · {selectedPlan.credits ?? "?"} credits, 5 per scan or play
                {selectedPlan.plan === "VAULT" ? " · Best value" : ""}
              </span>
            </p>
            {country === "ghana" && (
              <p className="text-muted-foreground mt-1 text-xs">{usdApprox(selectedPlan.amountCedis)}</p>
            )}
          </div>
        )}

        <div className="mt-8">
          {!mounted || meLoading ? (
            <div className="grid place-items-center py-20">
              <Loader2 className="text-muted-foreground size-8 animate-spin" />
            </div>
          ) : formGated ? (
            <div className="card-surface mx-auto max-w-xl space-y-4 p-6 text-center sm:p-8">
              <h2 className="text-lg font-bold">You need an account to pay</h2>
              <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">
                Log in to continue your purchase — the payment will be tied to your account
                email.
              </p>
              <Button asChild size="lg" className="h-12 w-full rounded-xl sm:w-auto">
                <Link to="/login" search={{ redirect: "/manual-payment" }}>
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
            <ManualSubscriptionForm
              key={country}
              country={country}
              plan={plan}
              accountEmail={me.email}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ManualSubscriptionForm({
  country,
  plan,
  accountEmail,
}: {
  country: "ghana" | "nigeria";
  plan: string;
  accountEmail: string;
}) {
  const navigate = useNavigate();
  const isGhana = country === "ghana";
  const networks = isGhana ? GH_NETWORKS : NG_BANKS;
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [networkOrBank, setNetworkOrBank] = useState(networks[0]!);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: details } = usePaymentDetails();

  useEffect(() => {
    const savedId = window.localStorage.getItem("darkweb_manual_id");
    if (savedId) setSubmissionId(savedId);
  }, []);

  const { data: status } = useQuery({
    queryKey: ["manual-status", submissionId],
    queryFn: () => api<ManualStatus>(`/api/payment/manual/status/${submissionId}`),
    enabled: submissionId.length > 0,
    refetchInterval: (q) =>
      (q.state.data as ManualStatus | undefined)?.status === "PENDING" ? 5000 : false,
    retry: false,
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Attach a screenshot of your payment.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Screenshot must be under 10MB.");
      return;
    }
    setSubmitting(true);
    try {
      // 1. Upload the screenshot through the backend (ImgBB key stays server-side)
      const upForm = new FormData();
      upForm.set("image", file);
      const up = await api<UploadData>("/api/upload", { form: upForm });

      // 2. Submit the proof as JSON with the hosted screenshot URL
      const data = await api<ManualStatus>("/api/payment/manual/submit", {
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
      setSubmissionId(data.id);
      window.localStorage.setItem("darkweb_manual_id", data.id);
      window.localStorage.setItem("darkweb_email", accountEmail);
      toast.success("Submitted! We'll review it shortly.");
      // Fresh submits land on the waiting page; the stored id above keeps
      // the inline status panel working for return visits.
      void navigate({ to: "/payment/waiting", search: { rail: "manual", id: data.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
      <div className="min-w-0 space-y-5">
        {details && <SendPaymentToCard country={country} details={details} />}

        <div className="card-surface p-6">
          <h2 className="text-lg font-bold">How it works</h2>
          <ol className="mt-4 space-y-0">
            <li className="relative flex gap-4 pb-5">
              <span className="absolute top-10 left-[19px] h-[calc(100%-2.5rem)] border-l-2 border-dashed border-border-strong" aria-hidden />
              <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-white">1</span>
              <p className="pt-2 text-sm leading-relaxed text-muted-foreground">
                {isGhana
                  ? "Send the plan amount by Mobile Money to the number above."
                  : "Make a bank transfer for your plan amount to the account above."}
              </p>
            </li>
            <li className="relative flex gap-4 pb-5">
              <span className="absolute top-10 left-[19px] h-[calc(100%-2.5rem)] border-l-2 border-dashed border-border-strong" aria-hidden />
              <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-white">2</span>
              <p className="pt-2 text-sm leading-relaxed text-muted-foreground">
                Screenshot the confirmation and submit the form with your details.
              </p>
            </li>
            <li className="relative flex gap-4">
              <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-white">3</span>
              <p className="pt-2 text-sm leading-relaxed text-muted-foreground">
                Our team reviews it and the credits land in your wallet.
              </p>
            </li>
          </ol>
        </div>

        {status && (
          <div className="card-surface animate-rise p-6">
            <h2 className="text-lg font-bold">Submission status</h2>
            <p className="text-muted-foreground mt-1 font-mono text-xs break-all">{status.id}</p>

            {status.status === "PENDING" && (
              <div className="bg-warning/15 text-warning-foreground mt-4 flex items-center gap-3 rounded-xl p-4 text-sm">
                <Loader2 className="size-4 animate-spin" /> Awaiting admin review…
              </div>
            )}

            {status.status === "REJECTED" && (
              <div className="bg-destructive/12 text-destructive mt-4 rounded-xl p-4 text-sm">
                Rejected: {status.rejectionReason ?? "no reason given"}. You can submit again.
              </div>
            )}

            {status.status === "APPROVED" && status.password && (
              <div className="border-primary/30 bg-primary/5 mt-4 rounded-2xl border-2 border-dashed p-5">
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Your one-time password
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <code className="font-mono text-xl font-bold break-all">{status.password}</code>
                  <Button
                    size="icon"
                    variant="outline"
                    className="ml-auto shrink-0 rounded-xl"
                    onClick={() => {
                      void navigator.clipboard.writeText(status.password ?? "");
                      toast.success("Password copied");
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-muted-foreground mt-3 flex gap-2 text-xs leading-relaxed">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                  Save it now — it won't be shown again.
                </p>
                <Button asChild className="mt-4 w-full rounded-xl">
                  <Link to="/login">Go to login</Link>
                </Button>
              </div>
            )}

            {status.status === "APPROVED" && !status.password && (
              <div className="bg-success/12 text-success mt-4 flex items-center gap-2 rounded-xl p-4 text-sm">
                <CheckCircle2 className="size-4" /> Approved — password already retrieved.
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="card-surface h-fit min-w-0 p-6 sm:p-8">
        <h2 className="text-xl font-bold">Submit payment proof</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          This payment is tied to your account.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="m-email">Account email</Label>
            <Input
              id="m-email"
              type="email"
              required
              readOnly
              className="h-12 rounded-xl"
              value={accountEmail}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="acc-name">Your account name</Label>
            <Input
              id="acc-name"
              required
              className="h-12 rounded-xl"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="acc-num">{isGhana ? "Your MoMo number" : "Your account number"}</Label>
            <Input
              id="acc-num"
              required
              className="h-12 rounded-xl"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{isGhana ? "Network" : "Your bank"}</Label>
            <Select value={networkOrBank} onValueChange={setNetworkOrBank}>
              <SelectTrigger className="h-12 w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {networks.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="txn">Transaction reference</Label>
            <Input
              id="txn"
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
              className="border-input hover:border-primary hover:bg-accent/50 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-7 transition-colors"
            >
              <Upload className="text-muted-foreground size-6" />
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
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={submitting}
          className="mt-7 h-12 w-full rounded-xl text-base"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Submit for review
        </Button>
      </form>
    </div>
  );
}
