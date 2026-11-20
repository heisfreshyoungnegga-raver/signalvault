/** Full-page identity for the one crash game — Aviator (owner order 2026-11-20). */
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
};
