import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { SupportFloat } from "@/components/site/SupportFloat";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-input bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SignalVault — Credits & AI Slip Scan" },
      {
        name: "description",
        content:
          "SignalVault — bold AI calls and slip scans, made in Ghana. Four tiers from GH₵250 for 4 credits to GH₵1,000 for 20 credits — full access to Aviator and AI slip scan, 4 credits per play. Pay by Mobile Money or bank transfer.",
      },
      { name: "author", content: "SignalVault" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      // Brand fonts from Google Fonts: Fraunces (display), DM Sans (body),
      // IBM Plex Mono (amounts). Material Symbols stays self-hosted (f13)
      // — preloaded so its ligature words ("casino", "diamond") never flash
      // as raw text before the glyphs load.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,900&family=DM+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap",
      },
      {
        rel: "preload",
        href: "/fonts/f13.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Deploy-version watcher: a tab opened before a redeploy never refetches
// index.html during in-app navigation, so it would run the old build
// forever. This polls the live document for its boot chunk and reloads
// once when the deployed build changes. Client-only, production-only:
// the effect never runs during SSR, and import.meta.env.PROD is false
// in dev. No service worker, no new endpoints beyond /api/version.
// Boot-chunk-only detection has a hole: a deploy that only touches
// route chunks leaves the boot chunk unchanged, so a long-open tab
// keeps running stale route code against the new API (observed live:
// a sim countdown read 49:54 on a 45-minute window after the reset had
// already landed — new server behavior, old client chunk). The build
// SHA check below closes that hole: it fires on ANY redeploy, not just
// boot-chunk changes.
const DEPLOY_RELOADED_FOR_KEY = "darkweb_deploy_reloaded_for";
const DEPLOY_RELOADED_FOR_BUILD_KEY = "darkweb_deploy_reloaded_for_build";
// Injected at build time by the vite define in vite.config.ts
// (VERCEL_GIT_COMMIT_SHA, 'dev' for local builds).
declare const __APP_BUILD_SHA__: string;

function bootIndexChunk(): string | null {
  const els = document.querySelectorAll('link[rel="modulepreload"], script[src]');
  for (const el of Array.from(els)) {
    const src = el.getAttribute("href") ?? el.getAttribute("src") ?? "";
    const m = src.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
    if (m) return m[0];
  }
  return null;
}

function liveIndexChunk(html: string): string | null {
  const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : null;
}

function DeployVersionWatcher() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const boot = bootIndexChunk();
    if (!boot) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      if (stopped) return;
      try {
        const res = await fetch(window.location.href, { cache: "no-store" });
        if (!res.ok) return;
        const live = liveIndexChunk(await res.text());
        if (live && live !== boot) {
          // Reload once per deployed build: after a reload the boot chunk
          // matches by construction, but if the served HTML is still the
          // old build (propagation lag) the same live hash must never
          // trigger a second reload. A genuinely newer build later still
          // triggers, because its hash differs from the stored one.
          try {
            if (window.sessionStorage.getItem(DEPLOY_RELOADED_FOR_KEY) === live) return;
            window.sessionStorage.setItem(DEPLOY_RELOADED_FOR_KEY, live);
          } catch {
            /* storage unavailable — post-reload boot still matches */
          }
          window.location.reload();
          return;
        }
      } catch {
        /* offline / transient failure — retry on the next trigger */
      }
      // Build-SHA check: catches redeploys the boot chunk cannot see
      // (route-only changes). Both sides must be real 40-hex SHAs —
      // 'dev' on either side (local builds, or a host that does not
      // expose the SHA at runtime) skips the check entirely, so this
      // can never reload-loop and never fires a false reload. Same
      // once-per-SHA guard as the boot-chunk check above.
      try {
        const clientBuild =
          typeof __APP_BUILD_SHA__ === "string" ? __APP_BUILD_SHA__ : "dev";
        if (!/^[0-9a-f]{40}$/i.test(clientBuild)) return;
        const vRes = await fetch("/api/version", { cache: "no-store" });
        if (!vRes.ok) return;
        const vJson = (await vRes.json()) as { data?: { build?: unknown } };
        const serverBuild = vJson?.data?.build;
        if (typeof serverBuild !== "string" || !/^[0-9a-f]{40}$/i.test(serverBuild)) return;
        if (serverBuild === clientBuild) return;
        try {
          if (window.sessionStorage.getItem(DEPLOY_RELOADED_FOR_BUILD_KEY) === serverBuild) return;
          window.sessionStorage.setItem(DEPLOY_RELOADED_FOR_BUILD_KEY, serverBuild);
        } catch {
          /* storage unavailable — post-reload SHAs still match */
        }
        window.location.reload();
      } catch {
        /* offline / transient failure — retry on the next trigger */
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onPageShow = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    timer = setInterval(() => void check(), 5 * 60 * 1000);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      if (timer) clearInterval(timer);
    };
  }, []);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const location = useLocation();
  // Immersive video pages own the whole screen — no site chrome.
  // Aviator is the only immersive video page (owner order 2026-11-20).
  const isImmersive = location.pathname === "/predictor/aviator";

  return (
    <QueryClientProvider client={queryClient}>
      {isImmersive ? (
        <Outlet />
      ) : (
        <div className="flex min-h-screen flex-col">
          <Header />
          <main className="flex-1">
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </main>
          <Footer />
        </div>
      )}
      <Toaster position="top-center" />
      {/* Outside the immersive branch on purpose: support stays
          reachable on engine pages too, which render no Header/Footer. */}
      <SupportFloat />
      <DeployVersionWatcher />
    </QueryClientProvider>
  );
}
