import { ShieldCheck, CheckCircle2, XCircle, Loader2, Hash } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getFairness, verifyRound, type FairnessProof } from "@/lib/api";

/**
 * Provably-fair round verifier (crash engines). Pulls the round's hash +
 * server seed, recomputes the crash point, and shows the verdict.
 * Real SHA-256 math — the same construction bustabit/Spribe use.
 */
export function FairnessVerifier({ gameId, maxRound }: { gameId: string; maxRound: number }) {
  const [round, setRound] = useState("");
  const [proof, setProof] = useState<FairnessProof | null>(null);
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const inspect = async () => {
    const n = parseInt(round, 10);
    if (!Number.isFinite(n) || n < 1 || n > maxRound) {
      setError(`Enter a round between 1 and ${maxRound}.`);
      return;
    }
    setLoading(true);
    setError("");
    setVerdict(null);
    try {
      const p = await getFairness(gameId, n);
      setProof(p);
      const v = await verifyRound(gameId, n, p.crash);
      setVerdict(v.valid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-surface p-6">
      <h3 className="flex items-center gap-2 font-extrabold">
        <ShieldCheck className="size-4 text-success" /> Provably-fair verifier
      </h3>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        Every crash round is <span className="font-mono">sha256(serverSeed:round)</span> → crash point.
        Pick any past round, see its hash, and recompute it yourself.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="w-36">
          <Label htmlFor="fair-round" className="text-xs font-bold tracking-wide uppercase text-muted-foreground">
            Round #
          </Label>
          <Input
            id="fair-round"
            inputMode="numeric"
            placeholder={`1–${maxRound}`}
            value={round}
            onChange={(e) => setRound(e.target.value)}
            className="mt-1.5 rounded-xl font-mono"
          />
        </div>
        <Button onClick={inspect} disabled={loading} className="rounded-xl">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Hash className="size-4" />}
          Verify round
        </Button>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}

      {proof && (
        <div className="animate-rise mt-4 space-y-2 rounded-xl border border-muted bg-muted/40 p-4 font-mono text-xs break-all">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Round #{proof.round} → crash</span>
            <span className="text-lg font-extrabold text-foreground">{proof.crash.toFixed(2)}x</span>
          </div>
          <p><span className="text-muted-foreground">hash&nbsp;&nbsp;</span>{proof.hash}</p>
          <p><span className="text-muted-foreground">seed&nbsp;&nbsp;</span>{proof.serverSeed}</p>
          {proof.clientSeeds && proof.clientSeeds.length > 0 && (
            <p><span className="text-muted-foreground">clients&nbsp;</span>{proof.clientSeeds.join(" · ")}</p>
          )}
          <p className="text-muted-foreground">{proof.algorithm}</p>
          {verdict !== null && (
            <p className={`flex items-center gap-1.5 pt-1 text-sm font-extrabold ${verdict ? "text-success" : "text-destructive"}`}>
              {verdict ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
              {verdict ? "VERIFIED — recomputed crash matches the published round" : "MISMATCH — round does not verify"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
