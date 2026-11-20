import { CrashPredictor } from "./crash/CrashPredictor";

/**
 * Crash game page: pure immersive predictor experience.
 * Analytics sections removed — just the stage, RUN and NEXT RUN.
 */
export function CrashAnalytics({ gameId, gameName }: { gameId: string; gameName: string }) {
  return <CrashPredictor gameId={gameId} gameName={gameName} />;
}
