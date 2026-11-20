// Shared scan-result row pieces for the real /scan-slip and simulator
// /simulator/scan-slip ResultCards: team crests, the AI PICK banner, and
// the slip-pick chip. Both cards render the same pieces so real and sim
// results look identical.
//
// Crest policy: a verified club logo when the team is in the map,
// otherwise a monogram shield — and any logo that fails to load at
// runtime swaps to the monogram via onError, so a broken image can
// never appear on a card.
import { useState } from "react";

import {
  clubFor,
  confidencePct,
  monogramColor,
  monogramInitials,
  parseFixture,
  pickedName,
  pickedTeam,
} from "@/lib/team-crests";

/** Team crest: verified logo, or a monogram shield when the team is
 *  unmapped or the logo fails to load. `size` is a Tailwind size class
 *  fragment (e.g. "size-7", "size-14"). */
export function TeamCrest({
  team,
  size = "size-7",
  textSize = "text-[10px]",
}: {
  team: string | null | undefined;
  size?: string;
  textSize?: string;
}) {
  const [failed, setFailed] = useState(false);
  const club = team ? clubFor(team) : null;
  const label = team && team.toLowerCase() !== "unreadable" ? team : "?";
  if (!club || failed) {
    return (
      <span
        aria-hidden
        className={`${size} ${monogramColor(label)} text-white font-extrabold inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-white/20 ${textSize}`}
      >
        {label === "?" ? "?" : monogramInitials(label)}
      </span>
    );
  }
  return (
    <img
      src={club.logo}
      alt=""
      aria-hidden
      draggable={false}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${size} shrink-0 rounded-full bg-white/5 object-contain ring-1 ring-white/10`}
    />
  );
}

/** AI PICK banner — the hero of a predicted row: the picked team's
 *  crest, large, with the team name, "to win" (or "Draw"), and a
 *  confidence bar. Returns null ONLY for unpredicted/unreadable rows:
 *  when the fixture label does not parse, a real 1/X/2 call still gets
 *  a banner with the call direction ("Home win" / "Away win" /
 *  "Draw") and a "?" shield, so the banner can never silently vanish
 *  on a real call again (seen live 25 Oct on hyphenated slips). */
export function PickBanner({
  prediction,
  fixture,
  confidence,
}: {
  prediction: string;
  fixture: { home: string; away: string } | null;
  confidence: string;
}) {
  const name = pickedName(prediction, fixture);
  const isRealCall =
    prediction === "1" || prediction === "2" || prediction === "X" || prediction === "x";
  if (!name && !isRealCall) return null;
  const team = pickedTeam(prediction, fixture);
  const pct = confidencePct(confidence);
  const label =
    name ??
    (prediction === "X" || prediction === "x"
      ? "Draw"
      : prediction === "1"
        ? "Home win"
        : "Away win");
  const isDraw = label === "Draw";
  return (
    <div className="border-primary/30 bg-primary/10 mt-4 flex items-center gap-3 rounded-xl border p-3">
      {isDraw ? (
        <span
          aria-hidden
          className="bg-primary text-white font-extrabold inline-flex size-14 shrink-0 items-center justify-center rounded-full text-lg"
        >
          X
        </span>
      ) : (
        <TeamCrest team={team} size="size-14" textSize="text-base" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-widest text-primary">AI PICK</p>
        <p className="truncate text-base font-extrabold leading-tight">
          {label}
          <span className="text-muted-foreground font-semibold">
            {name && !isDraw ? " to win" : ""}
          </span>
        </p>
        {pct !== null && (
          <div className="mt-2 flex items-center gap-2">
            <div className="bg-white/10 h-1.5 flex-1 overflow-hidden rounded-full">
              <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-bold">{confidence}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Fixture header: home crest + the raw transcribed label + away
 *  crest, falling back to the raw label alone when it does not parse.
 *  Parsing goes through parseFixture, the same parser the banner
 *  uses, so every separator form shows crests — never a second
 *  vs-only split that can disagree with the banner. The label stays
 *  as transcribed ("MUN vs BOU", "NIC - SBR") so the row stays
 *  compact on phones; the banner below carries the full picked name. */
export function FixtureHeader({ matchLabel }: { matchLabel: string }) {
  const fixture = parseFixture(matchLabel);
  if (!fixture) {
    return <h3 className="font-bold">{matchLabel}</h3>;
  }
  return (
    <h3 className="flex min-w-0 items-center gap-2 font-bold">
      <TeamCrest team={fixture.home} />
      <span className="truncate">{matchLabel}</span>
      <TeamCrest team={fixture.away} />
    </h3>
  );
}
