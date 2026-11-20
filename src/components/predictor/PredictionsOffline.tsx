import { Link } from "@tanstack/react-router";
import { MaterialIcon } from "@/components/ui/material-icon";

/**
 * Shown on predictor game pages when the superadmin kill switch
 * (virtual predictions) is OFF — mirrors VirtuWin's "Predictions
 * offline" overlay behaviour.
 */
export function PredictionsOffline({ gameName }: { gameName: string }) {
  return (
    <div className="grid min-h-[55vh] place-items-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-gradient-to-b from-[#07130c] to-black p-8 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10">
          <MaterialIcon name="power_off" filled className="text-[28px] text-destructive" />
        </span>
        <h1 className="mt-4 text-xl font-black text-foreground">Predictions offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {gameName} is paused right now — the prediction engines are switched off
          platform-wide. Your pass time is safe; check back shortly.
        </p>
        <Link
          to="/predictor"
          className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:brightness-110"
        >
          <MaterialIcon name="arrow_back" className="text-[16px]" /> Back to games
        </Link>
      </div>
    </div>
  );
}
