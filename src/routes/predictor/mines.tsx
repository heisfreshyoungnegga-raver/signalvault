import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { MaterialIcon } from "@/components/ui/material-icon";
import { MinesBoard } from "@/components/predictor/MinesBoard";
import { PredictionsOffline } from "@/components/predictor/PredictionsOffline";
import { TimeUpOverlay, WindowChrome } from "@/components/window-ui";
import { useGameAccess } from "@/lib/use-game-access";
import { api, userToken } from "@/lib/api";

export const Route = createFileRoute("/predictor/mines")({
  component: MinesPage,
});

function MinesPage() {
  const { ready, me, meLoading, settled, offline, state, introSeen, expiresAt, refetchMe } =
    useGameAccess("mines", "/predictor/mines");

  // Login resume: remember this entry (once per mount) so a later
  // login takes the user straight back here while the window runs.
  const lastPlayedPosted = useRef(false);
  useEffect(() => {
    if (ready && settled && state === "active" && !lastPlayedPosted.current) {
      lastPlayedPosted.current = true;
      void api("/api/games/last-played", {
        method: "POST",
        body: { game: "mines" },
        token: userToken.get(),
      }).catch(() => {});
    }
  }, [ready, settled, state]);

  if (settled && state === "expired") {
    return <TimeUpOverlay gameName="Mines" gameId="mines" />;
  }

  if (!settled || !ready || meLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <MaterialIcon name="progress_activity" className="text-primary animate-spin text-[32px]" />
      </div>
    );
  }

  if (offline) return <PredictionsOffline gameName="Mines" />;

  return (
    <WindowChrome
      gameId="mines"
      gameName="Mines"
      state="active"
      introSeen={introSeen}
      expiresAt={expiresAt}
      onExpire={() => void refetchMe()}
    >
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/predictor"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All games
        </Link>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground md:text-2xl">
            Mines <span className="text-muted-foreground">·</span>{" "}
            <span className="text-base font-bold text-success">AI diamond locator</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Set the mine count and let the engine locate every diamond on the 5×5 grid.
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-[11px] font-bold text-success">
          <MaterialIcon name="account_balance_wallet" className="text-[14px]" />
          {me?.credits?.balance ?? 0} credits · 5 per game
        </span>
      </div>

      <MinesBoard />
    </div>
    </WindowChrome>
  );
}
