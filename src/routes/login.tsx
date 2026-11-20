import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MaterialIcon } from "@/components/ui/material-icon";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AuthSplash } from "@/components/auth-splash";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoMark } from "@/components/site/Logo";
import { api, ApiError, userToken, type AuthData } from "@/lib/api";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: typeof search["redirect"] === "string" ? search["redirect"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Log in — SignalVault" },
      {
        name: "description",
        content: "Log in with your username and password.",
      },
      { property: "og:title", content: "Log in — SignalVault" },
      {
        property: "og:description",
        content: "Log back in anytime — active plan sessions continue where you left off.",
      },
    ],
  }),
  component: LoginPage,
});

// Every game key the window system governs (mirrors gameWindows).
const KNOWN_GAMES = ["aviator", "mines", "bottle"];

// The lobby's unlocked-tile destinations, reused so resume lands exactly
// where tapping the tile would (waiting page uses the same mapping).
function engineRouteFor(gameId: string): string {
  if (gameId === "mines") return "/predictor/mines";
  if (gameId === "bottle") return "/predictor/bottle";
  return `/predictor/${gameId}`;
}

// Login resume destination for a freshly signed-in account. An explicit
// redirect wins; otherwise last-played active game, else the single
// active window, else the scan tool for scan-only users, else lobby.
function resumeDestination(user: AuthData["user"], redirect?: string): string {
  if (redirect && redirect.startsWith("/")) return redirect;
  const plans = user.plans ?? {};
  const active = Object.keys(plans).filter((g) => KNOWN_GAMES.includes(g));
  const last = user.lastGame;
  if (last && KNOWN_GAMES.includes(last) && plans[last]) return engineRouteFor(last);
  if (active.length === 1) return engineRouteFor(active[0]);
  if (active.length === 0 && user.scanAccess) return "/scan-slip";
  return "/predictor";
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Destination held back until the access splash finishes (null = no splash).
  const [splashTo, setSplashTo] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("darkweb_email");
    if (saved) setUsername(saved);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api<AuthData>("/api/auth/login", {
        method: "POST",
        body: { username: username.trim(), password },
      });
      userToken.set(data.token);
      toast.success(`Welcome back, ${data.user.name.split(" ")[0]}.`);
      // Login resume: an explicit redirect (e.g. an engine page that
      // bounced to login) always wins. Otherwise, take the user
      // DIRECTLY back to their game: last-played game when its window
      // is still active, else the single active window, else the scan
      // tool for scan-only users — never a game they have no window
      // for, never a random pick. No resume case -> the lobby, as
      // before. Access splash first; it hands off to the destination.
      setSplashTo(resumeDestination(data.user, redirect));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        toast.error("Wrong username or password.");
      } else if (err instanceof ApiError && err.status === 403) {
        toast.error(err.message || "This account can't log in right now.");
      } else {
        toast.error(err instanceof Error ? err.message : "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background lg:grid lg:grid-cols-[1fr_1.15fr]">
      {/* Left panel — terracotta, collapses to a short top band on mobile */}
      <aside className="relative overflow-hidden bg-primary px-6 py-8 text-white lg:flex lg:min-h-[100dvh] lg:flex-col lg:justify-center lg:px-12 lg:py-12">
        <div className="kente-strip absolute inset-x-0 top-0 h-[6px]" aria-hidden />
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <LogoMark className="size-12 rounded-2xl" />
          <h2 className="mt-6 font-display text-4xl font-black tracking-tight lg:text-5xl">
            Welcome back.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-white/85">
            One account, every game. Credits from GH₵250 — they never expire.
          </p>
          <ol className="mt-8 hidden space-y-4 lg:block">
            {[
              ["Sign up", "Name, email, username and password."],
              ["Top up", "Credits from GH₵250, MoMo or bank transfer."],
              ["Play", "Every engine and the AI slip scan, 4 credits a play."],
            ].map(([step, text], i) => (
              <li key={step} className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 font-mono text-sm font-bold ring-1 ring-white/30">
                  {i + 1}
                </span>
                <p className="pt-1 text-sm leading-relaxed text-white/90">
                  <span className="font-bold text-white">{step} — </span>
                  {text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      {/* Right — white form card on cream */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-6 lg:py-12">
        <div className="animate-rise card-surface w-full max-w-md p-6 sm:p-8">
          <span className="gradient-brand mb-5 flex size-11 items-center justify-center rounded-2xl">
            <MaterialIcon name="login" className="text-primary-foreground text-[22px]" />
          </span>
          <h1 className="text-3xl font-bold">Welcome back</h1>
          {redirect && redirect.startsWith("/predictor/") ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
              <MaterialIcon name="play_arrow" filled className="mi-badge" />
              <span>Continuing to {redirect.replace("/predictor/", "").replace(/-/g, " ")}</span>
            </p>
          ) : null}
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Enter your username and password. Active plan sessions continue where you left off.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">Username or email</Label>
              <div className="relative">
                <MaterialIcon
                  name="person"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 text-[20px] leading-none -translate-y-1/2"
                />
                <Input
                  id="username"
                  type="text"
                  required
                  className="h-12 rounded-xl pl-11"
                  placeholder="username or you@example.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Temp password</Label>
              <div className="relative">
                <MaterialIcon
                  name="key"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 text-[20px] leading-none -translate-y-1/2"
                />
                <Input
                  id="password"
                  type="password"
                  required
                  className="h-12 rounded-xl pl-11 font-mono"
                  placeholder="aB3xQ9kLmZ"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={loading}
              className="h-12 w-full rounded-xl text-base"
            >
              {loading ? (
                <MaterialIcon name="progress_activity" className="text-[20px] animate-spin" />
              ) : null}
              Log in
            </Button>
          </form>

          <div className="bg-muted text-muted-foreground mt-6 rounded-xl p-4 text-xs leading-relaxed">
            Lost your password? There's no reset. Your current plan has to run out, then you can pay
            again for a fresh password.
          </div>

          <p className="text-muted-foreground mt-6 text-center text-sm">
            No account yet?{" "}
            <Link to="/register" className="text-primary font-semibold hover:underline">
              Register
            </Link>
          </p>
        </div>
      </div>
      {splashTo ? <AuthSplash onDone={() => navigate({ to: splashTo })} /> : null}
    </div>
  );
}
