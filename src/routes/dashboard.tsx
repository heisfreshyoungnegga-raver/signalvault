import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MaterialIcon } from "@/components/ui/material-icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, ApiError, formatCountdown, userToken, type CreditSummary, type StatusData } from "@/lib/api";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "My session — SignalVault" },
      {
        name: "description",
        content: "Your SignalVault credit wallet and quick links to features.",
      },
      { property: "og:title", content: "My session — SignalVault" },
      {
        property: "og:description",
        content: "Track your credit balance in real time.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusData | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<CreditSummary | null>(null);
  const totalRef = useRef(1);

  const endSession = useCallback(
    (message: string) => {
      userToken.clear();
      toast.error(message);
      navigate({ to: "/login" });
    },
    [navigate],
  );

  const load = useCallback(async () => {
    const token = userToken.get();
    if (!token) {
      navigate({ to: "/login" });
      return;
    }
    try {
      const data = await api<StatusData>("/api/protected/status", { token });
      setStatus(data);
      setSeconds(data.secondsRemaining);
      totalRef.current = Math.max(totalRef.current, data.secondsRemaining);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        endSession(err.message || "Your time is up. Please subscribe again.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not load session");
    } finally {
      setLoading(false);
    }
    // Credit wallet — the hero figure on this page.
    try {
      setWallet(await api<CreditSummary>("/api/credits/balance", { token }));
    } catch {
      // Legacy session still renders below; a failed wallet read never
      // blocks the page.
    }
  }, [endSession, navigate]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 30000);
    return () => clearInterval(poll);
  }, [load]);

  useEffect(() => {
    // Don't count down until the session has actually loaded: `seconds`
    // starts at 0, and an unguarded tick fires "time is up", clears the
    // token and bounces to /login while the first /api/protected/status
    // call is still in flight on a slow connection (found live 2026-11-20:
    // dashboard always bounced ~1s after mount). Only count once we hold
    // a real remaining-seconds value.
    if (loading || !status) return;
    const tick = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          endSession("Your time is up. Please subscribe again.");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [endSession, loading, status]);

  async function logout() {
    const token = userToken.get();
    try {
      await api("/api/auth/logout", { method: "POST", token });
      toast.success("Logged out successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Logout failed");
    } finally {
      userToken.clear();
      navigate({ to: "/login" });
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <MaterialIcon name="progress_activity" className="text-primary text-[30px] animate-spin" />
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, (seconds / totalRef.current) * 100));

  return (
    <div className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">Your session</h1>
            <p className="text-muted-foreground mt-1 text-sm">{status?.username}</p>
          </div>
          <Button variant="outline" className="rounded-full" onClick={() => void logout()}>
            <MaterialIcon name="logout" className="text-[20px]" /> Log out
          </Button>
        </div>

        {/* Credit wallet — the hero figure */}
        <div className="card-surface animate-rise mt-8 overflow-hidden">
          <div className="kente-strip h-[6px] w-full" aria-hidden />
          <div className="p-6 sm:p-10">
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
              <MaterialIcon name="account_balance_wallet" className="text-[20px] text-primary" />
              Your credit wallet
            </div>
            <p className="mt-3 font-mono text-5xl font-semibold tabular-nums sm:text-7xl">
              {wallet ? `${wallet.balance} credits` : "—"}
            </p>
            <p className="text-muted-foreground mt-3 text-sm">
              4 credits per scan or play · Never expires · Top-ups stack
            </p>
            <Button asChild className="mt-6 rounded-full">
              <Link to="/pricing">Top up credits — from GH₵250</Link>
            </Button>
          </div>
        </div>

        {/* Legacy session countdown — kept, secondary */}
        <div className="card-surface mt-6 p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <MaterialIcon name="timer" className="text-[20px]" /> Time remaining on your legacy session
          </div>
          <p className="mt-3 font-mono text-4xl font-semibold tabular-nums sm:text-5xl">
            {formatCountdown(seconds)}
          </p>
          <Progress value={pct} className="mt-6 h-2 rounded-full" />
          <p className="text-muted-foreground mt-4 text-sm">
            Session ends at {status?.expiresAt?.replace("T", " ") ?? "—"}
          </p>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          <div className="card-surface card-hover p-6">
            <span className="bg-primary-soft text-primary flex size-10 items-center justify-center rounded-xl">
              <MaterialIcon name="casino" className="text-[24px]" />
            </span>
            <h2 className="mt-4 text-lg font-bold">Engines</h2>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              Aviator crash calls — 4 credits a play.
            </p>
            <Button asChild variant="secondary" className="mt-5 rounded-xl">
              <Link to="/predictor">Open lobby</Link>
            </Button>
          </div>

          <div className="card-surface card-hover p-6">
            <span className="bg-primary-soft text-primary flex size-10 items-center justify-center rounded-xl">
              <MaterialIcon name="qr_code_scanner" className="text-[24px]" />
            </span>
            <h2 className="mt-4 text-lg font-bold">AI betting-slip scan</h2>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              Upload a slip and get AI predictions on your picks. Each completed scan costs 4
              credits.
            </p>
            <Button asChild variant="secondary" className="mt-5 rounded-xl">
              <Link to="/scan">Open scan</Link>
            </Button>
          </div>

          <div className="card-surface card-hover p-6">
            <span className="bg-primary-soft text-primary flex size-10 items-center justify-center rounded-xl">
              <MaterialIcon name="auto_awesome" filled className="text-[24px]" />
            </span>
            <h2 className="mt-4 text-lg font-bold">Need more credits?</h2>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              Four tiers — 4 to 20 credits, from GH₵250. Top-ups stack and never expire.
            </p>
            <Button asChild variant="secondary" className="mt-5 rounded-xl">
              <Link to="/pricing">Top up</Link>
            </Button>
          </div>
        </div>

        <div className="bg-muted text-muted-foreground mt-8 flex items-start gap-3 rounded-2xl p-5 text-sm">
          <MaterialIcon name="schedule" className="mt-0.5 text-[20px] shrink-0" />
          <p className="leading-relaxed">
            Keep this tab open to watch the countdown. When your time runs out you're logged out
            automatically and sent back to the login screen.
          </p>
        </div>
      </div>
    </div>
  );
}
