import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, LogOut, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialIcon } from "@/components/ui/material-icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SuperadminNextRuns } from "@/components/predictor/SuperadminNextRuns";
import { RoundCustomization } from "@/components/predictor/RoundCustomization";
import { BottleRoundsEditor } from "@/components/predictor/BottleRounds";
import { CreditLedgerView } from "@/components/admin/CreditLedgerView";
import { adminToken, api } from "@/lib/api";

import { DataTable, TableSkeleton } from "./admin.index";

export const Route = createFileRoute("/superadmin/")({
  head: () => ({
    meta: [
      { title: "Super admin — SignalVault" },
      { name: "description", content: "Platform stats, admin management, commissions and payouts." },
      { property: "og:title", content: "Super admin — SignalVault" },
      { property: "og:description", content: "SignalVault platform owner control room." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SuperAdminDashboard,
});

type Row = Record<string, unknown>;

type CountryBreakdown = {
  ghana: { depositsGHS: number; payments: number; unpricedPayments: number };
  nigeria: { depositsNGN: number; payments: number; unpricedPayments: number };
  unclassified: { payments: number };
};

type Stats = {
  depositsToday: number;
  paymentsToday: number;
  depositsThisWeek: number;
  depositsAllTime: number;
  successfulPaymentsAllTime: number;
  totalCommissionsOwed: number;
  totalCommissionsPaid: number;
  totalAdmins: number;
  depositsTodayNGN?: number;
  depositsThisWeekNGN?: number;
  depositsAllTimeNGN?: number;
  breakdown?: { today: CountryBreakdown; week: CountryBreakdown; allTime: CountryBreakdown };
};

type Monitoring = {
  gatePassesSold: number;
  planPurchases: number;
  activeSessions: number;
  revenueGhs: number;
  revenueNgn?: number;
  totalAdmins: number;
  byCountry?: {
    ghana: { payments: number; depositsGHS: number; unpricedPayments: number };
    nigeria: { payments: number; depositsNGN: number; unpricedPayments: number };
    unclassified: { payments: number };
  };
  recent: { type: string; email: string; at: string; amount: number | null; currency?: string | null; plan?: string }[];
};

function SuperAdminDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [share, setShare] = useState("30");
  const [creating, setCreating] = useState(false);
  const [payoutTarget, setPayoutTarget] = useState("");

  useEffect(() => {
    const t = adminToken.get();
    if (!t) navigate({ to: "/superadmin/login" });
    else setToken(t);
  }, [navigate]);

  const stats = useQuery({
    queryKey: ["sa-stats"],
    queryFn: () => api<Stats>("/api/superadmin/stats", { token }),
    enabled: !!token,
    retry: false,
  });
  const admins = useQuery({
    queryKey: ["sa-admins"],
    queryFn: () => api<Row[]>("/api/superadmin/admins", { token }),
    enabled: !!token,
    retry: false,
  });
  const commissions = useQuery({
    queryKey: ["sa-commissions"],
    queryFn: () => api<Row[]>("/api/superadmin/commissions", { token }),
    enabled: !!token,
    retry: false,
  });
  const payouts = useQuery({
    queryKey: ["sa-payouts"],
    queryFn: () => api<Row[]>("/api/superadmin/payouts", { token }),
    enabled: !!token,
    retry: false,
  });
  const monitoring = useQuery({
    queryKey: ["sa-monitoring"],
    queryFn: () => api<Monitoring>("/api/superadmin/monitoring", { token }),
    enabled: !!token,
    retry: false,
    refetchInterval: 15000,
  });

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api("/api/superadmin/admins", {
        method: "POST",
        token,
        body: {
          email: email.trim(),
          password,
          role: "ADMIN",
          adminSharePercent: Number(share),
        },
      });
      toast.success("Admin created");
      setEmail("");
      setPassword("");
      void qc.invalidateQueries({ queryKey: ["sa-admins"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create admin");
    } finally {
      setCreating(false);
    }
  }

  async function payout() {
    try {
      const r = await api<{ totalAmountCedis: number; commissionCount: number }>(
        `/api/superadmin/payouts/${encodeURIComponent(payoutTarget.trim())}`,
        { method: "POST", token },
      );
      toast.success(`Paid GHS ${r.totalAmountCedis} across ${r.commissionCount} records`);
      void qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payout failed");
    }
  }

  async function toggleAdmin(username: string, activate: boolean) {
    try {
      await api(
        `/api/superadmin/admins/${encodeURIComponent(username)}/${activate ? "activate" : "deactivate"}`,
        { method: "PUT", token },
      );
      toast.success(activate ? "Admin activated" : "Admin deactivated");
      void qc.invalidateQueries({ queryKey: ["sa-admins"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="text-primary size-7 animate-spin" />
      </div>
    );
  }

  const s = stats.data;
  const cards = [
    ["Deposits today", `GHS ${s?.depositsToday ?? 0}`],
    ["Payments today", s?.paymentsToday ?? 0],
    ["Deposits 7 days", `GHS ${s?.depositsThisWeek ?? 0}`],
    ["All-time deposits", `GHS ${s?.depositsAllTime ?? 0}`],
    ["Commissions owed", `GHS ${s?.totalCommissionsOwed ?? 0}`],
    ["Commissions paid", `GHS ${s?.totalCommissionsPaid ?? 0}`],
    ["Successful payments", s?.successfulPaymentsAllTime ?? 0],
    ["Admins", s?.totalAdmins ?? 0],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold sm:text-4xl">Platform control</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => void qc.invalidateQueries()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button
            variant="ghost"
            className="rounded-full"
            onClick={() => {
              void api("/api/superadmin/auth/logout", { method: "POST", token }).catch(
                () => undefined,
              );
              adminToken.clear();
              navigate({ to: "/superadmin/login" });
            }}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value], i) => (
          <div
            key={label}
            className="card-surface animate-rise p-5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {label}
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {s?.breakdown && (
        <div className="card-surface mt-4 p-5">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Deposits by country
          </p>
          {(
            [
              ["Today", s.breakdown.today],
              ["7 days", s.breakdown.week],
              ["All-time", s.breakdown.allTime],
            ] as const
          ).map(([label, b]) => (
            <div key={label} className="mt-3 border-t pt-3 first:mt-2 first:border-t-0 first:pt-0">
              <p className="text-xs font-semibold">{label}</p>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <p className="text-sm">
                  🇬🇭 Ghana · <strong>GHS {b.ghana.depositsGHS}</strong> · {b.ghana.payments}{" "}
                  payment{b.ghana.payments === 1 ? "" : "s"}
                </p>
                <p className="text-sm">
                  🇳🇬 Nigeria · <strong>NGN {b.nigeria.depositsNGN}</strong> · {b.nigeria.payments}{" "}
                  payment{b.nigeria.payments === 1 ? "" : "s"}
                </p>
              </div>
              {(b.nigeria.unpricedPayments > 0 || b.ghana.unpricedPayments > 0 || b.unclassified.payments > 0) && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {b.nigeria.unpricedPayments > 0 &&
                    `${b.nigeria.unpricedPayments} NG payment${b.nigeria.unpricedPayments === 1 ? "" : "s"} unpriced — no naira price in code. `}
                  {b.ghana.unpricedPayments > 0 &&
                    `${b.ghana.unpricedPayments} GH payment${b.ghana.unpricedPayments === 1 ? "" : "s"} unpriced — unknown plan. `}
                  {b.unclassified.payments > 0 &&
                    `${b.unclassified.payments} payment${b.unclassified.payments === 1 ? "" : "s"} unclassified — no country signal.`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="monitoring" className="mt-10">
        <TabsList className="scrollbar-none h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto rounded-2xl p-1.5">
          {(
            [
              ["monitoring", "Monitoring"],
              ["nextruns", "Next 10 runs"],
              ["rounds", "Round customization"],
              ["bottle", "Bottle rounds"],
              ["admins", "Admins"],
              ["users", "Users"],
              ["commissions", "Commissions"],
              ["payouts", "Payouts"],
              ["credits", "Credit ledger"],
              ["ghana-deposits", "Ghana deposits"],
              ["nigeria-deposits", "Nigeria deposits"],
            ] as const
          ).map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="shrink-0 rounded-xl px-4 py-2 text-sm">
              {l}
            </TabsTrigger>
          ))}
          {/* Staff-only user-flow simulator: a whole new page (not a
              panel) mirroring the user games page — see /simulator. */}
          <TabsTrigger
            value="simulator"
            onClick={() => navigate({ to: "/simulator" })}
            className="shrink-0 rounded-xl bg-secondary/10 px-4 py-2 text-sm font-bold text-secondary"
          >
            Simulator
          </TabsTrigger>
        </TabsList>

        <TabsContent value="monitoring" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Gate passes sold", monitoring.data?.gatePassesSold ?? "—", "confirmation_number", undefined],
                ["Plan purchases", monitoring.data?.planPurchases ?? "—", "shopping_bag", undefined],
                ["Active sessions", monitoring.data?.activeSessions ?? "—", "sensors", undefined],
                ["Revenue (GHS)", monitoring.data ? `GHS ${monitoring.data.revenueGhs}` : "—", "payments", monitoring.data ? `NGN ${monitoring.data.revenueNgn ?? 0}` : undefined],
              ] as const
            ).map(([label, value, icon, sub], i) => (
              <div key={label} className="card-surface animate-rise p-5" style={{ animationDelay: `${i * 60}ms` }}>
                <p className="flex items-center gap-1.5 text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  <MaterialIcon name={icon} className="text-[18px]" /> {label}
                </p>
                <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
                {sub && <p className="text-muted-foreground mt-1 text-sm font-bold tabular-nums">{sub}</p>}
              </div>
            ))}
          </div>

          {monitoring.data?.byCountry && (
            <div className="card-surface p-5">
              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Sales by country
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <p className="text-sm">
                  🇬🇭 Ghana · <strong>GHS {monitoring.data.byCountry.ghana.depositsGHS}</strong> ·{" "}
                  {monitoring.data.byCountry.ghana.payments} payment
                  {monitoring.data.byCountry.ghana.payments === 1 ? "" : "s"}
                </p>
                <p className="text-sm">
                  🇳🇬 Nigeria · <strong>NGN {monitoring.data.byCountry.nigeria.depositsNGN}</strong> ·{" "}
                  {monitoring.data.byCountry.nigeria.payments} payment
                  {monitoring.data.byCountry.nigeria.payments === 1 ? "" : "s"}
                </p>
              </div>
              {(monitoring.data.byCountry.ghana.unpricedPayments > 0 ||
                monitoring.data.byCountry.nigeria.unpricedPayments > 0 ||
                monitoring.data.byCountry.unclassified.payments > 0) && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {monitoring.data.byCountry.nigeria.unpricedPayments > 0 &&
                    `${monitoring.data.byCountry.nigeria.unpricedPayments} NG payment${monitoring.data.byCountry.nigeria.unpricedPayments === 1 ? "" : "s"} unpriced — no naira price in code. `}
                  {monitoring.data.byCountry.ghana.unpricedPayments > 0 &&
                    `${monitoring.data.byCountry.ghana.unpricedPayments} GH payment${monitoring.data.byCountry.ghana.unpricedPayments === 1 ? "" : "s"} unpriced — unknown plan code. `}
                  {monitoring.data.byCountry.unclassified.payments > 0 &&
                    `${monitoring.data.byCountry.unclassified.payments} payment${monitoring.data.byCountry.unclassified.payments === 1 ? "" : "s"} with no country signal — counted, not assigned.`}
                </p>
              )}
            </div>
          )}

          <div className="card-surface p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Recent activity</h3>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-success" /> Live
              </span>
            </div>
            {!monitoring.data?.recent.length ? (
              <p className="text-muted-foreground mt-4 text-sm">No sales yet — activity appears here in real time.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {monitoring.data.recent.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                    <MaterialIcon
                      name={r.type === "gate" ? "confirmation_number" : "shopping_bag"}
                      className="text-muted-foreground text-[20px]"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.email}</span>
                    <span className="text-muted-foreground text-xs">
                      {r.type === "gate"
                        ? "Gate fee"
                        : r.type === "pass"
                          ? "Game pass"
                          : r.type === "manual"
                            ? "Subscription"
                            : r.type === "scan"
                              ? "Scan"
                              : r.type === "mines"
                                ? "Mines"
                                : r.type === "session"
                                  ? "Scan session"
                                  : r.type === "akwapay" || r.type === "paystack"
                                    ? "Gateway sub"
                                    : r.plan}
                    </span>
                    <span className="font-bold tabular-nums">
                      {r.amount == null ? "—" : `${r.currency ?? "GHS"} ${r.amount}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="admins" className="mt-6 space-y-6">
          <form onSubmit={createAdmin} className="card-surface grid gap-4 p-6 sm:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="n-email">New admin email</Label>
              <Input
                id="n-email"
                type="email"
                required
                className="h-12 rounded-xl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-pass">Password</Label>
              <Input
                id="n-pass"
                required
                className="h-12 rounded-xl"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-share">Share %</Label>
              <Input
                id="n-share"
                type="number"
                min={0}
                max={100}
                className="h-12 rounded-xl"
                value={share}
                onChange={(e) => setShare(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={creating} className="h-12 rounded-xl sm:col-span-4">
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create admin
            </Button>
          </form>

          <div className="card-surface flex flex-col gap-3 p-6 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="po">Pay out an admin (username)</Label>
              <Input
                id="po"
                className="h-12 rounded-xl"
                placeholder="agent1@example.com"
                value={payoutTarget}
                onChange={(e) => setPayoutTarget(e.target.value)}
              />
            </div>
            <Button
              className="h-12 rounded-xl"
              disabled={!payoutTarget.trim()}
              onClick={() => void payout()}
            >
              Pay pending
            </Button>
            <Button
              variant="outline"
              className="h-12 rounded-xl"
              disabled={!payoutTarget.trim()}
              onClick={() => void toggleAdmin(payoutTarget.trim(), false)}
            >
              Deactivate
            </Button>
            <Button
              variant="secondary"
              className="h-12 rounded-xl"
              disabled={!payoutTarget.trim()}
              onClick={() => void toggleAdmin(payoutTarget.trim(), true)}
            >
              Activate
            </Button>
          </div>

          <DataTable rows={admins.data ?? []} loading={admins.isLoading} />
        </TabsContent>

        <TabsContent value="commissions" className="mt-6">
          <DataTable rows={commissions.data ?? []} loading={commissions.isLoading} />
        </TabsContent>
        <TabsContent value="payouts" className="mt-6">
          <DataTable rows={payouts.data ?? []} loading={payouts.isLoading} />
        </TabsContent>
        <TabsContent value="credits" className="mt-6">
          <CreditLedgerView token={token} endpoint="/api/superadmin/credits" />
        </TabsContent>
        <TabsContent value="users" className="mt-6">
          <UsersTab />
        </TabsContent>
        <TabsContent value="ghana-deposits" className="mt-6">
          <ManualDepositsTab country="GH" />
        </TabsContent>
        <TabsContent value="nigeria-deposits" className="mt-6">
          <ManualDepositsTab country="NG" />
        </TabsContent>
        <TabsContent value="nextruns" className="mt-6">
          <SuperadminNextRuns />
        </TabsContent>
        <TabsContent value="rounds" className="mt-6">
          <RoundCustomization />
        </TabsContent>
        <TabsContent value="bottle" className="mt-6">
          <BottleRoundsEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type DepositRow = {
  id: string;
  source: "manual" | "scan" | "pricing";
  email: string;
  accountName: string;
  accountNumber: string;
  networkOrBank: string;
  reference: string;
  screenshotUrl: string | null;
  status: string;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByAdmin: string | null;
  country: "GH" | "NG";
  rail: string;
  plan: string;
  game: string | null;
  gameLabel: string;
  amount: number;
  currency: string;
};

function depositStatusBadge(status: string) {
  const cls =
    status === "APPROVED"
      ? "bg-success/15 text-success"
      : status === "REJECTED"
        ? "bg-destructive/15 text-destructive"
        : "bg-warning/15 text-warning-foreground";
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${cls}`}>
      {status}
    </span>
  );
}

const DEPOSIT_SOURCE_LABEL: Record<string, string> = {
  manual: "Subscription",
  scan: "Scan",
  pricing: "Game pass",
};

/**
 * Country-split manual-deposit tabs: every manual deposit for the country
 * (manual-payment subscriptions, scan Buy submissions, pricing game passes)
 * newest first, with a full detail view (all fields + screenshot image) and
 * Approve / Reject actions. Approval delegates to each rail's own service,
 * so activation is exactly-once per rail (double-approve → 409). Sim
 * deposits live in separate sim_* tables and never appear here.
 */
function ManualDepositsTab({ country }: { country: "GH" | "NG" }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<{ source: string; id: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const label = country === "GH" ? "Ghana" : "Nigeria";

  const list = useQuery({
    queryKey: ["manual-deposits", country],
    queryFn: () =>
      api<DepositRow[]>(`/api/admin/manual-deposits?country=${country}`, {
        token: adminToken.get(),
      }),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ["manual-deposit", selected?.source, selected?.id],
    queryFn: () =>
      api<DepositRow>(
        `/api/admin/manual-deposits/${selected!.source}/${selected!.id}`,
        { token: adminToken.get() },
      ),
    enabled: !!selected,
    retry: false,
  });

  async function act(approve: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      await api(
        `/api/admin/manual-deposits/${selected.source}/${selected.id}/${approve ? "approve" : "reject"}`,
        {
          method: "POST",
          token: adminToken.get(),
          body: approve ? undefined : reason.trim() ? { reason: reason.trim() } : undefined,
        },
      );
      toast.success(approve ? "Approved" : "Rejected");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["manual-deposits", country] });
      void qc.invalidateQueries({
        queryKey: ["manual-deposit", selected.source, selected.id],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString() : "—";

  if (selected) {
    const d = detail.data;
    return (
      <div className="card-surface animate-rise overflow-hidden p-5">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="text-sm font-bold text-muted-foreground hover:text-foreground"
        >
          ← Back to {label} deposits
        </button>
        {detail.isLoading || !d ? (
          <TableSkeleton />
        ) : (
          <div className="mt-4 min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {depositStatusBadge(d.status)}
              <span className="text-xs font-bold text-muted-foreground">
                {DEPOSIT_SOURCE_LABEL[d.source] ?? d.source} · {d.rail}
              </span>
            </div>
            <dl className="min-w-0 space-y-3 text-sm">
              {(
                [
                  ["Account email", d.email],
                  ["Plan / game", `${d.gameLabel} · ${d.plan}`],
                  ["Amount", `${d.currency} ${d.amount}`],
                  ["Country rail", `${d.rail} · ${d.networkOrBank}`],
                  ["Account name", d.accountName],
                  ["Account number", d.accountNumber],
                  ["Transaction reference", d.reference],
                  ["Submitted", fmt(d.submittedAt)],
                  ["Reviewed by", d.reviewedByAdmin ?? "—"],
                  ["Reviewed at", fmt(d.reviewedAt)],
                  ["Rejection reason", d.rejectionReason ?? "—"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {k}
                  </dt>
                  <dd className="mt-0.5 font-medium break-all">{v}</dd>
                </div>
              ))}
            </dl>
            {d.screenshotUrl ? (
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Payment screenshot
                </p>
                <img
                  src={d.screenshotUrl}
                  alt="Payment screenshot"
                  className="mt-2 w-full rounded-xl border border-border"
                />
                <a
                  href={d.screenshotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary mt-2 inline-block text-sm font-semibold hover:underline"
                >
                  Open full size →
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No screenshot attached.</p>
            )}
            {d.status === "PENDING" && (
              <div className="space-y-3">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Rejection reason (optional)"
                  className="h-12 rounded-xl text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    className="flex-1 rounded-xl"
                    disabled={busy}
                    onClick={() => void act(true)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 rounded-xl"
                    disabled={busy}
                    onClick={() => void act(false)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (list.isLoading) return <TableSkeleton />;
  const rows = list.data ?? [];
  if (!rows.length)
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        No {label} manual deposits yet.
      </p>
    );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rows.map((row) => (
        <div key={`${row.source}:${row.id}`} className="card-surface animate-rise min-w-0 overflow-hidden p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {depositStatusBadge(row.status)}
            <span className="text-xs font-bold text-muted-foreground">
              {DEPOSIT_SOURCE_LABEL[row.source] ?? row.source}
            </span>
          </div>
          <p className="mt-3 font-medium break-all">{row.email}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.gameLabel} · {row.plan} · {row.currency} {row.amount}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.rail} · {row.networkOrBank} · Ref {row.reference}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{fmt(row.submittedAt)}</p>
          <Button
            className="mt-4 w-full rounded-xl"
            variant="outline"
            onClick={() => setSelected({ source: row.source, id: row.id })}
          >
            View details
          </Button>
        </div>
      ))}
    </div>
  );
}

type UserActiveGame = {
  game: string;
  plan: string;
  expiresAt: string;
  secondsLeft: number;
};

type UserRow = {
  email: string;
  username: string | null;
  name: string | null;
  createdAt: string;
  referredByAdminCode: string | null;
  active: boolean;
  deactivatedAt: string | null;
  source: string;
  hasScanRow: boolean;
  activeGames: UserActiveGame[];
  activePlan: string | null;
  everBought: boolean;
};

type UserWindow = {
  game: string;
  plan: string;
  source: string;
  startedAt: string;
  expiresAt: string;
  state: string;
  secondsLeft: number;
};

type UserHistoryItem = {
  source: string;
  id: string | null;
  plan: string | null;
  game: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  date: string;
};

type UserDetail = {
  email: string;
  username: string | null;
  name: string | null;
  createdAt: string;
  referredByAdminCode: string | null;
  active: boolean;
  deactivatedAt: string | null;
  source: string;
  hasScanRow: boolean;
  activeGames: UserActiveGame[];
  activePlan: string | null;
  scanAccess: boolean;
  legacySubscription: {
    plan: string;
    usageExpiresAt: string | null;
    subscriptionConsumed: boolean;
    active: boolean;
  } | null;
  windows: UserWindow[];
  everBought: boolean;
  plansEver: string[];
  lastPurchaseAt: string | null;
  purchaseHistory: UserHistoryItem[];
};

function userStatusBadge(active: boolean) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
        active ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
      }`}
    >
      {active ? "Active" : "Deactivated"}
    </span>
  );
}

const USER_SOURCE_LABEL: Record<string, string> = {
  manual: "Subscription",
  scan: "Scan",
  "scan-session": "Scan session",
  pricing: "Game pass",
  gate: "Gate fee",
};

/**
 * Superadmin customer directory: every signed-up user (casino accounts
 * plus scan-side-only identities), newest first. Clicking a user shows
 * the full detail — signup date, active plan right now with expiry,
 * ever-bought flag, purchase history across all rails — plus
 * Deactivate / Activate. Sim identities live in sim_* tables and
 * never appear here.
 */
function UsersTab() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useQuery({
    queryKey: ["sa-users"],
    queryFn: () => api<UserRow[]>("/api/superadmin/users", { token: adminToken.get() }),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ["sa-user", selected],
    queryFn: () =>
      api<UserDetail>(`/api/superadmin/users/${encodeURIComponent(selected!)}`, {
        token: adminToken.get(),
      }),
    enabled: !!selected,
    retry: false,
  });

  async function act(activate: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/superadmin/users/${encodeURIComponent(selected)}/${activate ? "activate" : "deactivate"}`, {
        method: "PUT",
        token: adminToken.get(),
      });
      toast.success(activate ? "User activated" : "User deactivated");
      void qc.invalidateQueries({ queryKey: ["sa-users"] });
      void qc.invalidateQueries({ queryKey: ["sa-user", selected] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
  const left = (seconds: number) => {
    if (seconds <= 0) return "expired";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s left`;
  };

  if (selected) {
    const d = detail.data;
    return (
      <div className="card-surface animate-rise overflow-hidden p-5">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="text-sm font-bold text-muted-foreground hover:text-foreground"
        >
          ← Back to users
        </button>
        {detail.isLoading || !d ? (
          <TableSkeleton />
        ) : (
          <div className="mt-4 min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {userStatusBadge(d.active)}
              <span className="text-xs font-bold text-muted-foreground">
                {d.source === "both" ? "Casino + scan account" : d.source === "account" ? "Casino account" : "Scan-only identity"}
              </span>
            </div>
            <dl className="min-w-0 space-y-3 text-sm">
              {(
                [
                  ["Account email", d.email],
                  ["Username", d.username ?? "—"],
                  ["Name", d.name ?? "—"],
                  ["Signed up", fmt(d.createdAt)],
                  ["Status", d.active ? "Active" : `Deactivated${d.deactivatedAt ? ` · ${fmt(d.deactivatedAt)}` : ""}`],
                  ["Referred by", d.referredByAdminCode ?? "—"],
                  ["Scan access", d.scanAccess ? "Yes" : "No"],
                  [
                    "Active plan right now",
                    d.activeGames.length
                      ? d.activeGames.map((g) => `${g.game} (${g.plan})`).join(", ")
                      : "No active plan",
                  ],
                  ["Ever bought a plan", d.everBought ? `Yes${d.plansEver.length ? ` · ${d.plansEver.join(", ")}` : ""}` : "No"],
                  ["Last purchase", fmt(d.lastPurchaseAt)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{k}</dt>
                  <dd className="mt-0.5 font-medium break-all">{v}</dd>
                </div>
              ))}
            </dl>
            {d.activeGames.length > 0 && (
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Active windows
                </p>
                <ul className="mt-2 space-y-2 text-sm">
                  {d.activeGames.map((g) => (
                    <li key={g.game} className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">
                        {g.game} · {g.plan}
                      </span>
                      <span className="text-muted-foreground">
                        {left(g.secondsLeft)} · until {fmt(g.expiresAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.legacySubscription && (
              <p className="text-sm text-muted-foreground">
                Legacy scan subscription: {d.legacySubscription.plan} ·{" "}
                {d.legacySubscription.active ? "active" : "not active"}
              </p>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Purchase history
              </p>
              {!d.purchaseHistory.length ? (
                <p className="mt-2 text-sm text-muted-foreground">No purchases yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {d.purchaseHistory.map((h, i) => (
                    <li key={`${h.source}:${h.id ?? i}`} className="flex flex-wrap justify-between gap-2 py-2">
                      <span className="font-medium">
                        {USER_SOURCE_LABEL[h.source] ?? h.source}
                        {h.game ? ` · ${h.game}` : ""}
                        {h.plan ? ` · ${h.plan}` : ""}
                        {h.amount != null ? ` · ${h.currency ?? ""} ${h.amount}` : ""}
                      </span>
                      <span className="text-muted-foreground">
                        {h.status} · {fmt(h.date)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              {d.active ? (
                <Button className="flex-1 rounded-xl" variant="outline" disabled={busy} onClick={() => void act(false)}>
                  Deactivate account
                </Button>
              ) : (
                <Button className="flex-1 rounded-xl" disabled={busy} onClick={() => void act(true)}>
                  Activate account
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (list.isLoading) return <TableSkeleton />;
  const rows = list.data ?? [];
  if (!rows.length)
    return <p className="text-muted-foreground py-10 text-center text-sm">No users yet.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rows.map((row) => (
        <div key={row.email} className="card-surface animate-rise min-w-0 overflow-hidden p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {userStatusBadge(row.active)}
            <span className="text-xs font-bold text-muted-foreground">
              {row.activeGames.length ? `Active plan: ${row.activePlan}` : "No active plan"}
            </span>
          </div>
          <p className="mt-3 font-medium break-all">{row.email}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.name ?? "—"}
            {row.username ? ` · @${row.username}` : ""}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed up {fmt(row.createdAt)} · Ever bought: {row.everBought ? "Yes" : "No"}
          </p>
          <Button
            className="mt-4 w-full rounded-xl"
            variant="outline"
            onClick={() => setSelected(row.email)}
          >
            View details
          </Button>
        </div>
      ))}
    </div>
  );
}
