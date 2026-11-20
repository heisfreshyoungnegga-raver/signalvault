import { useCallback, useEffect, useRef, useState } from "react";
import { drawCrashLocal, type CrashDrawLocal } from "@/lib/provably-fair";
import { api, ApiError, adminToken, userToken } from "@/lib/api";

export type RunPhase = "idle" | "drawing" | "flying" | "crashed" | "countdown";

const COUNTDOWN_SECS = 5;

type Soundscape = {
  start: () => void;
  pitch: (m: number) => void;
  thud: () => void;
  stop: () => void;
};

/**
 * Shared run engine for the crash predictor stages. Owns the draw,
 * the multiplier animation loop, history and the next-run countdown.
 * Each game stage only renders `mult` / `phase` in its own visual language.
 *
 * Token order: player engines send the user token first (window gating
 * applies); the superadmin Live games preview passes preferStaffToken so
 * the STAFF token goes first. That matters because neither staff login
 * clears a lingering user token, and `userToken ?? adminToken` would
 * otherwise let a valid-but-windowless (or retired) user token shadow
 * the staff bypass — every preview round then 403s GAME_LOCKED even
 * though the viewer is logged in as staff.
 */
export function useCrashRun(gameId: string, preferStaffToken = false) {
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [mult, setMult] = useState(1);
  const [draw, setDraw] = useState<CrashDrawLocal | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECS);
  const [rtp, setRtp] = useState(0.97);
  const [error, setError] = useState<string | null>(null);
  // Credit balance after the latest round's 5-credit spend (null until
  // the first paid round, or for staff previews which never spend).
  // At 0 the loop stops after the paid round instead of drawing again.
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const creditsLeftRef = useRef<number | null>(null);
  // looping: true for the whole auto-run loop (drawing → flying → crashed
  // linger → countdown → next round), false only when truly idle. The
  // STOP/RUN button keys off this so it never flip-flops mid-loop.
  const [looping, setLooping] = useState(false);

  const activeRef = useRef(false);
  const rafRef = useRef(0);
  const rtpRef = useRef(0.97);
  rtpRef.current = rtp;
  const audioRef = useRef<Soundscape | null>(null);

  /** Audio must never break a run — every call is guarded. */
  const safeAudio = (fn: (a: Soundscape) => void) => {
    try {
      fn(ensureAudio());
    } catch {
      /* audio is decorative; the run continues silently */
    }
  };

  // --- aviation soundscape ---------------------------------------------------
  // Synthesised Aviator-style bed: engine rumble + wind that climb with the
  // multiplier, takeoff whoosh on launch, explosion on crash. All WebAudio,
  // no audio assets.
  const ensureAudio = (): Soundscape => {
    if (!audioRef.current) {
      let ctx: AudioContext | null = null;
      let engine: { src: AudioBufferSourceNode; filt: BiquadFilterNode; g: GainNode } | null = null;
      let wind: { src: AudioBufferSourceNode; filt: BiquadFilterNode; g: GainNode } | null = null;

      const ac = () => {
        if (!ctx) {
          const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AC) ctx = new AC();
        }
        if (ctx?.state === "suspended") void ctx.resume();
        return ctx;
      };
      const noiseBuffer = (c: AudioContext, brown: boolean) => {
        const len = c.sampleRate * 2;
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
          else d[i] = w;
        }
        return buf;
      };

      audioRef.current = {
        start() {
          const c = ac(); if (!c) return;
          this.stop();
          // engine rumble (brown noise, lowpassed)
          const es = c.createBufferSource();
          es.buffer = noiseBuffer(c, true); es.loop = true;
          const ef = c.createBiquadFilter(); ef.type = "lowpass"; ef.frequency.value = 220;
          const eg = c.createGain(); eg.gain.value = 0;
          es.connect(ef); ef.connect(eg); eg.connect(c.destination); es.start();
          engine = { src: es, filt: ef, g: eg };
          eg.gain.linearRampToValueAtTime(0.16, c.currentTime + 1.2);
          ef.frequency.linearRampToValueAtTime(520, c.currentTime + 1.6);
          // wind bed (white noise, bandpassed)
          const ws = c.createBufferSource();
          ws.buffer = noiseBuffer(c, false); ws.loop = true;
          const wf = c.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 700; wf.Q.value = 0.6;
          const wg = c.createGain(); wg.gain.value = 0;
          ws.connect(wf); wf.connect(wg); wg.connect(c.destination); ws.start();
          wind = { src: ws, filt: wf, g: wg };
          wg.gain.linearRampToValueAtTime(0.05, c.currentTime + 1.8);
          // takeoff whoosh
          const whoosh = c.createBufferSource();
          whoosh.buffer = noiseBuffer(c, false);
          const wff = c.createBiquadFilter(); wff.type = "bandpass"; wff.Q.value = 1.4;
          wff.frequency.setValueAtTime(180, c.currentTime);
          wff.frequency.exponentialRampToValueAtTime(2400, c.currentTime + 1.4);
          const wgg = c.createGain();
          wgg.gain.setValueAtTime(0.0001, c.currentTime);
          wgg.gain.exponentialRampToValueAtTime(0.14, c.currentTime + 0.5);
          wgg.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.6);
          whoosh.connect(wff); wff.connect(wgg); wgg.connect(c.destination);
          whoosh.start(); whoosh.stop(c.currentTime + 1.7);
        },
        pitch(m: number) {
          if (!ctx) return;
          const t = ctx.currentTime;
          const k = Math.min(m, 40);
          if (engine) {
            engine.filt.frequency.setTargetAtTime(220 + k * 34, t, 0.08);
            engine.g.gain.setTargetAtTime(0.14 + Math.min(k / 40, 1) * 0.1, t, 0.1);
          }
          if (wind) {
            wind.filt.frequency.setTargetAtTime(700 + k * 55, t, 0.08);
            wind.g.gain.setTargetAtTime(0.04 + Math.min(k / 40, 1) * 0.12, t, 0.1);
          }
        },
        thud() {
          const c = ac(); if (!c) return;
          this.stop();
          // explosion: noise burst collapsing + sub drop
          const n = c.createBufferSource(); n.buffer = noiseBuffer(c, false);
          const nf = c.createBiquadFilter(); nf.type = "lowpass";
          nf.frequency.setValueAtTime(3200, c.currentTime);
          nf.frequency.exponentialRampToValueAtTime(90, c.currentTime + 0.7);
          const ng = c.createGain();
          ng.gain.setValueAtTime(0.28, c.currentTime);
          ng.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.8);
          n.connect(nf); nf.connect(ng); ng.connect(c.destination);
          n.start(); n.stop(c.currentTime + 0.85);
          const o = c.createOscillator(); o.type = "sine";
          o.frequency.setValueAtTime(130, c.currentTime);
          o.frequency.exponentialRampToValueAtTime(28, c.currentTime + 0.6);
          const og = c.createGain();
          og.gain.setValueAtTime(0.22, c.currentTime);
          og.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.7);
          o.connect(og); og.connect(c.destination); o.start(); o.stop(c.currentTime + 0.75);
        },
        stop() {
          try { engine?.src.stop(); } catch { /* noop */ }
          try { wind?.src.stop(); } catch { /* noop */ }
          engine = null; wind = null;
        },
      };
    }
    return audioRef.current;
  };

  const fly = useCallback((target: number) => {
    const start = performance.now();
    const dur = Math.min(4200, 1200 + Math.log10(Math.max(target, 1.01)) * 2600);
    setPhase("flying");
    safeAudio((a) => a.start());
    const tick = (now: number) => {
      if (!activeRef.current) return;
      const p = Math.min(1, Math.max(0, (now - start) / dur));
      const m = Math.min(target, 1 + (target - 1) * Math.pow(p, 2.2));
      if (!Number.isFinite(m)) {
        activeRef.current = false;
        setLooping(false);
        setError("Animation glitch — tap RUN to try again.");
        setPhase("idle");
        return;
      }
      setMult(m);
      safeAudio((a) => a.pitch(m));
      if (p < 1 && m < target) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setMult(target);
        safeAudio((a) => a.thud());
        setHistory((h) => [target, ...h].slice(0, 12));
        setPhase("crashed");
        // hand over to countdown / idle — the effect below decides
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    setLooping(true);
    cancelAnimationFrame(rafRef.current);
    safeAudio((a) => a.stop());
    setError(null);
    setDraw(null);
    setMult(1);
    setPhase("drawing");
    // crypto.subtle needs a secure context — fail loudly, not silently
    if (!window.crypto?.subtle) {
      activeRef.current = false;
      setLooping(false);
      setError("This browser blocked the secure random generator. Try Chrome or Safari.");
      setPhase("idle");
      return;
    }
    // Admin-set custom rounds take priority (both simulator + live users).
    // The backend consumes them FIFO; no custom round means local random.
    // Every /api/rounds/next call is one play = 5 credits (staff previews
    // never spend). Staff previews (superadmin Live games) have no credit
    // gating — send the staff token first so the server's staff bypass
    // applies instead of a 403. Player engines always send the user token
    // first, so their credit gating is unchanged; a logged-out caller
    // still sends null and still gets 403.
    const drawSource: Promise<CrashDrawLocal> = (async () => {
      try {
        const staff = adminToken.get();
        const user = userToken.get();
        const token = preferStaffToken ? (staff ?? user) : (user ?? staff);
        const custom = await api<{ crash?: number; custom?: boolean; creditsLeft?: number } | null>(
          `/api/rounds/next/${gameId}`,
          { token },
        );
        if (custom && typeof custom.creditsLeft === "number") {
          creditsLeftRef.current = custom.creditsLeft;
          setCreditsLeft(custom.creditsLeft);
        }
        if (custom && Number.isFinite(custom.crash) && (custom.crash as number) >= 1) {
          const local = await drawCrashLocal(gameId, rtpRef.current);
          return { ...local, crash: custom.crash as number };
        }
      } catch (err) {
        // An out-of-credits refusal is not "backend unreachable" — stop
        // the loop and say so; the page's out-of-credits overlay takes
        // over. (Treating it as unreachable would fall through to a
        // FREE local draw — the one hole the credit model must not have.)
        if (
          err instanceof ApiError &&
          (err.code === "GAME_LOCKED" || err.code === "GAME_EXPIRED" || err.code === "CREDITS_EXHAUSTED")
        ) {
          if (err.code === "CREDITS_EXHAUSTED") {
            creditsLeftRef.current = 0;
            setCreditsLeft(0);
          }
          throw err;
        }
        // backend unreachable — fall through to local generation
      }
      return drawCrashLocal(gameId, rtpRef.current);
    })();
    drawSource
      .then((d) => {
        if (!activeRef.current) return;
        if (!d || !Number.isFinite(d.crash) || d.crash < 1) throw new Error("bad draw");
        setTimeout(() => {
          if (!activeRef.current) return;
          setDraw(d);
          fly(d.crash);
        }, 1100);
      })
      .catch((err) => {
        if (!activeRef.current) return;
        activeRef.current = false;
        setLooping(false);
        setError(
          err instanceof ApiError && err.code === "CREDITS_EXHAUSTED"
            ? "Out of credits — top up to keep playing."
            : err instanceof ApiError && (err.code === "GAME_LOCKED" || err.code === "GAME_EXPIRED")
              ? "Your access window for this game has ended."
              : "Draw failed — tap RUN to try again.",
        );
        setPhase("idle");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, fly]);

  // next-round countdown: linger on the crash result, then count 5..1 and run again
  useEffect(() => {
    if (phase !== "crashed") return;
    const t = setTimeout(() => {
      setCountdown(COUNTDOWN_SECS);
      setPhase("countdown");
    }, 2600);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      // Credits hit 0 on the round that just ended: the paid round
      // plays out, then the player is out of the game — no next draw.
      if (creditsLeftRef.current === 0) {
        activeRef.current = false;
        setLooping(false);
        setError("Out of credits — top up to keep playing.");
        setPhase("idle");
        return;
      }
      activeRef.current = false; // run() will set it true again
      run();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown, run]);

  useEffect(() => () => {
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    safeAudio((a) => a.stop());
    setLooping(false);
    setPhase("idle");
    setMult(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { phase, mult, draw, history, countdown, rtp, setRtp, error, run, stop, looping, creditsLeft };
}

export type CrashRun = ReturnType<typeof useCrashRun>;
