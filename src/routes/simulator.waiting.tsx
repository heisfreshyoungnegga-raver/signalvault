import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { adminToken, simApprove, simDecline } from "@/lib/api";
import { MaterialIcon } from "@/components/ui/material-icon";

export const Route = createFileRoute("/simulator/waiting")({
  validateSearch: (search: Record<string, unknown>) => ({
    game: typeof search.game === "string" ? search.game : undefined,
    paymentId: typeof search.paymentId === "string" ? search.paymentId : undefined,
  }),
  component: SimWaitingPage,
});

// Same product names as the sim payment page, so the waiting screen
// names exactly what was bought.
const GAMES: Record<string, string> = {
  aviator: "Aviator",
  mines: "Mines",
  bottle: "Spin da Bottle",
  scan: "Instant Virtuals",
};

const NOTICE_KEY = "darkweb_sim_notice";

/**
 * The simulator's waiting page — the sim mirror of /payment/waiting.
 * Every sim submit lands here instead of sitting on the form: the
 * payment confirms on its own after 3 seconds (the sim's standing
 * auto-approve), then the page takes the user onward directly — a game
 * pass back to the lobby with 12 credits added, a scan purchase
 * straight to the slip scanner. Cancel during the wait declines the
 * payment and returns to where the user came from. No simulator wording
 * anywhere on the page: it reads exactly like the real waiting page.
 */
function SimWaitingPage() {
  const navigate = useNavigate();
  const { game: gameId, paymentId } = Route.useSearch();
  const gameName = gameId ? GAMES[gameId] : undefined;
  const valid = !!gameId && !!gameName && !!paymentId;
  const isScan = gameId === "scan";

  const [saToken, setSaToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"waiting" | "approved" | "error">("waiting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navGuard = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Staff-only, like every other sim page: anything else goes to the
  // superadmin login.
  useEffect(() => {
    const t = adminToken.get();
    if (!t || adminToken.role() !== "SUPER_ADMIN") {
      navigate({ to: "/superadmin/login" });
    } else {
      setSaToken(t);
    }
  }, [navigate]);

  const goOnward = () => {
    if (navGuard.current) return;
    navGuard.current = true;
    if (isScan) {
      // Scan approval lands directly on the slip scanner, mirroring
      // the real waiting page's scan → /scan-slip destination.
      navigate({ to: "/simulator/scan-slip" });
      return;
    }
    window.sessionStorage.setItem(
      NOTICE_KEY,
      `Payment approved — 12 credits added to your wallet.`,
    );
    navigate({ to: "/simulator" });
  };

  const approve = async () => {
    if (!saToken || !paymentId) return;
    setBusy(true);
    setError(null);
    try {
      await simApprove(paymentId, saToken);
      setPhase("approved");
      // Brief approved beat, then onward automatically — same shape
      // as the real waiting page's 2-second beat.
      timers.current.push(
        setTimeout(() => {
          setBusy(false);
          goOnward();
        }, 2000),
      );
    } catch {
      setBusy(false);
      setError("Confirmation failed. Please try again.");
      setPhase("error");
    }
  };

  // The 3-second auto-approve, running on this page instead of on the
  // submit form — so the wait itself is what the user sees.
  useEffect(() => {
    if (!saToken || !valid || phase !== "waiting") return;
    const t = setTimeout(() => void approve(), 3000);
    timers.current.push(t);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saToken, valid, phase]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => clearTimeout(t));
    },
    [],
  );

  const cancel = async () => {
    if (!saToken || !paymentId || busy) return;
    setBusy(true);
    try {
      await simDecline(paymentId, saToken);
    } catch {
      /* a failed decline still leaves the wait — the user just goes back */
    }
    timers.current.forEach((t) => clearTimeout(t));
    if (isScan) {
      navigate({ to: "/simulator/scan" });
      return;
    }
    window.sessionStorage.setItem(NOTICE_KEY, "Payment cancelled — nothing was granted.");
    navigate({ to: "/simulator" });
  };

  if (!saToken) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <div className="mb-6 rounded-2xl border border-secondary/30 bg-secondary-soft px-4 py-3 text-sm font-bold text-secondary">
          SIMULATION — practice play only. No real money, no real credits.
        </div>
        {!valid ? (
          <div className="border border-primary/15 bg-card p-6 text-center">
            <MaterialIcon name="error" className="mx-auto text-[40px] text-destructive" />
            <h1 className="mt-4 text-2xl font-black tracking-tight">
              Couldn&apos;t find this payment
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              This waiting link looks incomplete. Head back and try again.
            </p>
            <Link
              to="/simulator"
              className="mt-6 block bg-primary px-5 py-3 text-sm font-bold text-white"
            >
              Back to games
            </Link>
          </div>
        ) : phase === "error" ? (
          <div className="border border-primary/15 bg-card p-6 text-center">
            <MaterialIcon name="error" className="mx-auto text-[40px] text-destructive" />
            <h1 className="mt-4 text-2xl font-black tracking-tight">Confirmation failed</h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {error ?? "Something went wrong while confirming your payment."}
            </p>
            <div className="mt-6 grid gap-3">
              <button
                onClick={() => {
                  setPhase("waiting");
                  setError(null);
                }}
                className="bg-primary px-5 py-3 text-sm font-bold text-white"
              >
                Try again
              </button>
              <Link
                to="/simulator"
                className="block border border-primary/30 px-5 py-3 text-sm font-bold"
              >
                Back to games
              </Link>
            </div>
          </div>
        ) : phase === "approved" ? (
          <div className="border border-primary/15 bg-card p-6 text-center">
            <span className="mx-auto grid size-20 place-items-center rounded-full bg-success shadow-[0_0_40px_rgba(15,118,110,0.4)]">
              <MaterialIcon name="check_circle" filled className="text-[40px] text-foreground" />
            </span>
            <h1 className="mt-5 text-3xl font-black tracking-tight">Payment approved!</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {isScan
                ? "12 credits added — your slip scanner is ready."
                : `12 credits added — ${gameName} is ready to play.`}
            </p>
            <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold tracking-widest text-muted-foreground uppercase">
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              Taking you there…
            </p>
            <div className="mt-6">
              <button
                onClick={goOnward}
                className="w-full bg-primary px-5 py-3 text-sm font-bold text-white"
              >
                {isScan ? "Open the scanner" : "Continue to games"}
              </button>
            </div>
          </div>
        ) : (
          <div className="border border-primary/15 bg-card p-6 text-center">
            <MaterialIcon
              name="progress_activity"
              className="mx-auto animate-spin text-[48px] text-primary"
            />
            <h1 className="mt-5 text-3xl font-black tracking-tight">
              Waiting for payment confirmation
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Confirming your transfer — access activates automatically. This page updates on
              its own; no need to refresh.
            </p>
            <div className="bg-muted mt-6 p-4 text-left">
              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Payment ID
              </p>
              <p className="mt-1 font-mono text-sm font-bold break-all">{paymentId}</p>
              <p className="mt-3 text-sm">
                {isScan ? "AI slip scan" : "12 credits"} · {gameName}
              </p>
            </div>
            <button
              onClick={() => void cancel()}
              disabled={busy}
              className="mt-6 w-full bg-destructive px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
