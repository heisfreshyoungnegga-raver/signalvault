import { useEffect, useState, type ReactNode } from "react";

/**
 * Object URL for a chosen image file, revoked on change/unmount.
 * Lets upload areas show the image itself instead of its filename.
 */
export function useImagePreview(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

// The old looping scan video (public/videos/scan-access.mp4) was retired
// with the old brand. While a staged scan runs, the workspace shows
// a still slip-preview card with a kente-weave progress bar instead —
// no green scan beam, no video element, no console error when the file
// is absent.

/**
 * Still slip-preview card shown while a staged scan runs: the stage
 * label, a thin kente-weave progress bar that fills as the staged
 * analysis runs (transcribe → gapfill → verify → finalise), and a
 * Cancel button. No video, no scan beam.
 */
export function ScanVideo({
  label,
  pct,
  onCancel,
  fallback,
}: {
  label: string;
  pct: number | null;
  onCancel: () => void;
  fallback: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
        <div className="kente-strip h-[6px] w-full" aria-hidden />
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          {fallback}
          <p className="text-sm font-bold text-foreground">{label}</p>
          {pct !== null && (
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
              <div
                className="weave-progress h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            {pct !== null ? `${pct}%` : "Reading your slip…"}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full border border-border bg-white px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        Cancel scan
      </button>
    </div>
  );
}
