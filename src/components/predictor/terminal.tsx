import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Card shell for the analytics desk — white card, sand border, on cream. */
export function Panel({ title, subtitle, action, children, className }: {
  title?: string;
  subtitle?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-white p-4 shadow-soft md:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-sm font-extrabold tracking-tight text-foreground">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, sub, tone = "default", tip }: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "up" | "down" | "warn" | "info";
  tip?: string;
}) {
  const tones = {
    default: "text-foreground",
    up: "text-success",
    down: "text-destructive",
    warn: "text-warning",
    info: "text-secondary",
  } as const;
  return (
    <div className="rounded-xl border border-border bg-white p-3.5 shadow-soft">
      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
        {tip && (
          <span title={tip} className="cursor-help text-muted-foreground hover:text-foreground">
            <Info className="size-3" />
          </span>
        )}
      </p>
      <p className={cn("mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight md:text-2xl", tones[tone])}>{value}</p>
      {sub && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function DemoBadge({ children = "Simulated data" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
      {children}
    </span>
  );
}

export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
      <span className="size-1.5 animate-pulse rounded-full bg-success" />
      Live
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-muted", className)} />;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function RiskPill({ level }: { level: string }) {
  const map: Record<string, string> = {
    Low: "border-success/30 bg-success/10 text-success",
    Medium: "border-warning/30 bg-warning/10 text-warning",
    High: "border-destructive/30 bg-destructive/10 text-destructive",
  };
  return (
    <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold", map[level] ?? map["Medium"])}>
      {level} risk
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-input bg-white px-3.5 py-2.5 text-sm font-semibold text-foreground tabular-nums outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export const btnPrimaryCls =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-extrabold text-white shadow-soft transition hover:bg-primary-deep active:scale-[0.98] disabled:opacity-50";

export const btnGhostCls =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-bold text-foreground transition hover:bg-muted active:scale-[0.98]";

export function fmt(n: number, dp = 2): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtInt(n: number): string {
  if (!isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-GB");
}
