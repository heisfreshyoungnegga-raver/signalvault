import { MaterialIcon } from "@/components/ui/material-icon";
import { Link } from "@tanstack/react-router";
import { useCrashRun } from "./useCrashRun";
import { NextRunPanel, RunHistory } from "./panels";
import { MinimalStage } from "./MinimalStage";
import { GAME_PAGE_THEMES } from "./gameThemes";
import { cn } from "@/lib/utils";

const VIDEO_BG: Record<string, string> = {
  aviator: "/videos/aviator-bg.mp4",
  "sporty-jet": "/videos/sportyjet-bg.mp4",
  sportyhero: "/videos/sportyhero-bg.mp4",
};

const CRASH_GAMES = [
  { id: "aviator", name: "Aviator" },
  { id: "sporty-jet", name: "Sporty Jet" },
  { id: "sportyhero", name: "SportyHero" },
];

/**
 * Crash predictor: full per-game page identity — background wash, header,
 * stage glow, button and accents all take the game's color.
 * Aviator + SportyHero are immersive: full-screen video background, the
 * predictor floats as a fixed glass panel with internal scroll.
 */
export function CrashPredictor({ gameId, gameName }: { gameId: string; gameName: string }) {
  const run = useCrashRun(gameId);
  const gt = GAME_PAGE_THEMES[gameId] ?? GAME_PAGE_THEMES["aviator"]!;
  const videoBg = VIDEO_BG[gameId];

  if (videoBg) {
    return (
      <div className="relative h-[100dvh] overflow-hidden bg-background text-foreground">
        {/* video background, veiled in warm paper cream so the panel reads light */}
        <video
          autoPlay muted loop playsInline
          src={videoBg}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#FBF6EC]/60" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#FBF6EC]/70 via-transparent to-[#FBF6EC]/80" />

        {/* minimal top nav — mobile gets just a close icon */}
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-end px-3 pt-3 md:justify-between md:px-5 md:pt-4">
          <Link
            to="/predictor"
            aria-label="Close"
            className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-white/85 text-foreground backdrop-blur-md transition hover:bg-white md:hidden"
          >
            <MaterialIcon name="close" className="text-[22px]" />
          </Link>
          <Link
            to="/predictor"
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-white/85 px-3.5 py-2 text-xs font-bold text-foreground backdrop-blur-md transition hover:bg-white md:inline-flex"
          >
            ← All games
          </Link>
          <div className="hidden gap-1.5 md:flex">
            {CRASH_GAMES.map((g) => (
              <Link
                key={g.id}
                to="/predictor/$gameId"
                params={{ gameId: g.id }}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-bold backdrop-blur-md transition",
                  g.id === gameId
                    ? "bg-primary text-white"
                    : "border border-border bg-white/85 text-muted-foreground hover:bg-white hover:text-foreground"
                )}
              >
                {g.name}
              </Link>
            ))}
          </div>
        </div>

        {/* floating fixed panel — page never scrolls, panel scrolls inside */}
        <div className="absolute inset-0 z-10 flex items-center justify-center px-3 pb-4 pt-16 md:px-6">
          <div
            className="w-full max-w-sm overflow-y-auto rounded-3xl border bg-[#FBF6EC]/90 p-4 shadow-2xl backdrop-blur-xl md:p-5"
            style={{
              maxHeight: "calc(100dvh - 7rem)",
              borderColor: `rgba(${gt.glow},0.28)`,
              boxShadow: `0 0 60px rgba(${gt.glow},0.15), 0 24px 60px rgba(28,25,23,0.18)`,
              scrollbarWidth: "thin",
            }}
          >
            <PredictorBody gameId={gameId} gameName={gameName} run={run} gt={gt} compact />
          </div>
        </div>
      </div>
    );
  }

  // standard (non-video) crash pages
  return (
    <div className="relative rounded-3xl p-5 md:p-6" style={{ background: gt.wash }}>
      <PredictorBody gameId={gameId} gameName={gameName} run={run} gt={gt} />
    </div>
  );
}

function PredictorBody({
  gameId, gameName, run, gt, compact,
}: {
  gameId: string;
  gameName: string;
  run: ReturnType<typeof useCrashRun>;
  gt: (typeof GAME_PAGE_THEMES)[string];
  compact?: boolean | undefined;
}) {
  const { phase, draw, history, error, looping, creditsLeft } = run;
  const busy = looping;
  const outOfCredits = error?.startsWith("Out of credits") ?? false;

  return (
    <div className={cn("space-y-3", !compact && "space-y-4")}>
      {/* header: title + next run */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p
            className="text-[10px] font-black uppercase tracking-[0.25em]"
            style={{ color: `rgba(${gt.glow},0.8)` }}
          >
            {gt.kicker}
          </p>
          <h2
            className={cn("mt-0.5 font-black tracking-tight text-foreground", compact ? "text-2xl" : "text-3xl md:text-4xl")}
          >
            {gt.title}
          </h2>
          {!compact && <p className="mt-1 text-xs text-muted-foreground">{gt.subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {creditsLeft != null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft px-3 py-1.5 text-[11px] font-bold text-primary">
              <MaterialIcon name="account_balance_wallet" className="text-[14px]" />
              {creditsLeft} credits · 5 per round
            </span>
          )}
          <NextRunPanel phase={phase} mult={run.mult} countdown={run.countdown} glow={gt.glow} />
        </div>
      </div>

      {/* the stage — just the number */}
      <MinimalStage run={run} gameId={gameId} compact={compact} />

      {/* visible errors — never fail silently */}
      {error && (
        <div className="mx-auto max-w-md space-y-2">
          <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-center text-sm font-bold text-destructive">
            {error}
          </p>
          {outOfCredits && (
            <Link
              to="/pricing"
              search={{ game: gameId }}
              className="block rounded-full bg-primary px-5 py-3 text-center text-sm font-black text-white transition hover:bg-primary-hover"
            >
              Top up credits
            </Link>
          )}
        </div>
      )}

      {/* draw proof */}
      {draw && (phase === "crashed" || phase === "countdown") && (
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <MaterialIcon name="fingerprint" className="text-[16px]" />
          <span className="break-all">
            Provably-fair draw · {draw.crash.toFixed(2)}x · hash {draw.hash.slice(0, 18)}… · seed {draw.seed.slice(0, 10)}…
          </span>
        </p>
      )}

      {/* controls */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          {busy ? (
            <button
              onClick={run.stop}
              className="inline-flex items-center gap-2 rounded-2xl bg-destructive/10 px-8 py-3.5 text-base font-black uppercase tracking-widest text-destructive ring-1 ring-destructive/40 transition hover:bg-destructive/15"
            >
              <MaterialIcon name="stop" filled className="text-[22px]" /> Stop
            </button>
          ) : (
            <button
              onClick={run.run}
              className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-2xl bg-primary px-10 py-3.5 text-base font-black uppercase tracking-widest text-white shadow-[0_0_36px_rgba(225,77,42,0.35)] transition hover:bg-primary-hover active:scale-95"
            >
              <span className="absolute inset-0 animate-ping rounded-2xl bg-primary opacity-25 [animation-duration:1.8s]" />
              <MaterialIcon name="play_arrow" filled className="relative text-[24px]" />
              <span className="relative">Run</span>
            </button>
          )}
        </div>

        <RunHistory history={history} />

        <p className="max-w-md text-center text-[11px] leading-relaxed text-muted-foreground">
          Each run draws a fresh crash point from {gameName}'s verified provably-fair distribution —
          independent every time. History can't change the next draw.
        </p>
      </div>
    </div>
  );
}
