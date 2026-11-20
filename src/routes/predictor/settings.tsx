import { Link, createFileRoute } from "@tanstack/react-router";
import { Database, ShieldAlert, FlaskConical, FileJson } from "lucide-react";
import { Panel } from "@/components/predictor/terminal";

export const Route = createFileRoute("/predictor/settings")({
  component: PredictorSettings,
});

function PredictorSettings() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-foreground md:text-2xl">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Data sources, model assumptions and what this desk can and cannot do.
        </p>
      </div>

      <Panel title="Data sources">
        <ul className="space-y-3 text-sm">
          <SourceRow
            icon={Database}
            name="Round generator"
            status="Active"
            active
            detail="Seeded provably-fair engines (SHA-512 multi-seed for Aviator/Jet, 32-bit construction for SportyHero). Deterministic across sessions."
          />
          <SourceRow
            icon={FileJson}
            name="CSV / JSON import"
            status="Not built yet"
            detail="Planned: upload historical rounds with validation (required fields, numeric ranges, duplicate detection)."
          />
          <SourceRow
            icon={ShieldAlert}
            name="Authorised historical API"
            status="Not connected"
            detail="Integration point reserved. Only enable with a licensed data provider."
          />
          <SourceRow
            icon={FlaskConical}
            name="Verified live feed"
            status="Unavailable"
            detail="Never implied unless a source is genuinely connected and freshness is verifiable."
          />
        </ul>
      </Panel>

      <Panel title="Model assumptions">
        <ul className="list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-muted-foreground">
          <li>Crash rounds are <strong className="text-foreground">independent</strong> — each crash point is committed cryptographically before the round. History cannot change the next round's odds.</li>
          <li>Published/estimated RTP is <strong className="text-foreground">97%</strong> (3% house edge) for Aviator-class games. Sporty Jet's RTP is unpublished — assumed to be the same family.</li>
          <li>SportyHero uses the reverse-engineered 32-bit construction (3.48% instant-bust mass at 1.00x).</li>
          <li>SportyKick and Super Hero mechanics are <strong className="text-foreground">simulated</strong> — neither title's official rules were verifiable, so the engines simulate plausible mechanics and are labelled as such.</li>
          <li>Wilson score intervals are used for all binomial rate estimates (hit rates, goal rates, zone rates).</li>
          <li>No cash-out target has positive expected value under a negative-edge distribution — the desk shows EV honestly, including when it is negative.</li>
        </ul>
      </Panel>

      <Panel title="About this desk">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          The prediction desk is the research desk; the{" "}
          <Link to="/engines" className="font-bold text-secondary hover:underline">live engines</Link>{" "}
          are the trading floor. Both run on the same provably-fair engine code — the desk analyses
          the past, the engines call the next round's risk setup. Neither can see the future.
        </p>
      </Panel>
    </div>
  );
}

function SourceRow({ icon: Icon, name, status, detail, active }: {
  icon: any; name: string; status: string; detail: string; active?: boolean;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5">
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? "bg-success/10 text-success" : "bg-muted/60 text-muted-foreground"}`}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-bold text-foreground">{name}</p>
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${active ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted/60 text-muted-foreground"}`}>
            {status}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}
