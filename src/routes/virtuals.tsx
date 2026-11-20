import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ApiError } from "@/lib/api";
import {
  currentToken,
  getBalance,
  getMyBets,
  getResults,
  getRound,
  getTable,
  initials,
  placeBet,
  selectionLabel,
  type VirtualBet,
  type VirtualMarket,
  type VirtualMatch,
  type VirtualRound,
} from "@/lib/virtuals-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/virtuals")({
  head: () => ({
    meta: [
      { title: "Instant Virtuals — SignalVault" },
      {
        name: "description",
        content:
          "Virtual football every 3 minutes — Gold Coast Premier, Volta League and Ashanti League. Pick 1X2, Over/Under 2.5, Double Chance, Both Teams To Score or Correct Score, stake credits, results settle instantly.",
      },
      { property: "og:title", content: "Instant Virtuals — SignalVault" },
    ],
  }),
  component: VirtualsPage,
});

type Pick = {
  matchId: string;
  leagueName: string;
  home: string;
  away: string;
  market: VirtualMarket;
  selection: string;
  odds: number;
  stake: number;
};

type Tab = "matches" | "table" | "results";

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function OddsButton({
  label,
  odds,
  active,
  disabled,
  onClick,
}: {
  label: string;
  odds: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-14 flex-col items-center rounded-lg border px-2 py-1.5 transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-muted/60 text-foreground hover:border-primary/50 hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="text-[10px] font-bold tracking-wider uppercase opacity-70">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{odds.toFixed(2)}</span>
    </button>
  );
}

const MARKET_TABS: { key: VirtualMarket; label: string }[] = [
  { key: "1X2", label: "1X2" },
  { key: "OU25", label: "Over/Under" },
  { key: "DC", label: "Double Chance" },
  { key: "BTTS", label: "Both Score" },
  { key: "CS", label: "Correct Score" },
];

function TeamChip({ name }: { name: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 font-display text-[11px] font-bold text-primary ring-1 ring-primary/30">
      {initials(name)}
    </span>
  );
}

/** Deterministic ball position for a match at a given minute — same for
 *  every viewer (derived from the match id, no server art, no video).
 *  The ball wanders the pitch as the minute advances; on a goal minute it
 *  sits in the net that was scored on. Pure CSS/SVG, original art. */
function ballPos(matchId: string, minute: number): { x: number; y: number } {
  let h = 7;
  for (const c of matchId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const t = Math.min(1, Math.max(0, minute / 90));
  const x = 50 + 38 * Math.sin(t * Math.PI * 2.7 + (h % 7));
  const y = 50 + 30 * Math.sin(t * Math.PI * 4.3 + (h % 11));
  return { x: Math.min(94, Math.max(6, x)), y: Math.min(92, Math.max(8, y)) };
}

/**
 * Live match centre — the featured match playing on an animated pitch,
 * SportyBet-virtuals style (live minute, live score, goal flashes), built
 * from our own seeded events. No video, no copied art: a CSS pitch, a
 * ball dot, and the goal events the generator already committed.
 */
function LiveMatchCentre({ match, minute }: { match: VirtualMatch; minute: number }) {
  const homeGoals = match.liveHomeGoals ?? 0;
  const awayGoals = match.liveAwayGoals ?? 0;
  const totalGoals = homeGoals + awayGoals;
  const [flash, setFlash] = useState<string | null>(null);
  const prevGoals = useRef(totalGoals);
  useEffect(() => {
    if (totalGoals > prevGoals.current) {
      const last = (match.events ?? []).filter((e) => e.minute <= minute).slice(-1)[0];
      setFlash(last ? (last.team === "home" ? match.home : match.away) : "GOAL");
      const t = window.setTimeout(() => setFlash(null), 3000);
      prevGoals.current = totalGoals;
      return () => window.clearTimeout(t);
    }
    prevGoals.current = totalGoals;
  }, [totalGoals, match, minute]);
  const ball = ballPos(match.id, minute);
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-3">
        <p className="text-sm font-bold">
          <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-destructive" />
          LIVE · {minute}&prime; — Featured match
        </p>
        <p className="font-mono text-sm font-bold tabular-nums">
          {match.home} <span className="text-primary">{homeGoals} – {awayGoals}</span> {match.away}
        </p>
      </div>
      {/* Pitch */}
      {/* Pitch — light: pale teal turf on cream, teal chalk lines, ink ball.
          Same animated pitch + GOAL flash as the source, re-coloured to the
          light Kente tokens (no dark green, no black overlay). */}
      <div className="relative h-44 w-full overflow-hidden bg-gradient-to-b from-[#D9EEE5] via-[#C4E6D8] to-[#D9EEE5] sm:h-52">
        {/* stripes */}
        <div className="absolute inset-0 opacity-60 [background:repeating-linear-gradient(90deg,transparent_0,transparent_12.5%,#fff_12.5%,#fff_25%)]" />
        {/* lines */}
        <div className="absolute inset-3 rounded-sm border border-[#0F766E]/45" />
        <div className="absolute top-1/2 left-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#0F766E]/45" />
        <div className="absolute top-1/2 left-3 h-20 w-8 -translate-y-1/2 border border-[#0F766E]/45 border-l-0" />
        <div className="absolute top-1/2 right-3 h-20 w-8 -translate-y-1/2 border border-[#0F766E]/45 border-r-0" />
        {/* ball */}
        <div
          className="absolute size-3.5 rounded-full bg-[#1C1917] shadow-[0_2px_6px_rgba(28,25,23,0.45)] ring-2 ring-white transition-all duration-1000 ease-linear"
          style={{ left: `${ball.x}%`, top: `${ball.y}%`, transform: "translate(-50%, -50%)" }}
        />
        {/* goal flash */}
        {flash && (
          <div className="absolute inset-0 grid place-items-center bg-[#FBF6EC]/85">
            <div className="text-center">
              <p className="font-display text-4xl font-black tracking-wide text-primary">
                GOAL!
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">{flash}</p>
            </div>
          </div>
        )}
        <span className="absolute top-2 left-3 rounded bg-white/90 px-2 py-0.5 font-mono text-[11px] font-bold text-foreground ring-1 ring-border">
          {minute}&prime;
        </span>
        <span className="absolute top-2 right-3 rounded bg-white/90 px-2 py-0.5 font-mono text-[11px] font-bold text-foreground ring-1 ring-border">
          {homeGoals} – {awayGoals}
        </span>
      </div>
      {/* goal events */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
        {(match.events ?? []).filter((e) => e.minute <= minute).length === 0 ? (
          <span className="text-muted-foreground">No goals yet — the ball is moving.</span>
        ) : (
          (match.events ?? [])
            .filter((e) => e.minute <= minute)
            .map((e, i) => (
              <span key={i} className="rounded-full bg-primary/15 px-2.5 py-1 font-bold text-primary">
                {e.minute}&prime; · {e.team === "home" ? match.home : match.away}
              </span>
            ))
        )}
      </div>
    </div>
  );
}

function VirtualsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const token = currentToken();
  const [tab, setTab] = useState<Tab>("matches");
  const [marketTab, setMarketTab] = useState<VirtualMarket>("1X2");
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [showFull, setShowFull] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Local clock so countdowns tick between polls.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);

  const {
    data: round,
    error: roundError,
  } = useQuery<VirtualRound>({
    queryKey: ["virtuals-round", showFull],
    queryFn: () => getRound(showFull),
    refetchInterval: (q) => (q.state.data?.phase === "live" ? 1000 : 2000),
    retry: false,
  });

  // A new round resets the full-results view.
  useEffect(() => {
    setShowFull(false);
  }, [round?.roundId]);

  const { data: balance } = useQuery({
    queryKey: ["virtuals-balance"],
    queryFn: () => getBalance(token),
    enabled: !!token,
    retry: false,
  });

  const { data: myBets = [] } = useQuery<VirtualBet[]>({
    queryKey: ["virtuals-bets"],
    queryFn: () => getMyBets(token),
    enabled: !!token,
    refetchInterval: 5000,
    retry: false,
  });

  const { data: tableData } = useQuery({
    queryKey: ["virtuals-table"],
    queryFn: getTable,
    enabled: tab === "table",
    retry: false,
  });

  const { data: resultsData } = useQuery({
    queryKey: ["virtuals-results"],
    queryFn: getResults,
    enabled: tab === "results",
    retry: false,
  });

  const picksList = useMemo(() => Object.values(picks), [picks]);
  const totalStake = picksList.reduce((s, p) => s + p.stake, 0);

  const togglePick = (match: VirtualMatch, leagueName: string, market: VirtualMarket, selection: string, odds: number) => {
    setPicks((prev) => {
      const next = { ...prev };
      const existing = next[match.id];
      if (existing && existing.market === market && existing.selection === selection) {
        delete next[match.id];
      } else {
        next[match.id] = {
          matchId: match.id,
          leagueName,
          home: match.home,
          away: match.away,
          market,
          selection,
          odds,
          stake: existing?.stake ?? 5,
        };
      }
      return next;
    });
  };

  const setStake = (matchId: string, stake: number) => {
    setPicks((prev) => {
      const p = prev[matchId];
      if (!p) return prev;
      return { ...prev, [matchId]: { ...p, stake: Math.max(1, Math.floor(stake) || 1) } };
    });
  };

  const placeAll = async () => {
    if (!token) {
      navigate({ to: "/login", search: { redirect: "/virtuals" } });
      return;
    }
    if (!round || picksList.length === 0) return;
    if (picksList.some((p) => p.stake < 5)) {
      setNotice({ kind: "err", text: "Minimum stake is 5 credits per bet." });
      return;
    }
    setPlacing(true);
    setNotice(null);
    let placed = 0;
    let lastBalance: number | null = null;
    let lastErr = "";
    for (const p of picksList) {
      try {
        const bet = await placeBet(token, {
          roundId: round.roundId,
          matchId: p.matchId,
          market: p.market,
          selection: p.selection,
          stake: p.stake,
        });
        placed += 1;
        lastBalance = bet.balance;
      } catch (err) {
        lastErr = err instanceof ApiError ? err.message : "Bet failed";
      }
    }
    setPlacing(false);
    if (placed > 0) {
      setPicks({});
      setNotice({
        kind: "ok",
        text:
          placed === picksList.length
            ? `${placed} bet${placed > 1 ? "s" : ""} placed. Balance: ${lastBalance ?? "?"} credits.`
            : `${placed} bet${placed > 1 ? "s" : ""} placed — ${lastErr}`,
      });
      void qc.invalidateQueries({ queryKey: ["virtuals-balance"] });
      void qc.invalidateQueries({ queryKey: ["virtuals-bets"] });
    } else {
      setNotice({ kind: "err", text: lastErr || "No bets placed." });
    }
  };

  const isLive = round?.phase === "live";
  const countdownTarget = round
    ? isLive
      ? round.feedEndsAt
      : round.bettingEndsAt
    : 0;
  const countdownMs = Math.max(0, countdownTarget - now);

  // Live feed: all goal events so far, newest first.
  const liveEvents = useMemo(() => {
    if (!round || !isLive) return [];
    const out: { minute: number; home: string; away: string; team: "home" | "away"; league: string }[] = [];
    for (const league of round.leagues) {
      for (const m of league.matches) {
        for (const e of m.events ?? []) {
          out.push({ minute: e.minute, home: m.home, away: m.away, team: e.team, league: league.name });
        }
      }
    }
    return out.sort((a, b) => b.minute - a.minute || a.home.localeCompare(b.home));
  }, [round, isLive]);

  const currentRoundBets = myBets.filter((b) => round && b.roundId === round.roundId);

  // Featured match for the live match centre: first match of the first
  // league — deterministic, the same for every viewer.
  const featured = round?.leagues[0]?.matches[0] ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-semibold tracking-[0.25em] text-primary uppercase">
            Instant Virtuals
          </p>
          <h1 className="font-display mt-1 text-3xl font-extrabold sm:text-4xl">
            Virtual football, every 3 minutes
          </h1>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm">
            Gold Coast Premier, Volta League and Ashanti League — fictional clubs, real
            seeded rounds. Pick 1X2, Over/Under 2.5, Double Chance, Both Teams To Score
            or Correct Score, stake credits, results settle the moment the whistle blows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {token && balance !== undefined && (
            <span className="rounded-lg border border-primary/30 bg-card px-3 py-2 font-mono text-sm font-bold tabular-nums">
              <span className="text-muted-foreground mr-1.5 text-xs font-medium">Balance</span>
              {balance.balance} <span className="text-primary text-xs">credits</span>
            </span>
          )}
          {round && (
            <span
              className={cn(
                "rounded-lg px-3 py-2 font-mono text-sm font-bold tabular-nums",
                isLive ? "bg-destructive/15 text-destructive ring-1 ring-destructive/30" : "bg-primary/15 text-primary ring-1 ring-primary/30",
              )}
            >
              {isLive ? (
                <>
                  <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-destructive" />
                  {round.minute}&prime; · {fmtCountdown(countdownMs)}
                </>
              ) : (
                <>Betting closes in {fmtCountdown(countdownMs)}</>
              )}
            </span>
          )}
        </div>
      </div>

      {roundError && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load the current round. Check your connection and refresh.
        </p>
      )}

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b">
        {(
          [
            ["matches", "Matches"],
            ["table", "Table"],
            ["results", "Results"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        <span className="text-muted-foreground ml-auto hidden items-center font-mono text-xs sm:flex">
          {round ? `Round #${round.roundId}` : ""}
        </span>
      </div>

      {tab === "matches" && !round && !roundError && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading this round&apos;s matches…
          </div>
          <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0 space-y-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-2xl border p-4">
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <div className="mt-4 space-y-3">
                    {[0, 1, 2].map((j) => (
                      <div key={j} className="flex items-center justify-between gap-3">
                        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                        <div className="flex gap-2">
                          <div className="h-8 w-12 animate-pulse rounded-lg bg-muted" />
                          <div className="h-8 w-12 animate-pulse rounded-lg bg-muted" />
                          <div className="h-8 w-12 animate-pulse rounded-lg bg-muted" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden min-w-0 rounded-2xl border p-4 lg:block">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="mt-4 h-24 animate-pulse rounded-xl bg-muted" />
            </div>
          </div>
        </div>
      )}

      {tab === "matches" && round && (
        // min-w-0 on both children: without it the single-column grid
        // track stretches to the bet slip's min-content (~391px) and the
        // whole page runs 17px wider than a 390px phone — odds buttons
        // cut off at the right edge.
        <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">
            {/* Market tabs — SportyBet-style: one tap switches every match
                on the board between 1X2, Over/Under, Double Chance, Both
                Teams To Score and Correct Score. */}
            <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Markets">
              {MARKET_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={marketTab === t.key}
                  onClick={() => setMarketTab(t.key)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors",
                    marketTab === t.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {isLive && featured && (
              <LiveMatchCentre match={featured} minute={round.minute} />
            )}
            {isLive && (
              <div className="rounded-xl border border-destructive/30 bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">
                    <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-destructive" />
                    Live now — {round.minute}&prime;
                  </p>
                  {!showFull && (
                    <button
                      type="button"
                      onClick={() => setShowFull(true)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                    >
                      Skip to results
                    </button>
                  )}
                </div>
                {liveEvents.length === 0 ? (
                  <p className="text-muted-foreground mt-3 text-sm">No goals yet — the feed is running.</p>
                ) : (
                  <ul className="mt-3 space-y-1.5">
                    {liveEvents.slice(0, 8).map((e, i) => (
                      <li key={`${e.minute}-${e.home}-${i}`} className="flex items-center gap-2 text-sm">
                        <span className="w-10 shrink-0 font-mono font-bold text-primary tabular-nums">
                          {e.minute}&prime;
                        </span>
                        <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-bold text-success">
                          GOAL
                        </span>
                        <span className="truncate">
                          {e.team === "home" ? e.home : e.away}
                          <span className="text-muted-foreground"> vs {e.team === "home" ? e.away : e.home}</span>
                        </span>
                        <span className="text-muted-foreground ml-auto shrink-0 text-xs">{e.league}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {round.leagues.map((league) => (
              <section key={league.id} className="overflow-hidden rounded-xl border bg-card">
                <header className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
                  <h2 className="font-display text-sm font-bold tracking-wide">{league.name}</h2>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {isLive ? `LIVE ${round.minute}′` : "BETTING OPEN"}
                  </span>
                </header>
                <ul className="divide-y">
                  {league.matches.map((m) => {
                    const score =
                      isLive && m.liveHomeGoals !== undefined
                        ? `${m.liveHomeGoals} – ${m.liveAwayGoals}`
                        : showFull && m.finalHomeGoals !== undefined
                          ? `${m.finalHomeGoals} – ${m.finalAwayGoals}`
                          : null;
                    return (
                      <li key={m.id} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-center gap-2.5">
                              <TeamChip name={m.home} />
                              <span className="truncate text-sm font-semibold">{m.home}</span>
                              {score && (
                                <span className="ml-auto font-mono text-sm font-bold tabular-nums">{score}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5">
                              <TeamChip name={m.away} />
                              <span className="truncate text-sm font-semibold">{m.away}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            {marketTab === "1X2" && (
                              <div className="flex gap-1.5">
                                <OddsButton label="1" odds={m.odds.home} active={picks[m.id]?.market === "1X2" && picks[m.id]?.selection === "H"} disabled={isLive} onClick={() => togglePick(m, league.name, "1X2", "H", m.odds.home)} />
                                <OddsButton label="X" odds={m.odds.draw} active={picks[m.id]?.market === "1X2" && picks[m.id]?.selection === "D"} disabled={isLive} onClick={() => togglePick(m, league.name, "1X2", "D", m.odds.draw)} />
                                <OddsButton label="2" odds={m.odds.away} active={picks[m.id]?.market === "1X2" && picks[m.id]?.selection === "A"} disabled={isLive} onClick={() => togglePick(m, league.name, "1X2", "A", m.odds.away)} />
                              </div>
                            )}
                            {marketTab === "OU25" && (
                              <div className="flex gap-1.5">
                                <OddsButton label="O 2.5" odds={m.odds.over25} active={picks[m.id]?.market === "OU25" && picks[m.id]?.selection === "OVER"} disabled={isLive} onClick={() => togglePick(m, league.name, "OU25", "OVER", m.odds.over25)} />
                                <OddsButton label="U 2.5" odds={m.odds.under25} active={picks[m.id]?.market === "OU25" && picks[m.id]?.selection === "UNDER"} disabled={isLive} onClick={() => togglePick(m, league.name, "OU25", "UNDER", m.odds.under25)} />
                              </div>
                            )}
                            {marketTab === "DC" && (
                              <div className="flex gap-1.5">
                                <OddsButton label="1X" odds={m.odds.dc1x} active={picks[m.id]?.market === "DC" && picks[m.id]?.selection === "1X"} disabled={isLive} onClick={() => togglePick(m, league.name, "DC", "1X", m.odds.dc1x)} />
                                <OddsButton label="12" odds={m.odds.dc12} active={picks[m.id]?.market === "DC" && picks[m.id]?.selection === "12"} disabled={isLive} onClick={() => togglePick(m, league.name, "DC", "12", m.odds.dc12)} />
                                <OddsButton label="X2" odds={m.odds.dcx2} active={picks[m.id]?.market === "DC" && picks[m.id]?.selection === "X2"} disabled={isLive} onClick={() => togglePick(m, league.name, "DC", "X2", m.odds.dcx2)} />
                              </div>
                            )}
                            {marketTab === "BTTS" && (
                              <div className="flex gap-1.5">
                                <OddsButton label="GG" odds={m.odds.gg} active={picks[m.id]?.market === "BTTS" && picks[m.id]?.selection === "GG"} disabled={isLive} onClick={() => togglePick(m, league.name, "BTTS", "GG", m.odds.gg)} />
                                <OddsButton label="NG" odds={m.odds.ng} active={picks[m.id]?.market === "BTTS" && picks[m.id]?.selection === "NG"} disabled={isLive} onClick={() => togglePick(m, league.name, "BTTS", "NG", m.odds.ng)} />
                              </div>
                            )}
                            {marketTab === "CS" && (
                              <div className="grid grid-cols-3 gap-1.5">
                                {(m.odds.cs ?? []).map((c) => (
                                  <OddsButton key={c.score} label={c.score} odds={c.odds} active={picks[m.id]?.market === "CS" && picks[m.id]?.selection === c.score} disabled={isLive} onClick={() => togglePick(m, league.name, "CS", c.score, c.odds)} />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              Provably-fair: every round is generated from SHA-256(server seed + round #).
              Seed commitment for this round: <span className="break-all text-foreground/80">{round.seedHash.slice(0, 32)}…</span>
              {" "}The full seed is revealed on the Results tab once the round settles.
            </p>
          </div>

          {/* Bet slip */}
          <aside className="h-fit min-w-0 rounded-xl border bg-card lg:sticky lg:top-20">
            <header className="border-b px-4 py-3">
              <h2 className="font-display text-sm font-bold tracking-wide">Bet slip</h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {isLive ? "Betting is closed for this round — next round opens soon." : "Min stake 5 credits per bet."}
              </p>
            </header>
            <div className="space-y-3 px-4 py-3">
              {picksList.length === 0 && (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  Tap any odds on a match to add it here.
                </p>
              )}
              {picksList.map((p) => (
                <div key={p.matchId} className="rounded-lg border bg-muted/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {p.home} vs {p.away}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {p.leagueName} · {selectionLabel(p.market, p.selection)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-bold text-primary tabular-nums">
                      {p.odds.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-muted-foreground text-xs font-medium" htmlFor={`stake-${p.matchId}`}>
                      Stake
                    </label>
                    <input
                      id={`stake-${p.matchId}`}
                      type="number"
                      min={5}
                      step={1}
                      value={p.stake}
                      disabled={isLive}
                      onChange={(e) => setStake(p.matchId, Number(e.target.value))}
                      className="w-20 rounded-lg border bg-background px-2 py-1.5 font-mono text-sm font-bold tabular-nums"
                    />
                    <span className="text-muted-foreground text-xs">credits</span>
                    <span className="ml-auto font-mono text-xs tabular-nums">
                      to win {(p.stake * p.odds).toFixed(0)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPicks((prev) => {
                          const next = { ...prev };
                          delete next[p.matchId];
                          return next;
                        })
                      }
                      className="text-muted-foreground text-xs font-semibold hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {picksList.length > 0 && (
              <footer className="border-t px-4 py-3">
                <div className="flex justify-between font-mono text-sm tabular-nums">
                  <span className="text-muted-foreground">Total stake</span>
                  <span className="font-bold">{totalStake} credits</span>
                </div>
                <button
                  type="button"
                  onClick={() => void placeAll()}
                  disabled={placing || isLive}
                  className="mt-3 w-full rounded-lg bg-primary py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {placing ? "Placing…" : token ? `Place ${picksList.length} bet${picksList.length > 1 ? "s" : ""}` : "Sign in to place bets"}
                </button>
                {!token && (
                  <p className="text-muted-foreground mt-2 text-center text-xs">
                    <Link to="/login" search={{ redirect: "/virtuals" }} className="font-semibold text-primary underline">
                      Sign in
                    </Link>{" "}
                    to bet — viewing the board is free.
                  </p>
                )}
              </footer>
            )}
            {notice && (
              <p
                className={cn(
                  "mx-4 mb-4 rounded-lg px-3 py-2 text-sm",
                  notice.kind === "ok" ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive",
                )}
              >
                {notice.text}
              </p>
            )}
            {token && currentRoundBets.length > 0 && (
              <div className="border-t px-4 py-3">
                <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Your bets this round</p>
                <ul className="mt-2 space-y-1.5">
                  {currentRoundBets.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">
                        {selectionLabel(b.market, b.selection)} @ {b.odds.toFixed(2)} · {b.stake} cr
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-2 py-0.5 font-mono text-[11px] font-bold",
                          b.status === "WON" && "bg-success/15 text-success",
                          b.status === "LOST" && "bg-destructive/10 text-destructive",
                          b.status === "PENDING" && "bg-primary/15 text-primary",
                        )}
                      >
                        {b.status === "WON" ? `WON +${b.payout}` : b.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === "table" && (
        <div className="mt-4 space-y-6">
          {tableData?.tables.map((t) => (
            <section key={t.id} className="overflow-hidden rounded-xl border bg-card">
              <header className="border-b bg-muted/50 px-4 py-3">
                <h2 className="font-display text-sm font-bold tracking-wide">{t.name}</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left font-mono text-[11px] tracking-wider uppercase">
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-2 py-2 font-medium">Team</th>
                      <th className="px-2 py-2 text-center font-medium">P</th>
                      <th className="px-2 py-2 text-center font-medium">W</th>
                      <th className="px-2 py-2 text-center font-medium">D</th>
                      <th className="px-2 py-2 text-center font-medium">L</th>
                      <th className="px-2 py-2 text-center font-medium">GF</th>
                      <th className="px-2 py-2 text-center font-medium">GA</th>
                      <th className="px-2 py-2 text-center font-medium">GD</th>
                      <th className="px-2 py-2 text-center font-medium">Pts</th>
                      <th className="px-4 py-2 text-center font-medium">Form</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r, i) => (
                      <tr key={r.team} className="border-b last:border-0">
                        <td className="px-4 py-2 font-mono text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-2 py-2 font-semibold">{r.team}</td>
                        <td className="px-2 py-2 text-center font-mono tabular-nums">{r.played}</td>
                        <td className="px-2 py-2 text-center font-mono tabular-nums">{r.won}</td>
                        <td className="px-2 py-2 text-center font-mono tabular-nums">{r.drawn}</td>
                        <td className="px-2 py-2 text-center font-mono tabular-nums">{r.lost}</td>
                        <td className="px-2 py-2 text-center font-mono tabular-nums">{r.gf}</td>
                        <td className="px-2 py-2 text-center font-mono tabular-nums">{r.ga}</td>
                        <td className="px-2 py-2 text-center font-mono tabular-nums">{r.gd}</td>
                        <td className="px-2 py-2 text-center font-mono font-bold text-primary tabular-nums">{r.points}</td>
                        <td className="px-4 py-2 text-center">
                          <span className="inline-flex gap-0.5">
                            {(r.form || "").split("").map((f, j) => (
                              <span
                                key={j}
                                className={cn(
                                  "grid size-5 place-items-center rounded text-[10px] font-black",
                                  f === "W" && "bg-success/15 text-success",
                                  f === "D" && "bg-warning/15 text-warning",
                                  f === "L" && "bg-destructive/15 text-destructive",
                                )}
                              >
                                {f}
                              </span>
                            ))}
                            {(r.form || "").length === 0 && <span className="text-muted-foreground">—</span>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {(!tableData || tableData.tables.every((t) => t.rows.every((r) => r.played === 0))) && (
            <p className="text-muted-foreground rounded-xl border bg-card px-4 py-6 text-center text-sm">
              No settled rounds yet — the table fills in after the first round finishes.
            </p>
          )}
        </div>
      )}

      {tab === "results" && (
        <div className="mt-4 space-y-6">
          {resultsData?.rounds.map((r) => (
            <section key={r.roundId} className="overflow-hidden rounded-xl border bg-card">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-3">
                <h2 className="font-display text-sm font-bold tracking-wide">Round #{r.roundId}</h2>
                <span className="font-mono text-[11px] break-all text-muted-foreground">
                  seed <span className="text-foreground/80">{r.seed}</span>
                </span>
              </header>
              {r.leagues.map((league) => (
                <div key={league.id} className="border-b last:border-0">
                  <p className="text-muted-foreground px-4 pt-3 text-xs font-bold tracking-wide uppercase">
                    {league.name}
                  </p>
                  <ul className="divide-y">
                    {league.matches.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {m.home} <span className="text-muted-foreground">vs</span> {m.away}
                        </span>
                        <span className="font-mono font-bold tabular-nums">
                          {m.homeGoals} – {m.awayGoals}
                        </span>
                        <span className="text-muted-foreground hidden font-mono text-xs sm:block">
                          {m.events.length > 0
                            ? m.events.map((e) => `${e.minute}′ ${e.team === "home" ? m.home : m.away}`).join(" · ")
                            : "No goals"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
          {(!resultsData || resultsData.rounds.length === 0) && (
            <p className="text-muted-foreground rounded-xl border bg-card px-4 py-6 text-center text-sm">
              No settled rounds yet — results appear here after the first round finishes.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
