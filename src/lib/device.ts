/**
 * Lightweight device fingerprint for tying one-time passes to a device.
 * Not a security boundary on its own — combined with the backend record
 * (email + IP + fingerprint) it makes pass-sharing visible.
 */
export async function deviceFingerprint(): Promise<string> {
  try {
    const parts = [
      navigator.userAgent,
      navigator.language,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`,
      String(navigator.hardwareConcurrency ?? ""),
      String((navigator as any).deviceMemory ?? ""),
      new Date().getTimezoneOffset(),
    ];
    const data = new TextEncoder().encode(parts.join("|"));
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  } catch {
    // very old browsers — fall back to a random per-session id
    return "fb-" + Math.random().toString(36).slice(2, 14);
  }
}
