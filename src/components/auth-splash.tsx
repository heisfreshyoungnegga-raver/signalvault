import { useEffect, useRef } from "react";

import { LogoMark } from "@/components/site/Logo";

/**
 * Full-screen "access granted" splash shown for ~3s after a successful user
 * login or registration; onDone hands off to the destination the auth flow
 * was already heading to. Tap/click skips. The kente mark draws itself in
 * on cream — no video. The splash must never trap the user: a hard cap
 * hands off even if the animation never finishes.
 *
 * NOTE: the `src` prop is kept for call-site compatibility (login passes
 * nothing, register used to pass its own clip) but is deliberately unused
 * — the interstitial videos were retired with the old brand.
 */
export function AuthSplash({
  onDone,
  src: _src,
}: {
  onDone: () => void;
  /** Retired: splash clips are no longer used. Kept so old call sites compile. */
  src?: string;
}) {
  const done = useRef(false);

  function finish() {
    if (done.current) return;
    done.current = true;
    onDone();
  }

  useEffect(() => {
    const t = setTimeout(finish, 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] cursor-pointer bg-background"
      onClick={finish}
      role="button"
      aria-label="Skip intro"
    >
      <div className="kente-strip h-[6px] w-full" aria-hidden />
      <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="animate-rise">
          <LogoMark className="size-20" />
        </div>
        <p className="animate-rise font-display text-3xl font-black tracking-tight text-foreground" style={{ animationDelay: "120ms" }}>
          You&apos;re in.
        </p>
        <p className="animate-rise text-sm text-muted-foreground" style={{ animationDelay: "220ms" }}>
          Bold calls, made in Ghana.
        </p>
        <div
          className="weave-progress animate-rise mt-2 h-1.5 w-48 overflow-hidden rounded-full"
          style={{ animationDelay: "300ms" }}
          aria-hidden
        />
      </div>
      <span className="absolute inset-x-0 bottom-8 text-center font-mono text-[11px] tracking-[0.3em] text-muted-foreground uppercase">
        Tap to skip
      </span>
    </div>
  );
}
