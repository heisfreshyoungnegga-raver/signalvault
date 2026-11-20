import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MaterialIcon } from "@/components/ui/material-icon";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AuthSplash } from "@/components/auth-splash";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoMark } from "@/components/site/Logo";
import { api, userToken, type AuthData } from "@/lib/api";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create your SignalVault account" },
      {
        name: "description",
        content: "Sign up with your name, email and username, then top up credits from GH₵250.",
      },
      { property: "og:title", content: "Create your SignalVault account" },
      {
        property: "og:description",
        content: "Sign up and unlock every game with credit packs from GH₵250.",
      },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [loading, setLoading] = useState(false);
  // Access splash shows after a successful register, before the lobby.
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setReferralCode(ref);
    if (userToken.get()) navigate({ to: "/predictor" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      const data = await api<AuthData>("/api/auth/register", {
        method: "POST",
        body: {
          name: name.trim(),
          email: email.trim(),
          username: username.trim(),
          password,
          ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}),
        },
      });
      userToken.set(data.token);
      toast.success(`Welcome, ${data.user.name.split(" ")[0]}!`);
      // Access splash first; it hands off to the lobby.
      setShowSplash(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
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
            Your wallet is waiting.
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
          <span className="bg-accent text-accent-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
            <MaterialIcon name="person_add" className="mi-badge" /> Sign up
          </span>
          <h1 className="mt-4 text-3xl font-bold">Create your account</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            One account for everything. After signup, top up credits from GH₵250 — they never
            expire.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="r-name">Full name</Label>
              <div className="relative">
                <MaterialIcon
                  name="person"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 text-[20px] leading-none -translate-y-1/2"
                />
                <Input
                  id="r-name"
                  required
                  autoComplete="name"
                  placeholder="Kwame Mensah"
                  className="h-12 rounded-xl pl-11"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-email">Email address</Label>
              <div className="relative">
                <MaterialIcon
                  name="mail"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 text-[20px] leading-none -translate-y-1/2"
                />
                <Input
                  id="r-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="h-12 rounded-xl pl-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-user">Username</Label>
              <div className="relative">
                <MaterialIcon
                  name="alternate_email"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 text-[20px] leading-none -translate-y-1/2"
                />
                <Input
                  id="r-user"
                  required
                  autoComplete="username"
                  placeholder="kwame"
                  className="h-12 rounded-xl pl-11"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-pass">Password</Label>
              <div className="relative">
                <MaterialIcon
                  name="lock"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 text-[20px] leading-none -translate-y-1/2"
                />
                <Input
                  id="r-pass"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="Min. 6 characters"
                  className="h-12 rounded-xl pl-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-ref">Referral code (optional)</Label>
              <Input
                id="r-ref"
                placeholder="REF-8K3PQZ"
                className="h-12 rounded-xl"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={loading}
              className="h-13 w-full rounded-2xl text-base font-bold"
            >
              {loading ? (
                <MaterialIcon name="progress_activity" className="animate-spin text-[22px]" />
              ) : (
                <MaterialIcon name="arrow_forward" className="text-[22px]" />
              )}
              Create account
            </Button>
          </form>

          <p className="text-muted-foreground mt-6 text-center text-sm">
            Already have an account?{" "}
            <Link to="/login" className="text-primary font-bold hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
      {showSplash ? (
        <AuthSplash onDone={() => navigate({ to: "/predictor" })} />
      ) : null}
    </div>
  );
}
