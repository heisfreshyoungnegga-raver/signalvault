export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T | null;
  code?: string;
};

const BASE_KEY = "darkweb_api_base";

export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  return (
    window.localStorage.getItem(BASE_KEY) ??
    (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ??
    ""
  );
}

export function setApiBase(url: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BASE_KEY, url.replace(/\/$/, ""));
}

export class ApiError extends Error {
  status: number;
  /** Machine-readable server error code (e.g. GAME_LOCKED, GAME_EXPIRED). */
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  token?: string | null;
  form?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export async function api<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  let body: BodyInit | null = null;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: opts.signal,
    });
  } catch (err) {
    // Cancellation must stay distinguishable: callers that abort a staged
    // scan need to know it was cancelled, not failed.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the server. Check your connection.", 0);
  }

  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.success) {
    throw new ApiError(json?.message ?? `Request failed (${res.status})`, res.status, json?.code ?? null);
  }
  return json.data as T;
}

/* ---------------- tokens ---------------- */

const USER_TOKEN = "darkweb_user_token";
const ADMIN_TOKEN = "darkweb_admin_token";
const ADMIN_ROLE = "darkweb_admin_role";

const store = () => (typeof window === "undefined" ? null : window.sessionStorage);

export const userToken = {
  get: () => store()?.getItem(USER_TOKEN) ?? null,
  set: (t: string) => store()?.setItem(USER_TOKEN, t),
  clear: () => store()?.removeItem(USER_TOKEN),
};

export const adminToken = {
  get: () => store()?.getItem(ADMIN_TOKEN) ?? null,
  role: () => store()?.getItem(ADMIN_ROLE) ?? null,
  set: (t: string, role: string) => {
    store()?.setItem(ADMIN_TOKEN, t);
    store()?.setItem(ADMIN_ROLE, role);
  },
  clear: () => {
    store()?.removeItem(ADMIN_TOKEN);
    store()?.removeItem(ADMIN_ROLE);
  },
};

/* ---------------- types ---------------- */

export type Plan = {
  plan: string;
  hours: number;
  minutes?: number;
  amountCedis: number;
  /** Credits this tier buys (20 / 25 / 40 / 80). */
  credits?: number;
  /** Nigeria price in naira (47,000 / 56,000 / 94,000 / 188,000). */
  priceNgn?: number | null;
};
export type ScanPlan = {
  code: string;
  name: string;
  amountCedis: number;
  maxPicks: number | string;
};
export type LoginData = { token: string; expiresAt: string; secondsRemaining: number };
/* Account model: signup -> credit wallet (four tiers: GH₵250 → 4,
   GH₵300 → 8, GH₵500 → 12, GH₵1,000 → 20 credits; 4 per scan/play).
   Games are 'active' while the balance is >= 4. */
export type GameWindowState = {
  state: "locked" | "active" | "expired";
  plan: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  secondsLeft: number;
  introSeen: boolean;
  creditsLeft?: number;
};
export type AccountUser = {
  name: string;
  email: string;
  username: string;
  plans: Record<
    string,
    { plan: string; secondsLeft: number; expiresAt?: string | null; introSeen?: boolean }
  >;
  games?: Record<string, GameWindowState>;
  // Credit wallet summary — the only gate for games + scans now.
  credits?: CreditSummary;
  // True when the wallet holds at least 4 credits, or an active legacy
  // scan session exists (the scan funnel's own gate, by email).
  scanAccess?: boolean;
  // Sim-only: the simulator scan grant backing scanAccess (10 scans /
  // 45-min window from first use). Real accounts read grants from the
  // /api/scan/grant endpoint instead.
  scanGrant?: ScanGrantState;
  // Last engine the account entered (login resume) — null if none yet.
  lastGame?: string | null;
};
export type AuthData = { token: string; user: AccountUser };
export type StatusData = {
  username: string;
  loginAt: string;
  expiresAt: string;
  secondsRemaining: number;
};
export type ManualStatus = {
  id: string;
  status: "PENDING" | "AWAITING_PAYMENT" | "APPROVED" | "REJECTED" | "USED";
  plan?: string;
  submittedAt?: string;
  reviewedAt?: string | null;
  username?: string;
  password?: string;
  rejectionReason?: string;
  message?: string;
};
export type ScanStatus = {
  id: string;
  status: "PENDING" | "AWAITING_PAYMENT" | "APPROVED" | "REJECTED" | "USED";
  scanPlan?: string;
  maxPicks?: number | string;
  submittedAt?: string;
  usedAt?: string;
  rejectionReason?: string;
  message?: string;
};
export type Prediction = {
  sectionIndex: number;
  matchLabel: string;
  originalPick: string;
  prediction: string;
  confidence: string;
  analysis: string;
  verification?: 'verified' | 'mismatch' | 'unverified' | 'unreadable';
  verificationNote?: string;
  recovered?: boolean;
};
export type ScanResult = {
  id: string;
  purchaseId: string;
  email: string;
  scanPlan: string;
  totalPicksDetected: number;
  picksAnalyzed: number;
  coverageNote?: string;
  predictions: Prediction[];
  rawModelOutput?: string;
  note?: string;
  createdAt: string;
  grant?: ScanGrantState;
  // Wallet after this scan's 5-credit spend.
  credits?: CreditSummary & { spent?: number };
};

/* Scan grant state (owner spec 2026-10-24: one approved purchase = up
 * to 10 completed scans inside a 45-minute window from first use).
 * Shared by the real /scan-slip panel and the simulator grant panel. */
export type ScanGrantState = {
  state: "active" | "not-started" | "used-up" | "expired" | "awaiting" | "rejected" | "no-grant";
  scansUsed: number;
  scansMax: number;
  scansLeft: number;
  windowStartedAt: string | null;
  windowExpiresAt: string | null;
  secondsLeft: number;
  started: boolean;
};

export type ScanGrantSummary = {
  email: string;
  purchaseId: string | null;
  state: ScanGrantState["state"];
  grant: (ScanGrantState & { purchaseId: string }) | null;
  named: (ScanGrantState & { purchaseId: string }) | null;
  validGrants: number;
  totalScansLeft: number;
  scansLeft: number;
  scansUsed: number;
  scansMax: number;
  windowStartedAt: string | null;
  windowExpiresAt: string | null;
  secondsLeft: number;
  // Credit wallet — what the scan pages render now (legacy grant rows
  // above are history only).
  credits?: CreditSummary;
};

/* Manual payments — the only rail. Users transfer to the receiving
 * details below, submit proof, and an admin approves it. The details come
 * from GET /api/payment/details (superadmin-editable); these constants are
 * the offline fallback and must match lib/services/settings.js defaults. */
export type PaymentDetails = {
  ghana: { accountName: string; momoNumber: string };
  nigeria: { bankName: string; accountNumber: string; receiverName: string };
};

export const PAYMENT_DETAILS_FALLBACK: PaymentDetails = {
  ghana: { accountName: "KINSMAN SUSU VENTURES-SEKONDI", momoNumber: "0541568542" },
  nigeria: {
    bankName: "Access Bank",
    accountNumber: "1945116494",
    receiverName: "Amadi Victor Chinaemeze",
  },
};

/* The network/bank labels the manual forms offer. The backend tells a
 * Ghana submission from a Nigerian one by matching these exact strings
 * (see GH_NETWORKS / NG_BANKS in lib/util.js) — keep them in sync. */
export const GH_NETWORKS = ["MTN Mobile Money", "Telecel Cash", "AirtelTigo Money"];

export const NG_BANKS = [
  "Access Bank",
  "Fidelity Bank",
  "First Bank",
  "First City Monument Bank (FCMB)",
  "Guaranty Trust Bank (GTBank)",
  "Heritage Bank",
  "Keystone Bank",
  "Paga",
  "Polaris Bank",
  "Providus Bank",
  "Stanbic IBTC Bank",
  "Standard Chartered Bank",
  "Sterling Bank",
  "United Bank for Africa (UBA)",
  "Union Bank",
  "Wema Bank",
  "Zenith Bank",
  "Kuda Bank",
  "OPay",
  "PalmPay",
  "Moniepoint",
  "VBank",
  "Carbon",
];

export type UploadData = { url: string };

/* NEW CREDIT PACKS (2026-11-20): GH₵250 → 4, GH₵300 → 8,
   GH₵500 → 12 (default), GH₵1,000 → 20 credits. NGN prices are NOT
   SET (priceNgn is null on every tier) — Nigeria packs are disabled
   until the owner sets NGN prices. Every scan or play costs 4
   credits. Credits never expire; top-ups stack. Single source of
   truth is credits.js PACKS — keep this table in sync with it. */
export const CREDIT_PACKS = [
  { code: "STARTER", credits: 4, priceGhs: 250, priceNgn: null },
  { code: "STANDARD", credits: 8, priceGhs: 300, priceNgn: null },
  { code: "PREMIUM", credits: 12, priceGhs: 500, priceNgn: null },
  { code: "VAULT", credits: 20, priceGhs: 1000, priceNgn: null },
] as const;

export const CREDIT_PACK = {
  credits: 12,
  priceGhs: 500,
  priceNgn: null,
  costPerUse: 4,
} as const;

/** Credits a tier amount buys (GH₵250 → 4 … GH₵1,000 → 20). */
export function creditsForAmountGhs(amountCedis: number | null | undefined): number | null {
  const found = CREDIT_PACKS.find((p) => p.priceGhs === amountCedis);
  return found ? found.credits : null;
}

/** Credits a tier code buys (STARTER → 4 … VAULT → 20). */
export function creditsForTierCode(code: string | null | undefined): number | null {
  const found = CREDIT_PACKS.find((p) => p.code === code);
  return found ? found.credits : null;
}

/** Nigeria price for a scan tier code — null until NGN prices are set. */
export function nairaForScanCode(code: string | null | undefined): number | null {
  const found = CREDIT_PACKS.find((p) => `SCAN_${p.priceGhs}` === code);
  return found ? found.priceNgn : null;
}

export type CreditSummary = {
  balance: number;
  costPerUse: number;
  packCredits: number;
  packPriceGhs: number;
  packPriceNgn: number | null;
  packs?: { code: string; credits: number; priceGhs: number; priceNgn: number | null }[];
};

export const PLAN_FALLBACK: Plan[] = [
  { plan: "STARTER", hours: 0.75, minutes: 45, amountCedis: 250, credits: 4, priceNgn: null },
  { plan: "STANDARD", hours: 0.75, minutes: 45, amountCedis: 300, credits: 8, priceNgn: null },
  { plan: "PREMIUM", hours: 0.75, minutes: 45, amountCedis: 500, credits: 12, priceNgn: null },
  { plan: "VAULT", hours: 0.75, minutes: 45, amountCedis: 1000, credits: 20, priceNgn: null },
];

export const SCAN_PLAN_FALLBACK: ScanPlan[] = [
  { code: "SCAN_250", name: "STARTER", amountCedis: 250, maxPicks: "FULL" },
  { code: "SCAN_300", name: "STANDARD", amountCedis: 300, maxPicks: "FULL" },
  { code: "SCAN_500", name: "PREMIUM", amountCedis: 500, maxPicks: "FULL" },
  { code: "SCAN_1000", name: "VAULT", amountCedis: 1000, maxPicks: "FULL" },
];

/* Display-only USD reference — NEVER the payable amount (users always
   pay the cedi figure above it). GHS→USD mid-market 0.086145
   (Converterhub, 24 Oct 2026; Bank of Ghana cross-check 0.086 the same
   day). Update in this one place when the rate moves. GHS 500 → ≈ $43.07. */
export const GHS_USD_RATE = 0.086145;
export const GHS_USD_RATE_AS_OF = "2026-10-24";
export function usdApprox(amountCedis: number): string {
  return `≈ $${(amountCedis * GHS_USD_RATE).toFixed(2)}`;
}

export const planLabel = (code: string) =>
  ({ STARTER: "Starter", STANDARD: "Standard", PREMIUM: "Premium", VAULT: "Vault", MIN15: "Premium", HOUR1: "Premium", HOUR3: "Premium" })[code] ?? "Premium";

/* Internal plan codes (SCAN_550, SESSION_550, …) are data, never display
   text. User-facing surfaces must label plans through these helpers. */
export const SCAN_PLAN_DISPLAY: Record<string, { name: string; tagline: string }> = {
  SCAN_250: { name: "Starter", tagline: "Full Coverage Scan" },
  SCAN_300: { name: "Standard", tagline: "Full Coverage Scan" },
  SCAN_500: { name: "Premium", tagline: "Full Coverage Scan" },
  SCAN_1000: { name: "Vault", tagline: "Full Coverage Scan" },
  SCAN_550: { name: "Premium", tagline: "Full Coverage Scan" },
  SESSION_550: { name: "Premium", tagline: "60-Minute Scan Session" },
};

export function scanPlanLabel(code?: string | null): string {
  if (!code) return "Premium";
  const d = SCAN_PLAN_DISPLAY[code];
  if (d) return `${d.name} — ${d.tagline}`;
  if (code.startsWith("SESSION_")) return "Premium — Scan Session";
  if (code.startsWith("SCAN_")) return "Premium — Scan";
  return "Premium";
}

export function scanPlanTagline(p: ScanPlan): string {
  const d = SCAN_PLAN_DISPLAY[p.code];
  if (d) return d.tagline;
  return p.maxPicks === "FULL" || p.maxPicks === -1
    ? "Full Coverage Scan"
    : `Up to ${p.maxPicks} picks per slip`;
}

export function picksLabel(maxPicks?: number | string | null): string {
  if (maxPicks === "FULL" || maxPicks === -1) return "Full coverage";
  return String(maxPicks ?? "—");
}

export const planDuration = (hours: number) =>
  hours < 1 ? `${Math.round(hours * 60)} minutes` : `${hours} hour${hours > 1 ? "s" : ""}`;

export function formatCountdown(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

/* ---------------- prediction engines ---------------- */

export type EngineTier = {
  key: string;
  cashout: number;
  label: string;
  hitRate: number;
};

export type EnginePrediction = {
  type: "crash" | "penalty" | "adventure" | "action";
  summary: string;
  confidence: number;
  riskLevel: string;
  stakePct: number;
  reasoning: string[];
  round: number;
  engine: string;
  factors?: SignalFactor[];
  disclaimer?: string;
  // crash
  cashout?: number;
  tier?: string;
  tiers?: EngineTier[];
  room?: {
    rounds: number;
    avgMultiplier: number;
    volatility: number;
    trend: string;
    bustStreak: number;
    roundsSince10x: number;
  };
  // penalty
  direction?: string;
  goalRate?: number;
  corners?: { direction: string; goalRate: number; keeperDivePct: number; shots: number }[];
  keeperProfile?: { left: number; center: number; right: number };
  // adventure
  cashoutStage?: number;
  cashoutMultiplier?: number;
  expectedValue?: number;
  survivalCurve?: { stage: number; survivePct: number; pays: string; ev: number }[];
  // action
  zone?: string;
  hotPct?: number;
  edgeOverRandom?: number;
  zones?: { zone: string; hotPct: number; rawHits: number }[];
  bonus?: { ratePct: number; roundsSince: number; overdue: boolean };
};

export type EngineStats = {
  engine: string;
  rounds: number;
  predictions: number;
  hits: number;
  accuracy: number;
  streak: number;
  bestStreak: number;
};

export type EngineRound = {
  n: number;
  outcome: Record<string, number | string | boolean>;
  ts: number;
  graded?: { hit: boolean; prediction: string };
};

export type EngineGame = {
  id: string;
  name: string;
  tag: string;
  provider: string;
  image: string;
  blurb: string;
  stats: EngineStats;
  prediction: EnginePrediction;
};

export type EngineDetail = EngineGame & {
  history: EngineRound[];
};

export async function listEngines(): Promise<EngineGame[]> {
  // api<T>() already unwraps the envelope — do NOT read .data again.
  return api<EngineGame[]>("/api/engines");
}

// Static tile data so engine lobbies render INSTANTLY — the /api/engines
// call can take 1–3s on a cold serverless start. This one row mirrors
// lib/services/engines/index.js exactly (same id, name, tag, image,
// blurb); live stats + predictions swap in when the API answers.
// Aviator-only since 2026-11-20.
// Placeholder stats read 0 / "Warming up…" — honest, never invented.
// Used as placeholderData by /engines and /predictor.
export const ENGINES_FALLBACK: EngineGame[] = [
  { id: "aviator", name: "Aviator", tag: "Crash", provider: "Spribe", image: "/games/aviator.png", blurb: "The legendary red plane — AI times your cash-out to the round.", stats: { engine: "Aviator Engine", rounds: 0, predictions: 0, hits: 0, accuracy: 0, streak: 0, bestStreak: 0 }, prediction: { type: "crash", summary: "Warming up…", confidence: 0, riskLevel: "—", stakePct: 0, reasoning: [], round: 0, engine: "Aviator Engine" } },
];

export async function getEngine(id: string): Promise<EngineDetail> {
  const data = await api<EngineDetail>(`/api/engines/${id}`);
  if (!data) throw new ApiError("Engine not found", 404);
  return data;
}

export async function getEngineHistory(id: string, limit = 30): Promise<EngineRound[]> {
  return api<EngineRound[]>(`/api/engines/${id}/history?limit=${limit}`);
}

export async function tickEngine(id: string): Promise<{
  round: EngineRound;
  prediction: EnginePrediction;
  stats: EngineStats;
}> {
  const data = await api<{
    round: EngineRound;
    prediction: EnginePrediction;
    stats: EngineStats;
  }>(`/api/engines/${id}/tick`, { method: "POST", token: userToken.get() });
  if (!data) throw new ApiError("Engine tick failed", 500);
  return data;
}

/* ---------------- predictor: fairness + signal factors ---------------- */

export type SignalFactor = {
  name: string;
  score: number;
  weight: number;
  direction: "bullish" | "bearish" | "neutral";
  detail: string;
};

export type FairnessProof = {
  round: number;
  hash: string;
  crash: number;
  serverSeed: string;
  clientSeeds?: string[];
  rtp: number;
  variant?: string;
  algorithm: string;
};

export async function getFairness(id: string, round: number): Promise<FairnessProof> {
  const data = await api<FairnessProof>(`/api/engines/${id}/fairness/${round}`);
  if (!data) throw new ApiError("Fairness proof not found", 404);
  return data;
}

export async function verifyRound(
  id: string,
  round: number,
  crash: number,
): Promise<{
  valid: boolean;
  recomputed: { n: number; hash: string; crash: number; serverSeed: string; rtp: number };
}> {
  const data = await api<{
    valid: boolean;
    recomputed: { n: number; hash: string; crash: number; serverSeed: string; rtp: number };
  }>(`/api/engines/${id}/verify`, {
    method: "POST",
    // api<T>() stringifies the body itself — pass the object, not a string.
    body: { round, crash },
    token: userToken.get(),
  });
  if (!data) throw new ApiError("Verification failed", 500);
  return data;
}

/* ---------------- predictor platform: analyze / simulate / history ---------------- */

export type TargetAnalysis = {
  target: number;
  window: number;
  sampleSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  wilson: { lower: number; upper: number };
  theoretical: number;
  evPerUnit: number;
  mean: number;
  median: number;
  std: number;
  iqr: number;
  max: number;
};

export type SimConfig = {
  rounds?: number;
  target?: number;
  stake?: number;
  seed?: number | undefined;
};

export type SimResults = {
  gameId: string;
  config: { rounds: number; target: number; stake: number; seed: number };
  results: {
    wins: number;
    losses: number;
    winRate: number;
    netPnl: number;
    maxDrawdown: number;
    equityCurve: number[];
    theoreticalWinRate: number;
  };
};

export type AnalysisRecord = {
  id: string;
  gameId: string;
  kind: string;
  params: Record<string, unknown>;
  output: Record<string, unknown>;
  note?: string;
  createdAt: string;
};

export async function analyzeTarget(
  gameId: string,
  target: number,
  window = 100,
): Promise<{ gameId: string; analysis: TargetAnalysis; timestamp: string }> {
  const data = await api<{ gameId: string; analysis: TargetAnalysis; timestamp: string }>(
    `/api/engines/${gameId}/analyze`,
    {
      method: "POST",
      // api<T>() stringifies the body itself — pass the object, not a string.
      body: { target, window },
      token: userToken.get(),
    },
  );
  if (!data) throw new ApiError("Analysis failed", 500);
  return data;
}

export async function simulate(gameId: string, config: SimConfig): Promise<SimResults> {
  const data = await api<SimResults>(`/api/engines/${gameId}/simulate`, {
    method: "POST",
    body: config,
    token: userToken.get(),
  });
  if (!data) throw new ApiError("Simulation failed", 500);
  return data;
}

export async function listAnalyses(): Promise<AnalysisRecord[]> {
  return api<AnalysisRecord[]>("/api/analyses");
}

export async function saveAnalysis(
  gameId: string,
  kind: string,
  params: Record<string, unknown>,
  output: Record<string, unknown>,
  note?: string,
): Promise<AnalysisRecord> {
  const data = await api<AnalysisRecord>("/api/analyses", {
    method: "POST",
    // api<T>() stringifies the body itself — pass the object, not a string.
    body: { gameId, kind, params, output, note },
  });
  if (!data) throw new ApiError("Could not save analysis", 500);
  return data;
}

/* Server-side loader helper: loaders call the API project DIRECTLY.
   The API is a separate Vercel project (signalvault-api) — same-origin
   /api 404s on this frontend, so the old same-origin / 127.0.0.1 logic
   silently resolved every loader to its catch fallback ([] / null):
   the lobby showed 6 grey skeleton tiles forever and engine detail
   pages loaded empty. VITE_API_BASE_URL is inlined at build time and
   works both SSR-side and in the browser. */
export function loaderApiBase(): string {
  const apiBase = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "");
  if (apiBase) return apiBase;
  if (typeof window !== "undefined") {
    const stored = getApiBase();
    if (stored) return stored;
    return "";
  }
  if (process.env["MOCK_API_URL"]) return process.env["MOCK_API_URL"];
  const front = process.env["APP_FRONTEND_BASE_URL"];
  if (front) return /^https?:\/\//.test(front) ? front : `https://${front}`;
  return "http://127.0.0.1:8080";
}

export async function loaderFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${loaderApiBase()}${path}`);
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!json?.success) throw new ApiError(json?.message ?? "Request failed", res.status);
  return json.data as T;
}

export type CrashDraw = {
  gameId: string;
  crash: number;
  hash: string;
  seed: string;
  clientSeeds?: string[];
  rtp: number;
  variant: string;
  generatedAt: string;
};

/** AI crash-point draw: one fresh random crash point from the game's
 *  authentic provably-fair construction. */
export async function drawCrash(gameId: string): Promise<CrashDraw> {
  const data = await api<CrashDraw>(`/api/engines/${gameId}/random-crash`, {
    token: userToken.get(),
  });
  if (!data) throw new ApiError("Draw failed", 500);
  return data;
}

/* ---------------- Spin da Bottle: pinned pattern ---------------- */

export type BottleCall = "UP" | "DOWN";

export type BottlePattern = {
  calls: BottleCall[] | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** 1-based round the shared sequence serves next (null when AI calls). */
  nextRound: number | null;
};

export type BottleNext =
  | { mode: "pattern"; call: BottleCall; round: number; of: number; confidence: number; creditsLeft?: number }
  | { mode: "ai"; creditsLeft?: number };

/** Public read: the live pinned pattern (or null calls = AI predictor). */
export async function getBottlePattern(): Promise<BottlePattern> {
  return api<BottlePattern>("/api/settings/bottle-rounds");
}

/** Superadmin only: set exactly 10 calls, or null to clear back to AI. */
export async function setBottlePattern(
  calls: BottleCall[] | null,
  token: string | null,
): Promise<BottlePattern> {
  return api<BottlePattern>("/api/settings/bottle-rounds", {
    method: "PUT",
    token,
    body: { calls },
  });
}

/**
 * Consume the next pinned call from the ONE shared server-side sequence —
 * every player draws in order and stays in sync. mode "ai" = no pattern
 * set, the client's own predictor calls the round.
 */
export async function nextBottleCall(): Promise<BottleNext> {
  return api<BottleNext>("/api/bottle/next", { method: "POST", token: userToken.get() });
}

/** Report the engine-entry intro as played for the current window. */
export async function markIntroSeen(game: string): Promise<void> {
  await api("/api/games/intro-seen", {
    method: "POST",
    token: userToken.get(),
    body: { game },
  }).catch(() => undefined);
}

/* ---------------- platform kill switch ---------------- */

export type VirtualPredictions = { enabled: boolean };

export async function getVirtualPredictions(): Promise<VirtualPredictions> {
  return api<VirtualPredictions>("/api/settings/virtual-predictions");
}

export async function setVirtualPredictions(
  enabled: boolean,
  token: string | null,
): Promise<VirtualPredictions & { updatedAt?: string; updatedBy?: string }> {
  return api("/api/settings/virtual-predictions", {
    method: "PUT",
    token,
    body: { enabled },
  });
}

/* ---------------- superadmin user-flow simulator (staff-only QA) ---------------- */

export type SimRun = {
  runId: string;
  simIdentity: string;
  simToken: string;
  expiresAt: string;
};

export type SimPaymentDetails = {
  country?: "ghana" | "nigeria";
  accountName?: string;
  accountNumber?: string;
  networkOrBank?: string;
  reference?: string;
};

export type SimPayment = {
  id: string;
  runId: string;
  game: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  expiresAt?: string;
  country?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  networkOrBank?: string | null;
  reference?: string | null;
  amount?: number | null;
  currency?: string | null;
};

const SIM_BASE = "/api/superadmin/userflow-simulator";

export async function simStart(token: string): Promise<SimRun> {
  return api<SimRun>(`${SIM_BASE}/start`, { method: "POST", token });
}

export async function simPay(
  runId: string,
  game: string,
  token: string,
  details?: SimPaymentDetails,
): Promise<SimPayment> {
  return api<SimPayment>(`${SIM_BASE}/pay`, { method: "POST", token, body: { runId, game, details } });
}

export async function simApprove(paymentId: string, token: string): Promise<SimPayment> {
  return api<SimPayment>(`${SIM_BASE}/approve`, { method: "POST", token, body: { paymentId } });
}

export async function simDecline(paymentId: string, token: string): Promise<SimPayment> {
  return api<SimPayment>(`${SIM_BASE}/decline`, { method: "POST", token, body: { paymentId } });
}

export async function simEntitlement(runId: string, token: string): Promise<AccountUser> {
  return api<AccountUser>(`${SIM_BASE}/entitlement?runId=${encodeURIComponent(runId)}`, { token });
}

export async function simExpire(runId: string, token: string): Promise<void> {
  await api(`${SIM_BASE}/expire`, { method: "POST", token, body: { runId } });
}

/* Sim scan result: the staged real-AI shape (new rows) — plus the
 * legacy fixture fields, kept so pre-AI history rows still render. */
export type SimScan = {
  id: string;
  slipName: string | null;
  createdAt: string;
  scanPlan?: string;
  totalPicksDetected?: number;
  picksAnalyzed?: number;
  coverageNote?: string;
  predictions?: Prediction[];
  grant?: ScanGrantState;
  // Wallet after this scan's 5-credit spend.
  credits?: CreditSummary & { spent?: number };
  // Legacy fixture rows (stored before the sim scan ran the real AI):
  overallConfidence?: number;
  picks?: {
    match: string;
    pick: string;
    confidence: number;
    originalPick?: string;
    prediction?: string;
    analysis?: string;
  }[];
};

export type SimStageTranscribe = {
  picks: Prediction[];
  totalPicksDetected: number;
  servingModel: string | null;
  missingPositions: number[];
};
export type SimStageGapfill = {
  picks: Prediction[];
  totalPicksDetected: number;
  recoveredPositions: number[];
  missingPositions: number[];
  gapfillFailed: boolean;
};
export type SimStageVerify = {
  predictions: Prediction[];
  totalPicksDetected: number;
};

function simScanForm(runId: string, image: Blob, extra?: (f: FormData) => void): FormData {
  const form = new FormData();
  form.set("runId", runId);
  form.set("image", image, "slip.jpg");
  if (extra) extra(form);
  return form;
}

export async function simScanTranscribe(
  runId: string,
  token: string,
  image: Blob,
  signal?: AbortSignal,
): Promise<SimStageTranscribe> {
  return api<SimStageTranscribe>(`${SIM_BASE}/scan/stage/transcribe`, {
    token,
    form: simScanForm(runId, image),
    signal,
  });
}

export async function simScanGapfill(
  runId: string,
  token: string,
  image: Blob,
  picks: Prediction[],
  totalPicksDetected: number,
  signal?: AbortSignal,
): Promise<SimStageGapfill> {
  return api<SimStageGapfill>(`${SIM_BASE}/scan/stage/gapfill`, {
    token,
    form: simScanForm(runId, image, (f) => {
      f.set("picks", JSON.stringify(picks));
      f.set("totalPicksDetected", String(totalPicksDetected));
    }),
    signal,
  });
}

export async function simScanVerify(
  runId: string,
  token: string,
  image: Blob,
  picks: Prediction[],
  totalPicksDetected: number,
  servingModel?: string | null,
  signal?: AbortSignal,
): Promise<SimStageVerify> {
  return api<SimStageVerify>(`${SIM_BASE}/scan/stage/verify`, {
    token,
    form: simScanForm(runId, image, (f) => {
      f.set("picks", JSON.stringify(picks));
      f.set("totalPicksDetected", String(totalPicksDetected));
      if (servingModel) f.set("servingModel", servingModel);
    }),
    signal,
  });
}

export async function simScanFinalize(
  runId: string,
  token: string,
  predictions: Prediction[],
  totalPicksDetected: number,
  slipName?: string,
  signal?: AbortSignal,
): Promise<SimScan> {
  return api<SimScan>(`${SIM_BASE}/scan/stage/finalize`, {
    token,
    body: { runId, predictions, totalPicksDetected, slipName },
    signal,
  });
}

export async function simScans(runId: string, token: string): Promise<SimScan[]> {
  return api<SimScan[]>(`${SIM_BASE}/scans?runId=${encodeURIComponent(runId)}`, { token });
}
