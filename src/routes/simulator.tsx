import { useEffect, useRef, useState } from "react";
import { Outlet, createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import {
  adminToken,
  loaderFetch,
  simEntitlement,
  simExpire,
  simStart,
  userToken,
  type AccountUser,
  type EngineGame,
  type SimRun,
} from "@/lib/api";
import { CasinoLobbyView } from "@/components/predictor/casino-lobby";
import { MaterialIcon } from "@/components/ui/material-icon";

export const Route = createFileRoute("/simulator")({
  component: SimulatorPage,
});

// Session keys for the current run. The run is restored (not recreated)
// when the SA navigates between the lobby and a payment page, so a
// payment approval lands back on the same lobby state.
const RUN_KEY = "darkweb_sim_run_id";
const NOTICE_KEY = "darkweb_sim_notice";

function SimulatorPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [saToken, setSaToken] = useState<string | null>(null);
  const [run, setRun] = useState<SimRun | null>(null);
  const [games, setGames] = useState<EngineGame[]>([]);
  const [me, setMe] = useState<AccountUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Staff-only: superadmin session required, anything else is sent to
  // the superadmin login. A normal user token is NOT enough.
  useEffect(() => {
    const t = adminToken.get();
    if (!t || adminToken.role() !== "SUPER_ADMIN") {
      navigate({ to: "/superadmin/login" });
    } else {
      setSaToken(t);
    }
  }, [navigate]);

  useEffect(() => {
    loaderFetch<EngineGame[]>("/api/engines")
      .then(setGames)
      .catch(() => setGames([]));
  }, []);

  const refreshMe = async (r: SimRun, token: string) => {
    try {
      setMe(await simEntitlement(r.runId, token));
    } catch {
      /* keep the last good state */
    }
  };

  // Auto-start on mount: restore the existing run when the SA returns
  // from a payment page, otherwise create one silently. No start panel,
  // no start button — landing here IS the lobby.
  useEffect(() => {
    if (!saToken || startedRef.current) return;
    startedRef.current = true;
    const savedRunId = window.sessionStorage.getItem(RUN_KEY);
    const savedToken = userToken.get();
    const restore = async () => {
      if (savedRunId && savedToken?.startsWith("simtok_")) {
        const r: SimRun = { runId: savedRunId, simIdentity: "", simToken: savedToken, expiresAt: "" };
        setRun(r);
        await refreshMe(r, saToken);
        return;
      }
      try {
        const r = await simStart(saToken);
        setRun(r);
        userToken.set(r.simToken);
        window.sessionStorage.setItem(RUN_KEY, r.runId);
        await refreshMe(r, saToken);
      } catch {
        setError("Could not start. Please try again.");
      }
    };
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saToken]);

  // Returning from a payment page: the parent route stays mounted
  // across child navigation, so mount effects do not re-run — refresh
  // entitlement and surface the payment page's one-time notice here.
  useEffect(() => {
    if (pathname !== "/simulator" || !run || !saToken) return;
    // Refresh FIRST, then show the notice — so the tile and the notice
    // never disagree (a notice claiming an active window above a tile
    // that still shows locked).
    const update = async () => {
      await refreshMe(run, saToken);
      const n = window.sessionStorage.getItem(NOTICE_KEY);
      if (n) {
        setNotice(n);
        window.sessionStorage.removeItem(NOTICE_KEY);
      }
    };
    void update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Re-poll entitlement so an expired window re-locks the tile without
  // the SA having to act.
  useEffect(() => {
    if (!run || !saToken) return;
    const t = setInterval(() => void refreshMe(run, saToken), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, saToken]);

  const end = async () => {
    if (run && saToken) {
      try {
        await simExpire(run.runId, saToken);
      } catch {
        /* run expiry is best-effort; the token is cleared regardless */
      }
    }
    userToken.clear();
    window.sessionStorage.removeItem(RUN_KEY);
    window.sessionStorage.removeItem(NOTICE_KEY);
    navigate({ to: "/superadmin" });
  };

  if (!saToken) return null;

  // The payment page is a child route of this page: when the URL points
  // at it, render only the child — otherwise the lobby would render
  // underneath the payment form.
  if (pathname !== "/simulator") return <Outlet />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-5 md:px-6">
        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}
        <div className="rounded-2xl border border-secondary/30 bg-secondary-soft px-4 py-3 text-sm font-bold text-secondary">
          SIMULATION — practice play only. No real money, no real credits.
        </div>
        {notice && (
          <div className="rounded-2xl border border-secondary/30 bg-secondary-soft px-4 py-3 text-sm font-semibold text-secondary">
            {notice}
          </div>
        )}

        {!run ? (
          <div className="grid place-items-center py-20">
            <MaterialIcon name="progress_activity" className="animate-spin text-[28px] text-muted-foreground" />
          </div>
        ) : (
          <CasinoLobbyView
            games={games}
            me={me}
            meError={false}
            meRefetchError={false}
            meErrorObj={null}
            refetchMe={() => void refreshMe(run, saToken)}
            simMode
            onLockedGame={(gameId) => {
              navigate({ to: "/simulator/payment", search: { game: gameId } });
            }}
          />
        )}
      </div>
    </div>
  );
}
