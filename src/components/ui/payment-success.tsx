import { useEffect } from "react";

import { cn } from "@/lib/utils";

/**
 * Animated payment-success screen: a teal check that draws itself,
 * then auto-redirects after a beat so the user actually sees it.
 */
export function PaymentSuccess({
  title,
  subtitle,
  onDone,
  delayMs = 2200,
  className,
}: {
  title: string;
  subtitle?: string;
  onDone: () => void;
  delayMs?: number;
  className?: string;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, delayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("card-surface animate-rise mx-auto max-w-xl p-6 text-center sm:p-8", className)}>
      <span className="success-pop mx-auto grid size-20 place-items-center rounded-full bg-success shadow-soft">
        <svg viewBox="0 0 24 24" className="size-10" fill="none">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="white"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="success-check-path"
          />
        </svg>
      </span>
      <h2 className="mt-5 text-3xl font-black tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{subtitle}</p>}
      <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold tracking-widest text-muted-foreground uppercase">
        <span className="size-1.5 animate-pulse rounded-full bg-success" />
        Redirecting…
      </p>
    </div>
  );
}
