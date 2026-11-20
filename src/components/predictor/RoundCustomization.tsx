import { useEffect, useState } from "react";
import { Dices, Save, Trash2, RefreshCw, Sparkles } from "lucide-react";
import { api, adminToken } from "@/lib/api";
import { GAME_PAGE_THEMES } from "@/components/predictor/crash/gameThemes";
import { cn } from "@/lib/utils";

const GAMES = [
  { id: "aviator", name: "Aviator" },
  { id: "sporty-jet", name: "Sporty Jet" },
  { id: "sportyhero", name: "SportyHero" },
  { id: "test-flight", name: "Test Flight" },
];

type RoundRow = { index: number; crash: number; setBy?: string | null };

function tone(crash: number) {
  if (crash < 2)
    return "bg-destructive text-white";
  if (crash < 10) return "bg-slate-100 text-foreground";
  return "bg-primary text-white";
}

function GameCard({ gameId, name }: { gameId: string; name: string }) {
  const gt = GAME_PAGE_THEMES[gameId] ?? GAME_PAGE_THEMES["aviator"]!;
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [inputs, setInputs] = useState<string[]>(Array(10).fill(""));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api<RoundRow[]>(`/api/admin/rounds/custom/${gameId}`, { token: adminToken.get() });
      setRounds(d ?? []);
    } catch {
      setRounds([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  function setInput(i: number, v: string) {
    setInputs((prev) => {
      const next = [...prev];
      next[i] = v.replace(/[^0-9.]/g, "");
      return next;
    });
  }

  function fillRandom() {
    setInputs(
      Array.from({ length: 10 }, () => {
        const r = Math.random();
        const v = r < 0.5 ? 1 + Math.random() * 1.5 : r < 0.85 ? 2 + Math.random() * 8 : 10 + Math.random() * 40;
        return v.toFixed(2);
      }),
    );
    setMsg(null);
  }

  async function save() {
    const points = inputs.map((s) => s.trim()).filter((s) => s !== "");
    if (!points.length) {
      setMsg("Enter at least one multiplier.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api(`/api/admin/rounds/custom`, {
        method: "POST",
        token: adminToken.get(),
        body: { gameId, points },
      });
      setMsg(`Saved ${points.length} custom round${points.length > 1 ? "s" : ""} — the predictor will use these next.`);
      setInputs(Array(10).fill(""));
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save.");
    }
    setSaving(false);
  }

  async function clear() {
    if (!confirm(`Clear all custom rounds for ${name}? The game reverts to random.`)) return;
    try {
      await api(`/api/admin/rounds/custom/${gameId}`, { method: "DELETE", token: adminToken.get() });
      setMsg("Cleared — back to random generation.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to clear.");
    }
  }

  return (
    <div
      className="overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-slate-900 to-black p-5"
      style={{ boxShadow: `0 12px 40px rgba(${gt.glow},0.18)` }}
    >
      <div
        className="mb-4 flex items-center justify-between rounded-2xl px-4 py-3"
        style={{ background: `linear-gradient(135deg, rgba(${gt.glow},0.25), rgba(${gt.glow},0.08))` }}
      >
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground">Round customization</p>
          <h3 className="text-xl font-black text-foreground">{name}</h3>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="grid size-10 place-items-center rounded-xl bg-muted text-foreground backdrop-blur transition hover:bg-muted"
            title="Refresh"
          >
            <RefreshCw className="size-4" />
          </button>
          {rounds.length > 0 && (
            <button
              onClick={() => void clear()}
              className="grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive backdrop-blur transition hover:bg-red-500/30"
              title="Clear custom rounds"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* queued rounds */}
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rounds.length > 0 ? (
        <div className="mb-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-success">
            <Dices className="mr-1 inline size-3.5" />
            {rounds.length} custom round{rounds.length > 1 ? "s" : ""} queued — predictor uses these next
          </p>
          {/* flex-wrap, not a 5-col grid: a 1000.00x chip is wider than a
              5th of a 390px card, and grid items' min-width:auto forced the
              whole card to overflow (clipped by overflow-hidden). Chips size
              to content and wrap instead. */}
          <div className="flex flex-wrap gap-2">
            {rounds.map((r) => (
              <div
                key={r.index}
                className={cn("rounded-xl px-2 py-2.5 text-center text-sm font-black tabular-nums", tone(r.crash))}
              >
                {r.crash.toFixed(2)}x
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mb-4 rounded-xl bg-muted/60 px-3 py-2.5 text-center text-xs text-muted-foreground">
          No custom rounds set — the game uses random generation.
        </p>
      )}

      {/* input grid */}
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        Set next 10 rounds <span className="normal-case text-muted-foreground">(1.00x – 1000x)</span>
      </p>
      {/* min-w-0 on cells + inputs: a bare <input> carries a ~170px
          intrinsic min-width that forced the 5-col grid wider than the card
          on phones (the overflow). Constrained, typed values scroll inside
          the input instead of breaking the layout. */}
      <div className="grid grid-cols-5 gap-2">
        {inputs.map((v, i) => (
          <div key={i} className="relative min-w-0">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">
              {i + 1}
            </span>
            <input
              value={v}
              onChange={(e) => setInput(i, e.target.value)}
              inputMode="decimal"
              placeholder="—"
              className="w-full min-w-0 rounded-xl border border-border bg-muted/60 py-2.5 pl-6 pr-2 text-center text-sm font-bold tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={fillRandom}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-foreground transition hover:bg-muted"
        >
          <Sparkles className="size-3.5" /> Random fill
        </button>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:opacity-90 disabled:opacity-50"
        >
          <Save className="size-3.5" /> {saving ? "Saving…" : "Set rounds"}
        </button>
      </div>

      {msg && (
        <p className={cn("mt-3 rounded-xl px-3 py-2 text-center text-xs font-semibold", msg.startsWith("Saved") || msg.startsWith("Cleared") ? "bg-success/10 text-success" : "bg-warning/15 text-warning-foreground")}>
          {msg}
        </p>
      )}
    </div>
  );
}

export function RoundCustomization() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-success/30 bg-success/10 p-4">
        <h2 className="text-sm font-black text-foreground">How it works</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Enter up to 10 crash multipliers per game. The predictor plays your rounds in order
          for every user, then falls back to random generation when the queue runs out. Clear a game to revert to random instantly.
        </p>
      </div>
      {GAMES.map((g) => (
        <GameCard key={g.id} gameId={g.id} name={g.name} />
      ))}
    </div>
  );
}
