import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { MaterialIcon } from "@/components/ui/material-icon";
import { useCountdown, formatMmSs } from "@/lib/use-window";
import { markIntroSeen } from "@/lib/api";
import { EngineIntro } from "@/components/engine-intro";
import { cn } from "@/lib/utils";

/**
 * All the window furniture for one game page, in one wrapper:
 *   active window, intro unseen → the engine-entry intro plays once
 *   active window               → floating live countdown pill
 *   expired window              → time-up overlay locks the page
 *   out of credits              → out-of-credits overlay locks the page
 * Children (the game itself) always render underneath; the server
 * independently refuses actions without credits.
 */
export function WindowChrome({
  gameId,
  gameName,
  state,
  introSeen,
  expiresAt,
  onExpire,
  outOfCredits,
  children,
}: {
  gameId: string;
  gameName: string;
  state: "locked" | "active" | "expired";
  introSeen: boolean;
  expiresAt: string | null | undefined;
  onExpire?: () => void;
  outOfCredits?: boolean;
  children: ReactNode;
}) {
  const [introDone, setIntroDone] = useState(false);
  const showIntro = state === "active" && !introSeen && !introDone;
  return (
    <>
      {children}
      {state === "active" && <WindowCountdownPill expiresAt={expiresAt} onExpire={onExpire} />}
      {showIntro && (
        <EngineIntro
          onDone={() => {
            setIntroDone(true);
            void markIntroSeen(gameId);
          }}
        />
      )}
      {state === "expired" && <TimeUpOverlay gameName={gameName} gameId={gameId} />}
      {outOfCredits && <OutOfCreditsOverlay gameName={gameName} gameId={gameId} />}
    </>
  );
}

/**
 * Slim floating countdown pill for in-engine pages — shows the live
 * mm:ss left on the player's access window, straight from the server's
 * expiresAt. Turns red under 5:00. Calls onExpire when the wall clock
 * runs out so the page can swap in the time-up overlay.
 */
export function WindowCountdownPill({
  expiresAt,
  onExpire,
}: {
  expiresAt: string | null | undefined;
  onExpire?: () => void;
}) {
  const secondsLeft = useCountdown(expiresAt, onExpire);
  if (!expiresAt) return null;
  const urgent = secondsLeft < 300;
  return (
    <div
      className={cn(
        "fixed right-3 top-3 z-[60] inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[12px] font-bold tabular-nums shadow-soft backdrop-blur",
        urgent
          ? "border-destructive/40 bg-white text-destructive"
          : "border-success/30 bg-white text-success",
      )}
      aria-label="Time left on this game"
    >
      <MaterialIcon name="schedule" className="text-[14px]" />
      {formatMmSs(secondsLeft)} left
    </div>
  );
}

/**
 * Shown when a window lapses mid-visit (or is already gone on entry):
 * the game locks behind this overlay and Renew routes to the game's
 * existing manual-payment flow on the pricing page.
 */
export function TimeUpOverlay({
  gameName,
  gameId,
}: {
  gameName: string;
  gameId: string;
}) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-white text-center shadow-lift">
        <div className="kente-strip h-[6px] w-full" aria-hidden />
        <div className="p-6">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-destructive/10">
            <MaterialIcon name="timer_off" filled className="text-[28px] text-destructive" />
          </span>
          <h2 className="mt-4 text-xl font-black tracking-tight text-foreground">
            Your 45 minutes are up
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your access window for <span className="font-bold text-foreground">{gameName}</span> has
            ended and the game has locked again. Renew to jump straight back in.
          </p>
          <Link
            to="/pricing"
            search={{ game: gameId }}
            className="mt-5 block rounded-full bg-primary px-5 py-3 text-sm font-black text-white transition hover:bg-primary-deep"
          >
            Renew {gameName}
          </Link>
          <Link
            to="/predictor"
            className="mt-3 block text-xs font-bold text-muted-foreground transition hover:text-foreground"
          >
            Back to the lobby
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown when the wallet hits 0 mid-visit (or is already empty on
 * entry): the game locks behind this overlay and Top up routes to the
 * credit top-up on the pricing page. The server refuses every further
 * draw until the wallet is topped up again.
 */
export function OutOfCreditsOverlay({
  gameName,
  gameId,
}: {
  gameName: string;
  gameId: string;
}) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-white text-center shadow-lift">
        <div className="kente-strip h-[6px] w-full" aria-hidden />
        <div className="p-6">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-destructive/10">
            <MaterialIcon name="account_balance_wallet" filled className="text-[28px] text-destructive" />
          </span>
          <h2 className="mt-4 text-xl font-black tracking-tight text-foreground">
            Out of credits
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your credits ran out — <span className="font-bold text-foreground">{gameName}</span> is
            locked again. Each scan or play costs 4 credits. Top up to jump straight
            back in.
          </p>
          <Link
            to="/pricing"
            search={{ game: gameId }}
            className="mt-5 block rounded-full bg-primary px-5 py-3 text-sm font-black text-white transition hover:bg-primary-deep"
          >
            Top up credits
          </Link>
          <Link
            to="/predictor"
            className="mt-3 block text-xs font-bold text-muted-foreground transition hover:text-foreground"
          >
            Back to the lobby
          </Link>
        </div>
      </div>
    </div>
  );
}
