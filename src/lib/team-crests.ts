// Team crests for scan result cards.
//
// Transcribed team names arrive as abbreviations (MUN, ARS, SUN, BRE…)
// or full names ("Real Madrid", "Celtic"). This module normalizes both
// to a club entry with a verified logo URL. Every logo URL in CLUBS was
// verified to load (HTTP 200, real image) in the rig browser before
// shipping; any team with no entry here renders a monogram shield
// instead — a broken image is never acceptable, so TeamCrest also falls
// back to the monogram on any load error at runtime.
//
// Source: ESPN teamlogos CDN (images only — not a model provider).
// ESPN IDs below are pinned values; the rig verification script
// (crest-rig/verify-crests.mjs) re-checks every URL, including a
// negative control (an invalid ID), and any URL that fails is dropped
// from this map before push.

export type ClubEntry = {
  /** Display name used in the AI PICK banner. */
  name: string;
  /** Verified logo URL. */
  logo: string;
  /** Extra lookup keys (abbreviations, short names). Normalized on load. */
  aliases: string[];
};

const espn = (id: number) => `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;

const CLUBS: ClubEntry[] = [
  // English Premier League (the 20 clubs on Instant Football slips)
  { name: "Arsenal", logo: espn(359), aliases: ["ars", "arsenalfc", "gunners"] },
  { name: "Aston Villa", logo: espn(362), aliases: ["avl", "ast", "astonvilla", "villa"] },
  { name: "AFC Bournemouth", logo: espn(349), aliases: ["bou", "bournemouth", "afcbournemouth", "cherries"] },
  { name: "Brentford", logo: espn(337), aliases: ["bre", "brentfordfc", "bees"] },
  { name: "Brighton & Hove Albion", logo: espn(331), aliases: ["bha", "brighton", "brightonhovealbion", "brightonandhovealbion", "seagulls"] },
  { name: "Chelsea", logo: espn(361), aliases: ["che", "chelseafc", "blues"] },
  { name: "Crystal Palace", logo: espn(384), aliases: ["cry", "crystalpalace", "palace", "eagles"] },
  { name: "Everton", logo: espn(368), aliases: ["eve", "evertonfc", "toffees"] },
  { name: "Fulham", logo: espn(370), aliases: ["ful", "fulhamfc", "cottagers"] },
  { name: "Leeds United", logo: espn(357), aliases: ["lee", "leeds", "leedsunited", "leedsutd"] },
  { name: "Liverpool", logo: espn(364), aliases: ["liv", "liverpoolfc", "reds"] },
  { name: "Manchester City", logo: espn(382), aliases: ["mci", "mcy", "manchestercity", "mancity", "citizens"] },
  { name: "Manchester United", logo: espn(360), aliases: ["mun", "manchesterunited", "manutd", "manu", "reddevils"] },
  { name: "Newcastle United", logo: espn(381), aliases: ["new", "newcastle", "newcastleunited", "magpies"] },
  { name: "Nottingham Forest", logo: espn(393), aliases: ["nfo", "for", "nottinghamforest", "nottmforest", "forest", "red"] },
  { name: "Sunderland", logo: espn(366), aliases: ["sun", "sunderlandafc", "blackcats"] },
  { name: "Tottenham Hotspur", logo: espn(367), aliases: ["tot", "tottenham", "tottenhamhotspur", "spurs"] },
  { name: "West Ham United", logo: espn(371), aliases: ["whu", "westham", "westhamunited", "hammers"] },
  { name: "Burnley", logo: espn(379), aliases: ["bur", "burnleyfc", "clarets"] },
  { name: "Wolverhampton Wanderers", logo: espn(380), aliases: ["wol", "wolverhampton", "wolverhamptonwanderers", "wolves"] },
  // Recently promoted sides (26/27 table) — covered so they never monogram
  { name: "Ipswich Town", logo: espn(373), aliases: ["ips", "ipswich", "ipswichtown", "tractorboys"] },
  { name: "Hull City", logo: espn(372), aliases: ["hul", "hull", "hullcity", "tigers"] },
  // Big European clubs (sim derby pool + Champions League regulars)
  { name: "Real Madrid", logo: espn(86), aliases: ["rma", "realmadrid", "real", "losblancos"] },
  { name: "Barcelona", logo: espn(83), aliases: ["bar", "barcelona", "barca", "fcbarcelona", "blaugrana"] },
  { name: "Inter Milan", logo: espn(110), aliases: ["int", "inter", "internazionale", "intermilan", "nerazzurri"] },
  { name: "AC Milan", logo: espn(103), aliases: ["mil", "acmilan", "milan", "rossoneri"] },
  { name: "Bayern Munich", logo: espn(132), aliases: ["bay", "bayern", "bayernmunich", "fcbayern"] },
  { name: "Borussia Dortmund", logo: espn(124), aliases: ["dor", "dortmund", "borussiadortmund", "bvb"] },
  { name: "FC Porto", logo: espn(437), aliases: ["por", "porto", "fcporto", "dragoes"] },
  { name: "Benfica", logo: espn(444), aliases: ["ben", "benfica", "slbenfica", "eagles"] },
  { name: "Celtic", logo: espn(256), aliases: ["cel", "celticfc", "bhoys"] },
  { name: "Rangers", logo: espn(257), aliases: ["ran", "rangersfc", "gers"] },
  // NOTE: Galatasaray + Fenerbahçe are intentionally UNMAPPED — their
  // recalled ESPN IDs 404'd in verification and no verified source was
  // found, so they render monogram shields rather than a guessed URL.
  { name: "Paris Saint-Germain", logo: espn(160), aliases: ["psg", "parissaintgermain", "paris"] },
  { name: "Juventus", logo: espn(111), aliases: ["juv", "juventusfc", "juve", "bianconeri"] },
  { name: "Atlético Madrid", logo: espn(106), aliases: ["atm", "atletico", "atleticomadrid", "atleticodemadrid"] },
  { name: "Ajax", logo: espn(138), aliases: ["aja", "ajaxamsterdam"] },
  { name: "Napoli", logo: espn(114), aliases: ["nap", "napolifc", "sscnapoli"] },
  { name: "AS Roma", logo: espn(104), aliases: ["rom", "roma", "asroma"] },
];

/** Normalize a transcribed team string for lookup: lowercase, strip
 *  accents, drop all non-alphanumerics ("Man Utd" -> "manutd"). */
export function normalizeTeam(raw: string): string {
  const folded = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return folded.replace(/[^a-z0-9]/g, "");
}

const byKey = new Map<string, ClubEntry>();
for (const club of CLUBS) {
  byKey.set(normalizeTeam(club.name), club);
  for (const alias of club.aliases) byKey.set(normalizeTeam(alias), club);
}

/** Resolve a transcribed team string to a club entry, or null when the
 *  team is not in the verified map (caller renders a monogram then). */
export function clubFor(team: string | null | undefined): ClubEntry | null {
  if (!team) return null;
  const key = normalizeTeam(team);
  if (!key || key === "unreadable") return null;
  const direct = byKey.get(key);
  if (direct) return direct;
  // "Manchester United FC" -> "manchesterunitedfc": retry without a
  // trailing "fc" so full names with the suffix still resolve.
  if (key.endsWith("fc")) return byKey.get(key.slice(0, -2)) ?? null;
  return null;
}

/** Display name for a transcribed side: the mapped club name when
 *  known, otherwise the raw transcribed string. */
export function displayNameFor(team: string): string {
  return clubFor(team)?.name ?? team;
}

/** Split a match label into its two sides. The model copies the slip's
 *  own separator, so real labels arrive as "HOME vs AWAY", "HOME vs.
 *  AWAY", "HOME - AWAY", and en/em-dash variants — every form is
 *  accepted, or the banner and crests silently vanish for that row
 *  (seen live 25 Oct on hyphenated slips). The separator must be
 *  surrounded by whitespace, so hyphenated names ("Al-Ahly") never
 *  split. Returns null when the label does not parse (caller renders
 *  the raw label). */
export function parseFixture(matchLabel: string): { home: string; away: string } | null {
  const parts = matchLabel.split(/\s+(?:vs\.?|-|–|—)\s+/i);
  if (parts.length !== 2) return null;
  const [homeRaw, awayRaw] = parts;
  if (homeRaw === undefined || awayRaw === undefined) return null;
  const home = homeRaw.trim();
  const away = awayRaw.trim();
  if (!home || !away) return null;
  return { home, away };
}

/** Resolve a 1/X/2 prediction to the picked side's display name, or
 *  null for unpredicted/unreadable rows. */
export function pickedName(
  prediction: string,
  fixture: { home: string; away: string } | null,
): string | null {
  if (!fixture) return null;
  if (prediction === "1") return displayNameFor(fixture.home);
  if (prediction === "2") return displayNameFor(fixture.away);
  if (prediction === "X" || prediction === "x") return "Draw";
  return null;
}

/** Resolve a 1/X/2 prediction to the picked side's raw transcribed
 *  string (for crest lookup), or null for Draw/unpredicted rows. */
export function pickedTeam(
  prediction: string,
  fixture: { home: string; away: string } | null,
): string | null {
  if (!fixture) return null;
  if (prediction === "1") return fixture.home;
  if (prediction === "2") return fixture.away;
  return null;
}

/** Resolve a slip pick code to a readable label: 1 -> home side,
 *  2 -> away side, X -> Draw, anything else passes through verbatim
 *  (empty -> em dash, as the cards already render). The model
 *  sometimes stores a verbose pick ("2 (Away Win)") instead of a bare
 *  code — a leading code followed by a separator still resolves to
 *  the team name. A "." after the code is NOT a separator ("1. FC
 *  Köln" is a team name, not a pick). */
export function slipPickLabel(
  originalPick: string | null | undefined,
  fixture: { home: string; away: string } | null,
): string {
  if (!originalPick) return "—";
  if (!fixture) return originalPick;
  const codeMatch = originalPick.match(/^\s*([12Xx])[\s(:\-]/);
  const code = codeMatch?.[1]?.toUpperCase() ?? originalPick;
  if (code === "1") return displayNameFor(fixture.home);
  if (code === "2") return displayNameFor(fixture.away);
  if (code === "X") return "Draw";
  return originalPick;
}

/** Parse a confidence string like "75%" to a 0-100 number for the
 *  banner bar, or null when it does not parse. */
export function confidencePct(confidence: string | null | undefined): number | null {
  if (!confidence) return null;
  const digits = confidence.replace(/[^0-9]/g, "");
  if (digits) {
    const n = parseInt(digits, 10);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  // The app stores confidence as a banded WORD (ai.js deriveConfidence:
  // High >= 80, Medium 60-79, Low < 60), so a numeric bar needs the
  // canonical inverse mapping (ai.js deriveAccuracy) — the bar label
  // still shows the word itself, so nothing is overstated.
  const word = confidence.trim().toLowerCase();
  if (word === "high") return 85;
  if (word === "medium") return 65;
  if (word === "low") return 45;
  return null;
}

/** Deterministic monogram color for a team name (dark-theme friendly). */
const MONOGRAM_COLORS = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-rose-600",
  "bg-amber-600",
  "bg-violet-600",
  "bg-cyan-700",
  "bg-lime-700",
  "bg-orange-600",
  "bg-indigo-600",
  "bg-teal-600",
  "bg-pink-600",
  "bg-blue-700",
];

export function monogramColor(team: string): string {
  let h = 0;
  for (let i = 0; i < team.length; i++) h = (h * 31 + team.charCodeAt(i)) >>> 0;
  return MONOGRAM_COLORS[h % MONOGRAM_COLORS.length];
}

/** Initials for a monogram shield: first letters of up to two words,
 *  else the first two characters. */
export function monogramInitials(team: string): string {
  const words = team
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(" ")
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const clean = team.replace(/[^A-Za-z0-9]/g, "");
  return (clean.slice(0, 2) || "?").toUpperCase();
}

/** All verified logo URLs (used by the rig verification script). */
export function allClubLogos(): { name: string; logo: string }[] {
  return CLUBS.map((c) => ({ name: c.name, logo: c.logo }));
}
