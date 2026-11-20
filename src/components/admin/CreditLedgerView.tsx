import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CreditOverview = {
  wallets: number;
  totalCredits: number;
  costPerUse: number;
  packs: { code: string; credits: number; priceGhs: number; priceNgn: number | null }[];
  topBalances: { identity: string; balance: number; updated_at: string }[];
  recentLedger: {
    identity: string;
    delta: number;
    reason: string;
    ref: string | null;
    balance_after: number;
    created_at: string;
  }[];
};

/**
 * Staff-only read view of the credit wallet (NEW 2026-11-20): how many
 * wallets exist, how many credits are in circulation, the live packs,
 * top balances, and the latest ledger rows (every grant/spend with its
 * idempotency ref) so a balance can be audited. Read-only — no grant
 * or spend happens here. Used by /admin and /superadmin.
 */
export function CreditLedgerView({ token, endpoint }: { token: string | null; endpoint: string }) {
  const q = useQuery({
    queryKey: ["credit-ledger", endpoint],
    queryFn: () => api<CreditOverview>(endpoint, { token }),
    enabled: !!token,
    retry: false,
  });

  if (q.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Could not load the credit ledger.
      </p>
    );
  }

  const d = q.data;
  const statCards = [
    ["Wallets", String(d.wallets)],
    ["Credits in circulation", String(d.totalCredits)],
    ["Cost per play", `${d.costPerUse} credits`],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {statCards.map(([label, value]) => (
          <div key={label} className="card-surface p-5">
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {label}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="card-surface p-5">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Live packs — 4 credits per play
        </p>
        <p className="mt-2 text-sm font-medium">
          {d.packs
            .map((p) => `GH₵${p.priceGhs.toLocaleString()} → ${p.credits} credits`)
            .join(" · ")}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          NGN prices are not set yet — Nigeria packs are disabled until the owner sets them.
        </p>
      </div>

      <div className="card-surface overflow-x-auto">
        <p className="text-muted-foreground p-5 pb-0 text-xs font-semibold tracking-wide uppercase">
          Top balances
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Identity</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.topBalances.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground py-6 text-center text-sm">
                  No wallets yet.
                </TableCell>
              </TableRow>
            )}
            {d.topBalances.map((r) => (
              <TableRow key={r.identity}>
                <TableCell className="max-w-56 truncate font-mono text-xs">{r.identity}</TableCell>
                <TableCell className="font-mono tabular-nums">{r.balance}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="card-surface overflow-x-auto">
        <p className="text-muted-foreground p-5 pb-0 text-xs font-semibold tracking-wide uppercase">
          Recent ledger (latest 100)
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Identity</TableHead>
              <TableHead>Delta</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead>Balance after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.recentLedger.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center text-sm">
                  No ledger rows yet.
                </TableCell>
              </TableRow>
            )}
            {d.recentLedger.map((r, i) => (
              <TableRow key={`${r.ref ?? r.created_at}-${i}`}>
                <TableCell className="whitespace-nowrap text-xs">
                  {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="max-w-48 truncate font-mono text-xs">{r.identity}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {r.delta > 0 ? `+${r.delta}` : r.delta}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{r.reason}</TableCell>
                <TableCell className="max-w-48 truncate font-mono text-xs">{r.ref ?? "—"}</TableCell>
                <TableCell className="font-mono tabular-nums">{r.balance_after}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
