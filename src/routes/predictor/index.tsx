import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  listEngines,
  ENGINES_FALLBACK,
  userToken,
  ApiError,
  type AccountUser,
  type EngineGame,
} from "@/lib/api";
import { CasinoLobbyView } from "@/components/predictor/casino-lobby";

export const Route = createFileRoute("/predictor/")({
  component: CasinoLobby,
});

/**
 * Games lobby route — thin wrapper: entitlement query, rendering the
 * shared CasinoLobbyView (the same view the superadmin simulator
 * renders for a simulated identity).
 *
 * Guests can BROWSE the lobby freely (same rule as /pricing): the tiles
 * render locked with "TAP TO TOP UP" and only playing/buying needs an
 * account. Do NOT auto-redirect guests to /login — the old gate bounced
 * every logged-out visitor, so the games "didn't show" at all.
 */
function CasinoLobby() {
  const navigate = useNavigate();
  const token = typeof window !== "undefined" ? userToken.get() : null;

  // Engines come from the client API (same call /engines uses) with the
  // static fallback rendering instantly. The old route LOADER used
  // loaderFetch("/api/engines") — same-origin /api 404s on this split
  // deployment (API is a separate project), so the loader always
  // resolved to [] and the lobby showed 6 grey skeleton tiles forever:
  // the games literally never showed. Never load engines via the loader.
  const { data: games = ENGINES_FALLBACK } = useQuery({
    queryKey: ["engines"],
    queryFn: listEngines,
    placeholderData: ENGINES_FALLBACK,
    refetchInterval: 15000,
    retry: false,
  });

  const {
    data: me,
    isError: meError,
    isRefetchError: meRefetchError,
    error: meErrorObj,
    refetch: refetchMe,
  } = useQuery({
    queryKey: ["entitlement"],
    queryFn: () => api<AccountUser>("/api/games/entitlement", { token: token ?? null }),
    enabled: !!token,
    retry: false,
    refetchInterval: 30000,
  });

  // dead/expired token -> drop it and start over at login (never strand
  // the user on a lobby whose lock states can't load)
  useEffect(() => {
    const err = meErrorObj;
    if (err instanceof ApiError && err.status === 401) {
      userToken.clear();
      navigate({ to: "/login", search: { redirect: "/predictor" } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meErrorObj]);

  return (
    <>
      {!token && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
          <div className="flex flex-col gap-3 rounded-2xl border p-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
            <p className="text-sm font-medium">
              You are browsing as a guest — log in or create an account to play.
            </p>
            <div className="flex shrink-0 justify-center gap-2">
              <Link
                to="/login"
                search={{ redirect: "/predictor" }}
                className="bg-primary rounded-xl px-4 py-2.5 text-sm font-black text-white"
              >
                Log in
              </Link>
              <Link to="/register" className="rounded-xl border px-4 py-2.5 text-sm font-bold">
                Register
              </Link>
            </div>
          </div>
        </div>
      )}
      <CasinoLobbyView
        games={games as EngineGame[]}
        me={me}
        meError={meError}
        meRefetchError={meRefetchError}
        meErrorObj={meErrorObj}
        refetchMe={() => void refetchMe()}
      />
    </>
  );
}
