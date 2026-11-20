import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import type { AccountUser, EngineGame } from "@/lib/api";
import { CREDIT_PACKS } from "@/lib/api";
import { Skeleton } from "@/components/predictor/terminal";
import { MaterialIcon } from "@/components/ui/material-icon";
import { cn } from "@/lib/utils";

// best artwork per game — real art where we have it
const ART: Record<string, string> = {
  aviator: "/games/aviator-art.webp",
};

const BADGE: Record<string, "HOT" | "NEW"> = {
  aviator: "HOT",
};

const CATS = ["All", "Crash"] as const;

// the only game we predict — Aviator (owner order 2026-11-20).
// Everything else stays out of the lobby.
const PREDICTED_GAMES = ["aviator"];

// pass-only predictors (ported from VirtuWin) — not engine-registry
// games, so their tiles are declared here with the same lock treatment
const EXTRA_GAMES: {
  id: string;
  name: string;
  art: string;
  badge: "HOT" | "NEW";
  to: "/predictor/mines" | "/predictor/bottle";
  artClassName?: string;
}[] = [
  {
    id: "mines",
    name: "Mines",
    art: "/games/mines.png",
    badge: "HOT",
    to: "/predictor/mines",
    // mines.png is 600×600 but the artwork itself only fills the top
    // 460px — the bottom 23% is transparent padding baked into the
    // file, which showed through as a black band under the art.
    // Render the img 130.5% tall (= 600/460) anchored to the top of
    // the media box so the artwork fills the box edge-to-edge and
    // the transparent strip falls below the fold. (The lettering
    // spans x 99–512 of 600, so it survives the centred crop whole.)
    artClassName: "absolute inset-x-0 top-0 h-[130.5%]",
  },
  { id: "bottle", name: "Spin da Bottle", art: "/games/spin-bottle.png", badge: "NEW", to: "/predictor/bottle" },
];

function catOf(g: EngineGame): string {
  const t = g.prediction?.type ?? "";
  if (t === "crash") return "Crash";
  if (t === "penalty") return "Penalty";
  if (t === "action") return "Action";
  return "Crash";
}

// Wallet label under an unlocked tile — one wallet, every game:
// "{balance} credits". (The old mm:ss countdown died with the
// 45-minute window model; credits never expire.)

// Instant Virtuals — the AI slip scan's front door, presented exactly
// the way dark web presents it: a poster tile in the games grid (1X2
// probability row) that opens the scan. The poster is the Virtual
// Football art (public/games/instant-virtuals.png), kept as-is. Same
// tile shell as every game, so the height matches too.
//
// Lock treatment: the scan page already enforces purchase-before-scan,
// and this tile is the lobby-side signal of that same gate — when the
// account holds no scan access it renders exactly like TileBody's locked
// state (grayscale + centered lock overlay + "Locked — tap to top up")
// and still links to /scan, where scan purchases are sold (the Buy tab
// is the scan page's own purchase flow, not /pricing). When scan access
// is active it renders exactly as before (LIVE badge, 1X2 row).
// In simMode the tile NEVER routes a sim identity into the real scan
// flow: locked or unlocked, it links to /simulator/scan (the simulated
// scan page — Buy tab when locked, scanner when access is active).
// Same lock look, same copy — only the destination is namespaced to
// the simulator. The sim payment page for the scan product still
// exists for direct navigation, it is just no longer linked here.
function InstantVirtualsTile({
  locked,
  simMode,
  onLockedGame,
}: {
  locked: boolean;
  simMode?: boolean;
  onLockedGame?: (gameId: string) => void;
}) {
  const showLocked = locked;
  const inner = (
    <>
      <div className="relative aspect-[1/1.02] shrink-0 overflow-hidden bg-muted">
        <img
          src="/games/instant-virtuals.png"
          alt="Instant Virtuals"
          loading="lazy"
          className={cn("absolute inset-0 h-full w-full object-cover", showLocked && "grayscale-[35%]")}
        />
        {showLocked && (
          <span className="absolute inset-0 z-10 grid place-items-center bg-[#FBF6EC]/70">
            <span className="grid size-12 place-items-center rounded-full border border-primary/30 bg-primary-soft">
              <MaterialIcon name="lock" filled className="text-[24px] text-primary" />
            </span>
          </span>
        )}
        {!showLocked && (
          <>
            <span className="absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-white/95 px-2.5 py-1 text-[10px] font-black tracking-wider text-success">
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              LIVE
            </span>
            <span className="absolute inset-x-0 bottom-0 z-10 flex divide-x divide-border border-t border-border bg-white/90 text-center backdrop-blur">
              {[
                ["1", "46%"],
                ["X", "27%"],
                ["2", "27%"],
              ].map(([k, v]) => (
                <span key={k} className="flex-1 py-1.5">
                  <span className="block text-[9px] font-black uppercase tracking-wider text-muted-foreground">{k}</span>
                  <span className="block text-[11px] font-black text-success">{v}</span>
                </span>
              ))}
            </span>
          </>
        )}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-2 py-2.5 text-center">
        <p className="w-full truncate text-[13px] font-bold text-foreground">Instant Virtuals</p>
        {showLocked ? (
          <p className="mt-0.5 w-full truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Locked — tap to top up
          </p>
        ) : (
          <p className="mt-0.5 w-full truncate text-[10px] font-bold uppercase tracking-wider text-primary">
            AI slip scan — tap to predict
          </p>
        )}
      </div>
    </>
  );
  // Sim mode: the tile follows the user journey — tap always goes to the
  // sim scan page (Buy tab when locked, scanner when access is active),
  // never to the per-game payment page.
  if (simMode) {
    return (
      <Link to="/simulator/scan" className={TILE_CLS}>
        {inner}
      </Link>
    );
  }
  return (
    <Link to="/scan" className={TILE_CLS}>
      {inner}
    </Link>
  );
}

// one tile shell for EVERY game (engines + virtual predictors) — fixed
// media box + flex body inside a full-height flex column, so all tiles
// in the lobby come out exactly the same length
const TILE_CLS =
    "group relative flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-border transition duration-200 hover:-translate-y-1 hover:shadow-lift hover:ring-primary/40";

function TileBody({
  art,
  name,
  badge,
  locked,
  planLeft,
  urgent,
  expired,
  artClassName,
}: {
  art: string;
  name: string;
  badge?: "HOT" | "NEW" | undefined;
  locked: boolean;
  planLeft: string | null;
  urgent?: boolean;
  expired?: boolean;
  artClassName?: string | undefined;
}) {
  return (
    <>
      <div className="relative aspect-[1/1.02] shrink-0 overflow-hidden bg-muted">
        <img
          src={art}
          alt={name}
          loading="lazy"
          className={cn(
            "h-full w-full object-cover transition duration-300 group-hover:scale-105",
            locked && "grayscale-[35%]",
            artClassName,
          )}
        />
        {locked && (
          <span className="absolute inset-0 z-10 grid place-items-center bg-[#FBF6EC]/70">
            <span className="grid size-12 place-items-center rounded-full border border-primary/30 bg-primary-soft">
              <MaterialIcon name="lock" filled className="text-[24px] text-primary" />
            </span>
          </span>
        )}
        {badge && (
          <span
            className={cn(
              "absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-white/95 px-2.5 py-1 text-[10px] font-black tracking-wider text-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", badge === "HOT" ? "bg-primary" : "bg-secondary")} />
            {badge}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-2 py-2.5 text-center">
        <p className="w-full truncate text-[13px] font-bold text-foreground">{name}</p>
        {planLeft ? (
          <p
            className={cn(
              "mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] font-bold tabular-nums tracking-wider",
              urgent ? "text-destructive" : "text-primary",
            )}
          >
            <span
              className={cn(
                "size-1.5 animate-pulse rounded-full",
                urgent ? "bg-destructive" : "bg-primary",
              )}
            />
            {planLeft}
          </p>
        ) : expired ? (
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
            Expired — tap to renew
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Locked — tap to top up
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Games lobby — market-stall cards on cream paper: segmented filters,
 * search, artwork tiles, wallet-first header. Only the games we predict.
 */
/**
 * Games lobby view — the SAME tiles, art, locks and wallet balance users
 * see. Extracted from the /predictor route so the superadmin simulator
 * can render the identical lobby for a simulated identity: pass `me`
 * (sim entitlement) + simMode, and locked tiles call onLockedGame
 * instead of sending the admin to the real pricing page.
 */
export function CasinoLobbyView({
  games,
  me,
  meError,
  meRefetchError,
  meErrorObj,
  refetchMe,
  simMode,
  onLockedGame,
}: {
  games: EngineGame[];
  me: AccountUser | null | undefined;
  meError: boolean;
  meRefetchError: boolean;
  meErrorObj: unknown;
  refetchMe: () => void;
  simMode?: boolean;
  onLockedGame?: (gameId: string) => void;
}) {
  const [q, setQ] = useState("");

  const passesFailed = meError || meRefetchError;

  const filtered = (games as EngineGame[])
    .filter((g: EngineGame) => PREDICTED_GAMES.includes(g.id))
    .filter((g: EngineGame) => g.name.toLowerCase().includes(q.trim().toLowerCase()));

  const planFor = (gameId: string) => me?.plans[gameId];

  // CREDIT WALLET (2026-11-06): one wallet for every game + scan.
  // Unlocked tiles show the balance; locked tiles link to /pricing.
  const creditsBalance = me?.credits?.balance ?? null;
  const walletLabel = creditsBalance == null ? null : `${creditsBalance} credits`;
  const walletUrgent = creditsBalance !== null && creditsBalance <= 5;
  const isExpired = (gameId: string) => me?.games?.[gameId]?.state === "expired";

  const showScan = "slip scan ai instant virtuals".includes(q.trim().toLowerCase());
  const extraVisible = EXTRA_GAMES.filter((g) =>
    g.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-black tracking-tight md:text-2xl">
            Games <span className="text-muted-foreground">·</span>{" "}
            <span className="text-base font-bold text-muted-foreground">Crash calls</span>
          </h1>
          {creditsBalance != null && (
            <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-soft px-3 py-1.5 text-[11px] font-bold text-primary">
              <MaterialIcon name="account_balance_wallet" className="text-[14px]" />
              <span className="font-mono tabular-nums">{creditsBalance} credits · 4 per play</span>
              <Link to="/pricing" className="text-primary underline underline-offset-2">
                Top up
              </Link>
            </span>
          )}
        </div>

        {/* Top-up strip — the four credit tiers, on the lobby itself so
            nobody has to visit /pricing just to see the prices. Each tier
            links straight to its /pricing picker. Hidden in sim mode:
            the simulator lobby never sells real credits. */}
        {!simMode && (
          <div className="card-surface overflow-hidden">
            <div className="kente-strip h-[6px] w-full" aria-hidden />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
              <div className="min-w-[140px]">
                <p className="text-sm font-black tracking-tight">Top up credits</p>
                <p className="text-xs text-muted-foreground">
                  4 credits per play · never expires · top-ups stack
                </p>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                {CREDIT_PACKS.map((tier) => (
                  <Link
                    key={tier.code}
                    to="/pricing"
                    search={{ plan: tier.code }}
                    className="rounded-xl border border-border bg-background px-3 py-2.5 text-left transition hover:border-primary/50 hover:bg-primary-soft/40"
                  >
                    <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                      {tier.code}
                    </p>
                    <p className="mt-0.5 font-mono text-base font-bold tabular-nums">
                      {tier.credits} credits
                    </p>
                    <p className="text-xs font-bold text-primary">
                      GH₵{tier.priceGhs.toLocaleString()}
                      <span className="font-medium text-muted-foreground">
                        {" "}
                        {tier.priceNgn != null ? `· ₦${tier.priceNgn.toLocaleString()}` : "· NGN to be set"}
                      </span>
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* search */}
        <div className="flex items-center gap-2">
          <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-full border border-primary/20 bg-card px-4 py-2 transition focus-within:border-primary/60 sm:max-w-xs">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search for your favourite game"
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </label>
        </div>

        {passesFailed && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-semibold text-destructive">
              Couldn't load your credits
              {meErrorObj ? `: ${meErrorObj instanceof Error ? meErrorObj.message : "error"}` : ""}{" "}
              — the lock states below may be out of date.
            </p>
            <button
              onClick={() => refetchMe()}
              className="shrink-0 rounded-full bg-destructive px-4 py-1.5 text-xs font-bold text-white"
            >
              Retry
            </button>
          </div>
        )}

        {/* game tiles */}
        {games.length === 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[1/1.15] bg-muted" />
            ))}
          </div>
        ) : filtered.length === 0 && !showScan ? (
          <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No games match “{q}”.
          </p>
        ) : (
          <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {showScan && (
              <InstantVirtualsTile locked={!me?.scanAccess} simMode={simMode} onLockedGame={onLockedGame} />
            )}
            {filtered.map((g: EngineGame) => {
              const plan = planFor(g.id);
              const locked = !plan;
              const body = (
                <TileBody
                  art={ART[g.id] ?? g.image}
                  name={g.name}
                  badge={BADGE[g.id]}
                  locked={locked}
                  planLeft={locked ? null : walletLabel}
                  urgent={walletUrgent}
                  expired={isExpired(g.id)}
                />
              );
              return locked ? (
                simMode && onLockedGame ? (
                  <button key={g.id} type="button" onClick={() => onLockedGame(g.id)} className={cn(TILE_CLS, "text-left")}>
                    {body}
                  </button>
                ) : (
                  <Link key={g.id} to="/pricing" search={{ game: g.id }} className={TILE_CLS}>
                    {body}
                  </Link>
                )
              ) : (
                <Link
                  key={g.id}
                  to="/predictor/$gameId"
                  params={{ gameId: g.id }}
                  className={TILE_CLS}
                >
                  {body}
                </Link>
              );
            })}
          </div>
        )}

        {/* Extra Predictors — pass-only games (Mines + Spin da Bottle),
            grouped under their own heading apart from the main games */}
        {extraVisible.length > 0 && (
          <>
            <h2 className="pt-2 text-lg font-black tracking-tight text-secondary md:text-xl">
              Extra Predictors <span className="text-muted-foreground">·</span>{" "}
              <span className="text-base font-bold text-muted-foreground">Mines &amp; bottle</span>
            </h2>
            <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {extraVisible.map((g) => {
                const plan = planFor(g.id);
                const locked = !plan;
                const body = (
                  <TileBody
                    art={g.art}
                    name={g.name}
                    badge={g.badge}
                    locked={locked}
                    planLeft={locked ? null : walletLabel}
                    urgent={walletUrgent}
                    expired={isExpired(g.id)}
                    artClassName={g.artClassName}
                  />
                );
                return locked ? (
                  simMode && onLockedGame ? (
                    <button key={g.id} type="button" onClick={() => onLockedGame(g.id)} className={cn(TILE_CLS, "text-left")}>
                      {body}
                    </button>
                  ) : (
                    <Link key={g.id} to="/pricing" search={{ game: g.id }} className={TILE_CLS}>
                      {body}
                    </Link>
                  )
                ) : (
                  <Link key={g.id} to={g.to} className={TILE_CLS}>
                    {body}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
