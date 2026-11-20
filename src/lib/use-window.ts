import { useEffect, useRef, useState } from "react";

/**
 * Live countdown for a 45-minute access window, derived from the
 * SERVER's expiresAt — so it stays honest across logout/login, device
 * clocks and tab sleeps. Ticks 4×/second; fires onExpire once when the
 * wall clock runs out.
 */
export function useCountdown(
  expiresAt: string | null | undefined,
  onExpire?: () => void,
): number {
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [expiresAt]);

  const secondsLeft = expiresAt
    ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
    : 0;

  useEffect(() => {
    if (expiresAt && secondsLeft === 0 && !firedRef.current) {
      firedRef.current = true;
      expireRef.current?.();
    }
    if (secondsLeft > 0) firedRef.current = false;
  }, [expiresAt, secondsLeft]);

  return secondsLeft;
}

/** mm:ss (or h:mm:ss past an hour) for window countdowns. */
export function formatMmSs(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
