import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { ResultCard, SCAN_RESULT_KEY } from "./scan-slip";
import type { ScanResult } from "@/lib/api";

export const Route = createFileRoute("/scan-result")({
  head: () => ({
    meta: [
      { title: "Scan result — SignalVault" },
      {
        name: "description",
        content: "Your AI scan result, from the slip you just uploaded.",
      },
      { property: "og:title", content: "Scan result — SignalVault" },
    ],
  }),
  component: ScanResultPage,
});

// Dedicated scan result page. It renders ONLY what the AI's finalize
// returned for the slip just uploaded — the scan page stores exactly
// that under SCAN_RESULT_KEY and navigates here. Nothing on this page
// is pre-written: a different slip always gives a different result,
// and with no stored result this page shows its empty state, never a
// sample result.
function ScanResultPage() {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SCAN_RESULT_KEY);
      setResult(raw ? (JSON.parse(raw) as ScanResult) : null);
    } catch {
      setResult(null);
    }
    setLoaded(true);
  }, []);

  return (
    <div>
      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <Link to="/scan-slip" className="text-primary text-sm font-semibold hover:underline">
          ← Back to scan
        </Link>
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
              <Link to="/scan-slip" className="text-primary text-sm font-semibold hover:underline">
                Scan another slip →
              </Link>
            </div>
          </>
        ) : loaded ? (
          <div className="card-surface mt-6 p-6 sm:p-8">
            <p className="font-bold">No scan result yet.</p>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Run a scan first — your result appears here the moment your slip is analysed.
            </p>
            <Link
              to="/scan-slip"
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
