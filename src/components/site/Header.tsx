import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Menu, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api, userToken, type AccountUser } from "@/lib/api";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center">
      <Logo compact={compact} />
    </Link>
  );
}

const NAV_LINKS = [
  { to: "/engines", label: "Engines" },
  { to: "/scan", label: "Slip scan" },
  { to: "/pricing", label: "Pricing" },
] as const;

function WalletPill() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    setToken(userToken.get());
  }, []);
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<AccountUser>("/api/auth/me", { token: token ?? null }),
    enabled: !!token,
    retry: false,
    staleTime: 30_000,
  });
  const balance = me?.credits?.balance;
  if (!token || balance == null) return null;
  return (
    <Link
      to="/pricing"
      className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary"
    >
      <Wallet className="size-3.5" />
      <span className="font-mono tabular-nums">{balance} credits</span>
      <span className="font-semibold underline underline-offset-2">Top up</span>
    </Link>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setAuthed(userToken.get() !== null);
  }, [location.pathname]);
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <header className="bg-surface/90 sticky top-0 z-50 border-b border-border backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Brand />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <WalletPill />
          {authed ? (
            <Link
              to="/predictor"
              className="hidden rounded-full bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-deep sm:inline-flex"
            >
              Open the lobby
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden rounded-full px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted sm:inline-flex"
              >
                Log in
              </Link>
              <Link
                to="/pricing"
                className="inline-flex rounded-full bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-deep"
              >
                Get access
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className={cn(
              "grid size-10 place-items-center rounded-full border border-border text-foreground md:hidden",
            )}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border bg-surface px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                {l.label}
              </Link>
            ))}
            {!authed && (
              <Link
                to="/login"
                className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Log in
              </Link>
            )}
            <Link
              to="/predictor"
              className="rounded-xl px-3 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft"
            >
              Open the lobby
            </Link>
          </nav>
        </div>
      )}
      <div className="kente-strip h-[3px] w-full" aria-hidden />
    </header>
  );
}
