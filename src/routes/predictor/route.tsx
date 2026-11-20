import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  FlaskConical,
  History,
  Settings,
  Plane,
  Rocket,
  Goal,
  Zap,
  Sparkles,
  Gem,
  Wine,
  ScanSearch,
  Trophy,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, userToken, type AccountUser } from "@/lib/api";

export const Route = createFileRoute("/predictor")({
  component: PredictorLayout,
});

const GAME_NAV = [
  { id: "sporty-jet", name: "Sporty Jet", icon: Rocket },
  { id: "aviator", name: "Aviator", icon: Plane },
  { id: "sportykick", name: "SportyKick", icon: Goal },
  { id: "sportyhero", name: "SportyHero", icon: Zap },
  { id: "super-hero", name: "Super Hero", icon: Sparkles },
  { id: "test-flight", name: "Test Flight", icon: FlaskConical },
];

// pass-only predictors — their own group, apart from the main games
const EXTRA_NAV = [
  { id: "mines", name: "Mines", icon: Gem },
  { id: "bottle", name: "Spin da Bottle", icon: Wine },
];

const ALL_GAMES = [...GAME_NAV, ...EXTRA_NAV];

const TOOL_NAV = [
  { to: "/scan", name: "Slip Scan", icon: ScanSearch },
  { to: "/virtuals", name: "Instant Virtuals", icon: Trophy },
  { to: "/predictor/simulate", name: "Simulation Lab", icon: FlaskConical },
  { to: "/predictor/history", name: "Prediction History", icon: History },
  { to: "/predictor/settings", name: "Settings", icon: Settings },
];

function RailWallet() {
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
      className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/30 bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary"
    >
      <Wallet className="size-3.5" />
      <span className="font-mono tabular-nums">{balance} credits</span>
      <span className="hidden font-semibold underline underline-offset-2 sm:inline">Top up</span>
    </Link>
  );
}

function PredictorLayout() {
  const [now, setNow] = useState("");
  const location = useLocation();
  const path = location.pathname;

  useEffect(() => {
    setNow(
      new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    );
  }, []);

  const isGameActive = (id: string) => path === `/predictor/${id}`;
  const isToolActive = (to: string) => path === to || path.startsWith(to + "/");
  const isOverview = path === "/predictor";

  const activeGame = ALL_GAMES.find((g) => isGameActive(g.id));

  // Immersive pages: no rail, no top bar — the page owns the screen.
  // (video game pages + the casino-style games lobby)
  const VIDEO_GAMES = ["aviator", "sporty-jet", "sportyhero"];
  const isImmersive = VIDEO_GAMES.some((id) => isGameActive(id)) || isOverview;
  if (isImmersive) {
    return (
      <div className="min-h-screen bg-background text-foreground [font-feature-settings:'tnum']">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground [font-feature-settings:'tnum']">
      {/* -------- top game rail (replaces the old left sidebar) -------- */}
      <div className="sticky top-16 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2.5 md:px-6">
          <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <RailChip to="/predictor" label="Overview" icon={LayoutDashboard} active={isOverview} />
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
            {GAME_NAV.map((g) => (
              <RailChip
                key={g.id}
                to={`/predictor/${g.id}`}
                label={g.name}
                icon={g.icon}
                active={isGameActive(g.id)}
              />
            ))}
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
            {EXTRA_NAV.map((g) => (
              <RailChip
                key={g.id}
                to={`/predictor/${g.id}`}
                label={g.name}
                icon={g.icon}
                active={isGameActive(g.id)}
              />
            ))}
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
            {TOOL_NAV.map((t) => (
              <RailChip key={t.to} to={t.to} label={t.name} icon={t.icon} active={isToolActive(t.to)} />
            ))}
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-success uppercase lg:inline-flex">
            <span className="dw-live-dot size-1.5 rounded-full bg-success" />
            Live · Provably fair
          </span>
          <span className="hidden shrink-0 text-[11px] font-medium text-muted-foreground md:inline">
            {now || " "}
          </span>
          <RailWallet />
        </div>
      </div>

      {/* -------- main column -------- */}
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col">
        <main className="flex-1 px-4 py-5 pb-24 md:px-6 md:pb-8">
          {!isOverview && (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-black tracking-tight md:text-2xl">
                {activeGame ? activeGame.name : TOOL_NAV.find((t) => isToolActive(t.to))?.name ?? "Prediction desk"}
              </h1>
              <Link
                to="/engines"
                className="ml-auto hidden rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground sm:block"
              >
                Live engines
              </Link>
            </div>
          )}
          <Outlet />
        </main>

        {/* mobile bottom nav — white bar, terracotta active, raised Scan */}
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 backdrop-blur md:hidden">
          <div className="relative grid grid-cols-5">
            <BottomTab to="/predictor" icon={LayoutDashboard} label="Overview" active={isOverview} />
            <BottomTab to="/predictor/simulate" icon={FlaskConical} label="Sim Lab" active={isToolActive("/predictor/simulate")} />
            <Link
              to="/scan"
              aria-label="Scan a slip"
              className="relative flex flex-col items-center justify-start pt-0"
            >
              <span className="absolute -top-5 grid size-12 place-items-center rounded-full bg-primary text-white shadow-lift ring-4 ring-background">
                <ScanSearch className="size-5" />
              </span>
              <span className="pt-8 pb-2.5 text-[10px] font-bold text-primary">Scan</span>
            </Link>
            <BottomTab to="/predictor/history" icon={History} label="History" active={isToolActive("/predictor/history")} />
            <BottomTab to="/predictor/settings" icon={Settings} label="Settings" active={isToolActive("/predictor/settings")} />
          </div>
        </nav>
      </div>
    </div>
  );
}

function RailChip({ to, label, icon: Icon, active }: { to: string; label: string; icon: any; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition",
        active
          ? "border-primary bg-primary text-white"
          : "border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </Link>
  );
}

function BottomTab({ to, icon: Icon, label, active }: { to: string; icon: any; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="size-5" />
      {label}
    </Link>
  );
}
