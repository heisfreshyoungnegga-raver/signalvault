import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/material-icon";
import {
  loaderFetch,
  userToken,
  api,
  ApiError,
  type AccountUser,
  type EngineDetail,
  type EngineRound,
  type ZoneStat,
  type ActionZoneMetric,
} from "@/lib/api";
import { CrashAnalytics } from "@/components/predictor/CrashAnalytics";
import { PenaltyAnalytics } from "@/components/predictor/PenaltyAnalytics";
import { ActionAnalytics } from "@/components/predictor/ActionAnalytics";
import { WindowChrome } from "@/components/window-ui";

export const Route = createFileRoute("/predictor/$gameId")({
  loader: async ({ params }) => {
    const [detail, history] = await Promise.all([
      loaderFetch<EngineDetail>(`/api/engines/${params.gameId}`).catch(() => null),
      loaderFetch<EngineRound[]>(`/api/engines/${params.gameId}/history?limit=200`).catch(
        () => [] as EngineRound[],
      ),
    ]);
    // Zone stats for the non-crash games, fetched server-side so the
    // heatmaps render without a client round-trip.
    let penaltyZones: ZoneStat[] = [];
    let actionZones: ActionZoneMetric[] = [];
    if (params.gameId === "sportykick") {
      const r = await loaderFetch<{ zones: ZoneStat[] }>(
        `/api/engines/sportykick/zones?window=120`,
      ).catch(() => null);
      penaltyZones = r?.zones ?? [];
    } else if (params.gameId === "super-hero") {
      const r = await loaderFetch<{ zones: ActionZoneMetric[] }>(
        `/api/engines/super-hero/zones?window=120`,
      ).catch(() => null);
      actionZones = r?.zones ?? [];
    }
    return { detail, history, penaltyZones, actionZones };
  },
  component: GameAnalyticsPage,
});

const NAMES: Record<string, string> = {
  "sporty-jet": "Sporty Jet",
  aviator: "Aviator",
  sportykick: "SportyKick",
  sportyhero: "SportyHero",
  "super-hero": "Super Hero",
  "test-flight": "Test Flight",
};

function GameAnalyticsPage() {
  const { gameId } = Route.useParams();
  const navigate = useNavigate();
  const { detail, history, penaltyZones, actionZones } = Route.useLoaderData();

  const name = NAMES[gameId] ?? gameId;
  const type = detail?.prediction?.type;
  // Immersive video pages (aviator, sporty-jet, sportyhero) own the whole screen —
  // CrashPredictor renders its own minimal nav, so skip the page header.
  const isImmersive = gameId === "aviator" || gameId === "sporty-jet" || gameId === "sportyhero";

  // Entitlement: login -> active plan for THIS game.
  // No session -> login. No plan -> plans page.
  // Uses its own ["me", gameId] key, but that cache is shared across SPA
  // navigations in this session — a value left over from an earlier visit
  // (LOCKED, or introSeen=true from a previous window) is served on the
  // first render while the fresh fetch is still in flight. The
  // first-settled guard below is what stops that stale value from
  // bouncing a freshly-approved user back to the plans page or skipping
  // the intro; the bounce and the intro decision wait for this mount's
  // fetch to settle.
  const token = typeof window !== "undefined" ? userToken.get() : null;
  const {
    data: me,
    isLoading: meLoading,
    isFetching: meFetching,
    error: meError,
    refetch: refetchMe,
  } = useQuery({
    queryKey: ["me", gameId],
    queryFn: () => api<AccountUser>("/api/auth/me", { token: token ?? null }),
    enabled: !!token,
    retry: false,
    refetchInterval: 30000,
  });

  // First-settled guard (see above). After the first settle the flag
  // stays true, so the 30s background refetches never flash the spinner.
  const [meSettled, setMeSettled] = useState(false);
  useEffect(() => {
    if (!meFetching && me) setMeSettled(true);
  }, [meFetching, me]);

  // Credit-gate state for THIS game: locked bounces to the top-up
  // page; active plays. 'expired' is no longer sent by the server
  // (credits never expire) — the branch below stays as a guard.
  const win = me?.games?.[gameId];
  const winState: "locked" | "active" | "expired" =
    win?.state ?? (me?.plans[gameId] ? "active" : "locked");

  // Login resume: remember this entry (once per mount) so a later
  // login takes the user straight back here while the window runs.
  // Fire-and-forget — a failed note must never block the engine.
  const lastPlayedPosted = useRef(false);
  useEffect(() => {
    if (me && meSettled && winState === "active" && !lastPlayedPosted.current) {
      lastPlayedPosted.current = true;
      void api("/api/games/last-played", {
        method: "POST",
        body: { game: gameId },
        token: token ?? null,
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, meSettled, winState, gameId]);

  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) {
      userToken.clear();
      navigate({ to: "/login", search: { redirect: `/predictor/${gameId}` } });
      return;
    }
    if (!token) {
      navigate({ to: "/login", search: { redirect: `/predictor/${gameId}` } });
    } else if (me && meSettled && winState === "locked") {
      navigate({ to: "/pricing", search: { game: gameId } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, me, meError, meSettled, gameId, winState]);

  if (!token || meLoading || !me || !meSettled || winState === "locked") {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <MaterialIcon name="progress_activity" className="text-primary animate-spin text-[32px]" />
      </div>
    );
  }

  if (winState === "expired") {
    return (
      <WindowChrome
        gameId={gameId}
        gameName={name}
        state="expired"
        introSeen
        expiresAt={win?.expiresAt ?? null}
      >
        <div className="grid min-h-[60vh] place-items-center">
          <p className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground">
            <MaterialIcon name="lock" className="text-[18px]" /> {name} is locked
          </p>
        </div>
      </WindowChrome>
    );
  }

  const content = (
    <div className="space-y-5">
      {!isImmersive && (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/predictor"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> All games
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground md:text-2xl">
            {name} analytics
          </h1>
          <Link
            to="/engines/$gameId"
            params={{ gameId }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-muted-foreground transition hover:text-foreground"
          >
            <ExternalLink className="size-3.5" /> Live predictor
          </Link>
        </div>
      )}

      {!detail ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center">
          <p className="text-sm font-bold text-foreground">Engine not found</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Could not load analytics for "{gameId}". The server may be unreachable.
          </p>
        </div>
      ) : type === "crash" ? (
        <CrashAnalytics gameId={gameId} gameName={name} />
      ) : type === "penalty" ? (
        <PenaltyAnalytics gameName={name} initialZones={penaltyZones} />
      ) : type === "action" ? (
        <ActionAnalytics initialZones={actionZones} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Analytics for this engine type are not available yet.
        </p>
      )}
    </div>
  );

  return (
    <WindowChrome
      gameId={gameId}
      gameName={name}
      state="active"
      introSeen={win?.introSeen ?? me.plans[gameId]?.introSeen ?? true}
      expiresAt={win?.expiresAt ?? me.plans[gameId]?.expiresAt ?? null}
      onExpire={() => void refetchMe()}
    >
      {content}
    </WindowChrome>
  );
}
