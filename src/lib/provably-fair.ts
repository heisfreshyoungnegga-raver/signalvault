/**
 * Client-side provably-fair crash engine — the exact constructions from the
 * backend, running in the browser via Web Crypto. No server round-trip:
 * the "AI" draws a genuine random crash point locally and publishes the
 * hash so the draw is verifiable, never hand-picked.
 *
 * Aviator (Spribe, verified): SHA-512(serverSeed + 3 client seeds),
 *   first 13 hex chars (52 bits), crash = floor(0.97 / (1 - h) * 100) / 100.
 * SportyHero (reverse-engineered): SHA-256 chain, first 8 hex chars
 *   (32 bits), crash = max(1.00, round(0.97 * 2^32 / (2^32 - decimal), 2)).
 */

export type CrashDrawLocal = {
  crash: number;
  hash: string;
  seed: string;
  clientSeeds: string[];
  variant: "aviator" | "hero32";
};

async function sha512hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** One independent AI crash-point draw, computed locally with real crypto. */
export async function drawCrashLocal(gameId: string, rtp = 0.97): Promise<CrashDrawLocal> {
  const variant = gameId === "sportyhero" ? "hero32" : "aviator";
  const seed = randomHex(16);

  if (variant === "hero32") {
    const hash = await sha256hex(`${seed}:1`);
    const decimal = parseInt(hash.slice(0, 8), 16);
    const crash = Math.max(1.0, Math.round(((rtp * 2 ** 32) / (2 ** 32 - decimal)) * 100) / 100);
    return { crash, hash, seed, clientSeeds: [], variant };
  }

  // aviator: server seed + 3 simulated client seeds (first three bettors)
  const c1 = randomHex(8);
  const c2 = randomHex(8);
  const c3 = randomHex(8);
  const hash = await sha512hex(seed + c1 + c2 + c3);
  const hs = parseInt(hash.slice(0, 13), 16);
  const h = hs / 2 ** 52;
  const crash = Math.max(1.0, Math.floor((rtp / (1 - h)) * 100) / 100);
  return { crash, hash, seed, clientSeeds: [c1, c2, c3], variant };
}
