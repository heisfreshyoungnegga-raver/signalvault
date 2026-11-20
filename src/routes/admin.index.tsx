import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy, LogOut, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


import { adminToken, api } from "@/lib/api";
import { RoundCustomization } from "@/components/predictor/RoundCustomization";
import { BottlePatternView } from "@/components/predictor/BottleRounds";
import { MinesBoard } from "@/components/predictor/MinesBoard";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin dashboard — SignalVault" },
      {
        name: "description",
        content: "Review manual payments, scan purchases, referrals and commissions.",
      },
      { property: "og:title", content: "Admin dashboard — SignalVault" },
      { property: "og:description", content: "SignalVault staff review and referral dashboard." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminDashboard,
});

type AdminMe = {
  username: string;
  role: string;
  referralCode: string;
  referralLink: string;
  adminSharePercent: number;
  platformSharePercent: number;
  active: boolean;
};

type AdminStats = {
  referralCode: string;
  split: string;
  referredUserCount: number;
  commissionEarnedToday: number;
  commissionEarnedThisWeek: number;
  totalCommissionEarned: number;
  totalCommissionPending: number;
  totalCommissionPaidOut: number;
};

type Row = Record<string, unknown>;

function AdminDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = adminToken.get();
    if (!t) navigate({ to: "/admin/login" });
    else setToken(t);
  }, [navigate]);

  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api<AdminMe>("/api/admin/me", { token }),
    enabled: !!token,
    retry: false,
  });

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api<AdminStats>("/api/admin/stats", { token }),
    enabled: !!token,
    retry: false,
  });

  const pendingManual = useQuery({
    queryKey: ["manual-pending"],
    queryFn: () => api<Row[]>("/api/admin/manual-payments/pending", { token }),
    enabled: !!token,
    retry: false,
  });

  const pendingScans = useQuery({
    queryKey: ["scan-pending"],
    queryFn: () => api<Row[]>("/api/admin/scan-purchases/pending", { token }),
    enabled: !!token,
    retry: false,
  });

  const users = useQuery({
    queryKey: ["admin-referred"],
    queryFn: () => api<Row[]>("/api/admin/users/referred", { token }),
    enabled: !!token,
    retry: false,
  });

  const commissions = useQuery({
    queryKey: ["admin-commissions"],
    queryFn: () => api<Row[]>("/api/admin/commissions", { token }),
    enabled: !!token,
    retry: false,
  });

  const payouts = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: () => api<Row[]>("/api/admin/payouts", { token }),
    enabled: !!token,
    retry: false,
  });

  async function review(kind: "manual-payments" | "scan-purchases", id: string, approve: boolean) {
    try {
      await api(`/api/admin/${kind}/${id}/${approve ? "approve" : "reject"}`, {
        method: "POST",
        token,
        body: approve ? undefined : { reason: "Screenshot doesn't match the amount" },
      });
      toast.success(approve ? "Approved" : "Rejected");
      void qc.invalidateQueries({
        queryKey: [kind === "manual-payments" ? "manual-pending" : "scan-pending"],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  }

  function signOut() {
    void api("/api/admin/auth/logout", { method: "POST", token }).catch(() => undefined);
    adminToken.clear();
    navigate({ to: "/admin/login" });
  }

  if (!token) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="text-primary size-7 animate-spin" />
      </div>
    );
  }

  const statCards = [
    ["Referred users", stats.data?.referredUserCount ?? 0],
    ["Earned today", `GHS ${stats.data?.commissionEarnedToday ?? 0}`],
    ["This week", `GHS ${stats.data?.commissionEarnedThisWeek ?? 0}`],
    ["Pending payout", `GHS ${stats.data?.totalCommissionPending ?? 0}`],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">Admin dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {me.data?.username ?? "…"} · {me.data?.role ?? adminToken.role()} · split{" "}
            {stats.data?.split ?? "—"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => void qc.invalidateQueries()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button variant="ghost" className="rounded-full" onClick={signOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(([label, value], i) => (
          <div
            key={label}
            className="card-surface animate-rise p-5"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {label}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="card-surface mt-6 p-6">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Your referral link
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input readOnly value={me.data?.referralLink ?? ""} className="h-12 rounded-xl font-mono text-xs" />
          <Button
            className="h-12 rounded-xl"
            onClick={() => {
              void navigator.clipboard.writeText(me.data?.referralLink ?? "");
              toast.success("Referral link copied");
            }}
          >
            <Copy className="size-4" /> Copy
          </Button>
        </div>
      </div>

      <Tabs defaultValue="manual" className="mt-10">
        <TabsList className="scrollbar-none h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto rounded-2xl p-1.5">
          {(
            [
              ["manual", "Manual payments"],
              ["scans", "Scan purchases"],
              ["users", "Referred users"],
              ["commissions", "Commissions"],
              ["payouts", "Payouts"],
              ["rounds", "Round customization"],
              ["bottle", "Bottle rounds"],
              ["mines", "Mines playtest"],
            ] as const
          ).map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="shrink-0 rounded-xl px-4 py-2 text-sm">
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="manual" className="mt-6">
          <ReviewQueue
            rows={pendingManual.data ?? []}
            loading={pendingManual.isLoading}
            onAction={(id, approve) => void review("manual-payments", id, approve)}
          />
        </TabsContent>
        <TabsContent value="scans" className="mt-6">
          <ReviewQueue
            rows={pendingScans.data ?? []}
            loading={pendingScans.isLoading}
            onAction={(id, approve) => void review("scan-purchases", id, approve)}
          />
        </TabsContent>
        <TabsContent value="users" className="mt-6">
          <DataTable rows={users.data ?? []} loading={users.isLoading} />
        </TabsContent>
        <TabsContent value="commissions" className="mt-6">
          <DataTable rows={commissions.data ?? []} loading={commissions.isLoading} />
        </TabsContent>
        <TabsContent value="payouts" className="mt-6">
          <DataTable rows={payouts.data ?? []} loading={payouts.isLoading} />
        </TabsContent>
        <TabsContent value="rounds" className="mt-6">
          <RoundCustomization />
        </TabsContent>
        <TabsContent value="bottle" className="mt-6">
          <BottlePatternView />
        </TabsContent>
        <TabsContent value="mines" className="mt-6">
          <div className="mx-auto w-full max-w-2xl space-y-5">
            <div className="rounded-2xl border border-primary/20 bg-primary-soft p-4">
              <h2 className="text-sm font-black text-foreground">Staff playtest — Mines</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The exact board players get with a Premium pass (mine-count cap 10, the
                Premium tier). Generation is client-side, so this sandbox needs no pass
                and moves no money — play it the way a customer would.
              </p>
            </div>
            <MinesBoard sandbox />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ReviewQueue({
  rows,
  loading,
  onAction,
}: {
  rows: Row[];
  loading: boolean;
  onAction: (id: string, approve: boolean) => void;
}) {
  if (loading) return <TableSkeleton />;
  if (!rows.length)
    return <p className="text-muted-foreground py-10 text-center text-sm">Nothing to review.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rows.map((row, i) => {
        const id = String(row["id"] ?? i);
        const url = (row["screenshotUrl"] as string | undefined) ?? undefined;
        return (
          <div key={id} className="card-surface animate-rise overflow-hidden p-5">
            <p className="font-mono text-xs break-all">{id}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {Object.entries(row)
                .filter(([k]) => k !== "id" && k !== "screenshotUrl")
                .slice(0, 8)
                .map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">
                      {k}
                    </dt>
                    <dd className="truncate font-medium">{String(v ?? "—")}</dd>
                  </div>
                ))}
            </dl>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-primary mt-3 inline-block text-sm font-semibold hover:underline"
              >
                View screenshot →
              </a>
            )}
            <div className="mt-5 flex gap-2">
              <Button className="flex-1 rounded-xl" onClick={() => onAction(id, true)}>
                Approve
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => onAction(id, false)}
              >
                Reject
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}


export function TableSkeleton() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="text-primary size-6 animate-spin" />
    </div>
  );
}

export function DataTable({ rows, loading }: { rows: Row[]; loading: boolean }) {
  if (loading) return <TableSkeleton />;
  if (!rows.length)
    return <p className="text-muted-foreground py-10 text-center text-sm">No records yet.</p>;

  const cols = Object.keys(rows[0] ?? {});
  return (
    <div className="card-surface overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c} className="whitespace-nowrap">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c} className="max-w-56 truncate whitespace-nowrap">
                  {String(r[c] ?? "—")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
