import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoMark } from "@/components/site/Logo";
import { adminToken, api } from "@/lib/api";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [
      { title: "Admin login — SignalVault" },
      { name: "description", content: "Staff access to the SignalVault review and referral panel." },
      { property: "og:title", content: "Admin login — SignalVault" },
      { property: "og:description", content: "Staff access to the SignalVault admin panel." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api<{ token: string; role: string; expiresAt: string }>(
        "/api/admin/auth/login",
        { method: "POST", body: { username: username.trim(), password } },
      );
      adminToken.set(data.token, data.role);
      toast.success(`Signed in as ${data.role}`);
      navigate({ to: "/admin" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background lg:grid lg:grid-cols-[1fr_1.15fr]">
      {/* Left panel — indigo: staff door, not the player door */}
      <aside className="relative overflow-hidden bg-secondary px-6 py-8 text-white lg:flex lg:min-h-[100dvh] lg:flex-col lg:justify-center lg:px-12 lg:py-12">
        <div className="kente-strip absolute inset-x-0 top-0 h-[6px]" aria-hidden />
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <LogoMark className="size-12 rounded-2xl" />
          <h2 className="mt-6 font-display text-4xl font-black tracking-tight lg:text-5xl">
            Staff sign in.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-white/85">
            The review desk — manual payments, scan purchases, referrals and commissions.
          </p>
        </div>
      </aside>

      <div className="flex items-center justify-center px-4 py-10 sm:px-6 lg:py-12">
        <form onSubmit={onSubmit} className="animate-rise card-surface w-full max-w-md p-6 sm:p-8">
          <span className="bg-secondary mb-5 flex size-11 items-center justify-center rounded-2xl">
            <ShieldCheck className="text-secondary-foreground size-5" />
          </span>
          <h1 className="text-3xl font-bold">Admin panel</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            For admins and super admins. Super admins can also use their dedicated door.
          </p>
          <p className="mt-3 rounded-xl bg-secondary-soft px-4 py-2.5 text-xs font-semibold text-secondary">
            New admins are created by the super admin.
          </p>

          <div className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="a-user">Username / email</Label>
              <Input
                id="a-user"
                required
                className="h-12 rounded-xl"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-pass">Password</Label>
              <Input
                id="a-pass"
                type="password"
                required
                className="h-12 rounded-xl"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <Button type="submit" size="lg" disabled={loading} className="mt-7 h-12 w-full rounded-xl">
            {loading ? <Loader2 className="size-4 animate-spin" /> : null} Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
