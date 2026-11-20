// src/lib/virtuals-api.ts — typed helpers for Instant Virtuals.
// Kept separate from src/lib/api.ts (that file belongs to the pricing task).
import { api, userToken } from "./api";

export type VirtualOdds = {
  home: number;
  draw: number;
  away: number;
  over25: number;
  under25: number;
  dc1x: number;
  dc12: number;
  dcx2: number;
  gg: number;
  ng: number;
  cs: { score: string; odds: number }[];
};

export type VirtualMatchEvent = {
  minute: number;
  team: "home" | "away";
  type: "goal";
};

export type VirtualMatch = {
  id: string;
  leagueId: string;
  home: string;
  away: string;
  homeStrength: number;
  awayStrength: number;
  odds: VirtualOdds;
  minute?: number;
  liveHomeGoals?: number;
  liveAwayGoals?: number;
  finalHomeGoals?: number;
  finalAwayGoals?: number;
  events?: VirtualMatchEvent[];
  final?: boolean;
};

export type VirtualLeague = {
  id: string;
  name: string;
  matches: VirtualMatch[];
};

export type VirtualRound = {
  roundId: number;
  phase: "betting" | "live";
  roundStartAt: number;
  bettingEndsAt: number;
  feedEndsAt: number;
  countdownMs: number;
  minute: number;
  seedHash: string;
  leagues: VirtualLeague[];
};

export type VirtualResultMatch = {
  id: string;
  leagueId: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  odds: VirtualOdds;
  events: VirtualMatchEvent[];
};

export type VirtualResultRound = {
  roundId: number;
  seed: string;
  seedHash: string;
  leagues: { id: string; name: string; matches: VirtualResultMatch[] }[];
};

export type VirtualTableRow = {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  form: string;
};

export type VirtualTable = {
  id: string;
  name: string;
  rows: VirtualTableRow[];
};

export type VirtualMarket = "1X2" | "OU25" | "DC" | "BTTS" | "CS";

export type VirtualBet = {
  id: string;
  roundId: number;
  matchId: string;
  leagueId: string;
  market: VirtualMarket;
  selection: string;
  odds: number;
  stake: number;
  status: "PENDING" | "WON" | "LOST";
  payout: number;
  createdAt: string;
};

export type CreditBalance = {
  balance: number;
  costPerUse: number;
  packCredits: number;
  packPriceGhs: number;
  packPriceNgn: number;
};

export function getRound(full = false): Promise<VirtualRound> {
  return api<VirtualRound>(`/api/virtuals/round${full ? "?full=1" : ""}`);
}

export function getResults(): Promise<{ rounds: VirtualResultRound[] }> {
  return api<{ rounds: VirtualResultRound[] }>("/api/virtuals/results");
}

export function getTable(): Promise<{ tables: VirtualTable[] }> {
  return api<{ tables: VirtualTable[] }>("/api/virtuals/table");
}

export function getMyBets(token: string | null): Promise<VirtualBet[]> {
  return api<VirtualBet[]>("/api/virtuals/bets", { token });
}

export function placeBet(
  token: string,
  body: { roundId: number; matchId: string; market: VirtualMarket; selection: string; stake: number },
): Promise<VirtualBet & { balance: number }> {
  return api<VirtualBet & { balance: number }>("/api/virtuals/bets", {
    method: "POST",
    token,
    body,
  });
}

export function getBalance(token: string | null): Promise<CreditBalance> {
  return api<CreditBalance>("/api/credits/balance", { token });
}

export function currentToken(): string | null {
  return typeof window !== "undefined" ? userToken.get() : null;
}

/** Initials chip for a fictional club (original art — no logos). */
export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function selectionLabel(market: VirtualMarket, selection: string): string {
  if (market === "1X2") return selection === "H" ? "Home" : selection === "D" ? "Draw" : "Away";
  if (market === "OU25") return selection === "OVER" ? "Over 2.5" : "Under 2.5";
  if (market === "DC") return selection === "1X" ? "Home or Draw" : selection === "12" ? "Home or Away" : "Draw or Away";
  if (market === "BTTS") return selection === "GG" ? "Both score" : "Not both score";
  return `Correct score ${selection}`;
}
