import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { ResultCard, SIM_SCAN_RESULT_KEY } from "./simulator.scan-slip";
import { adminToken, type SimScan } from "@/lib/api";

export const Route = createFileRoute("/simulator/scan-result")({
  component: SimScanResultPage,
});

// Dedicated simulator scan result page, mirroring the real one: it
// renders ONLY what sim finalize returned for the slip just uploaded —
// the sim scan page stores exactly that under SIM_SCAN_RESULT_KEY and
// navigates here. Nothing on this page is pre-written: a different
// slip always gives a different result, and with no stored result this
// page shows its empty state, never a sample result. Staff-only, like
// the rest of the simulator: anyone else is sent to superadmin login.
function SimScanResultPage() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [result, setResult] = useState<SimScan | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = adminToken.get();
    if (!t || adminToken.role() !== "SUPER_ADMIN") {
      navigate({ to: "/superadmin/login" });
      return;
    }
    setAllowed(true);
    try {
      const raw = window.localStorage.getItem(SIM_SCAN_RESULT_KEY);
      setResult(raw ? (JSON.parse(raw) as SimScan) : null);
    } catch {
      setResult(null);
    }
    setLoaded(true);
  }, [navigate]);

  if (allowed !== true) return null;

  return (
    <div>
      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <Link
          to="/simulator/scan-slip"
          className="text-primary text-sm font-semibold hover:underline"
        >
          ← Back to scan
        </Link>
        <div className="mt-4 rounded-2xl border border-secondary/30 bg-secondary-soft px-4 py-3 text-sm font-bold text-secondary">
          SIMULATION — practice play only. No real money, no real credits.
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">Scan result</h1>
        {loaded && result ? (
          <>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed sm:text-base">
              Every pick below came from the AI&apos;s read of the slip you just uploaded —
              nothing here is pre-written, and a different slip gives a different result.
              {result.credits != null && (
                <> This scan cost 5 credits — you have {result.credits.balance} left.</>
              )}
            </p>
            <div className="mt-6">
              <ResultCard result={result} />
            </div>
            <div className="mt-6">
              <Link
                to="/simulator/scan-slip"
                className="text-primary text-sm font-semibold hover:underline"
              >
                Scan another slip →
              </Link>
            </div>
          </>
        ) : loaded ? (
          <div className="mt-6 rounded-2xl border border-primary/15 bg-card p-6 sm:p-8">
            <p className="font-bold">No scan result yet.</p>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Run a scan first — your result appears here the moment your slip is analysed.
            </p>
            <Link
              to="/simulator/scan-slip"
              className="text-primary mt-4 inline-block text-sm font-semibold hover:underline"
            >
              Go to scan →
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
