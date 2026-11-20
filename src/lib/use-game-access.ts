import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  getVirtualPredictions,
  userToken,
  ApiError,
  type AccountUser,
} from "@/lib/api";

/**
 * Access gate for the credit-gated predictor pages (Mines, Spin da Bottle) —
 * the same contract as the engine pages in predictor/$gameId.tsx:
 *   no session → /login · fewer than 5 credits → /pricing?game=
 * plus the platform kill switch: when virtual predictions are OFF on the
 * server, the page renders the offline state instead of the game.
 * The switch only blocks on an explicit OFF — if the settings read fails
 * (API unreachable) the game stays open rather than stranding the user.
 */
export function useGameAccess(gameId: string, pagePath: string) {
  const navigate = useNavigate();
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

  // First-settled guard: the ["me", gameId] cache is shared across SPA
  // navigations, so a value left over from an earlier visit (LOCKED, or
  // introSeen=true from a previous window) is served on the first render
  // while the fresh fetch is still in flight. The bounce below and the
  // callers' intro/spinner decisions must wait for this mount's fetch to
  // settle, or a freshly-approved user bounces back to /pricing (or
  // skips the intro) before the fresh data arrives. After the first
  // settle the flag stays true, so the 30s background refetches never
  // flash the spinner.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!meFetching && me) setSettled(true);
  }, [meFetching, me]);

  const { data: vp } = useQuery({
    queryKey: ["virtual-predictions"],
    queryFn: () => getVirtualPredictions(),
    retry: false,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const plan = me?.plans[gameId];
  const win = me?.games?.[gameId];
  // Window state: the server's per-game map is authoritative; fall back
  // to plan presence for older payloads. EXPIRED does not bounce to the
  // plans page — the page renders the time-up overlay in place.
  const state: "locked" | "active" | "expired" =
    win?.state ?? (plan ? "active" : "locked");

  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) {
      userToken.clear();
      navigate({ to: "/login", search: { redirect: pagePath } });
      return;
    }
    if (!token) {
      navigate({ to: "/login", search: { redirect: pagePath } });
    } else if (me && settled && state === "locked") {
      navigate({ to: "/pricing", search: { game: gameId } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, me, meError, settled, gameId, state]);

  return {
    token,
    me,
    meLoading,
    settled,
    plan,
    win,
    state,
    expiresAt: win?.expiresAt ?? plan?.expiresAt ?? null,
    introSeen: win?.introSeen ?? plan?.introSeen ?? true,
    secondsLeft: plan?.secondsLeft ?? 0,
    ready: !!token && state === "active",
    offline: vp ? !vp.enabled : false,
    refetchMe,
  };
}

export function formatPassLeft(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m left`;
  return `${s}s left`;
}
