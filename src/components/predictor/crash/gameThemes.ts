/** Full-page identity per crash game. */
export type GamePageTheme = {
  /** rgb triplet for washes and glows */
  glow: string;
  /** page background wash */
  wash: string;
  /** kicker label */
  kicker: string;
  /** hero title */
  title: string;
  /** subtitle */
  subtitle: string;
  /** crash word used in status */
  crashedWord: string;
};

export const GAME_PAGE_THEMES: Record<string, GamePageTheme> = {
  aviator: {
    glow: "239,68,68",
    wash: "radial-gradient(1200px 500px at 50% -10%, rgba(239,68,68,0.09), transparent 70%)",
    kicker: "Spribe · Crash",
    title: "Aviator",
    subtitle: "AI crash-point predictor — every round drawn provably fair",
    crashedWord: "Crashed",
  },
  "sporty-jet": {
    glow: "34,211,238",
    wash: "radial-gradient(1200px 500px at 50% -10%, rgba(34,211,238,0.09), transparent 70%)",
    kicker: "SportyBet · Crash",
    title: "Sporty Jet",
    subtitle: "AI crash-point predictor — ride the jet to the edge",
    crashedWord: "Crashed",
  },
  sportyhero: {
    glow: "167,139,250",
    wash: "radial-gradient(1200px 500px at 50% -10%, rgba(167,139,250,0.1), transparent 70%)",
    kicker: "SportyBet · Crash",
    title: "SportyHero",
    subtitle: "AI crash-point predictor — 32-bit hero rounds, decoded live",
    crashedWord: "Flew away",
  },
  "test-flight": {
    glow: "52,211,153",
    wash: "radial-gradient(1200px 500px at 50% -10%, rgba(52,211,153,0.08), transparent 70%)",
    kicker: "SignalVault Lab · Sandbox",
    title: "Test Flight",
    subtitle: "Crash lab — tune the RTP and stress-test the AI",
    crashedWord: "Terminated",
  },
};
