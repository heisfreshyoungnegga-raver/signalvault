import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Brain,
  KeyRound,
  Quote,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Star,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { userToken } from "@/lib/api";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Aviator is the only crash engine (owner order 2026-11-20).
const GAMES = [
  {
    id: "aviator",
    name: "Aviator",
    image: "/games/aviator.png",
    tag: "Crash",
    blurb: "The legendary red plane — AI times your cash-out to the round.",
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SignalVault — Credits & AI Slip Scan" },
      {
        name: "description",
        content:
          "Four tiers from GH₵250 for 4 credits to GH₵1,000 for 20 credits — every scan or play costs 4 credits, and credits never expire. Plus AI betting-slip scans. Bold calls, made in Ghana.",
      },
      { property: "og:title", content: "SignalVault — Credits & AI Slip Scan" },
      {
        property: "og:description",
        content: "Sign up, top up credits from GH₵250, and play whenever you're ready.",
      },
    ],
  }),
  component: Home,
});

const FEATURES = [
  {
    icon: Wallet,
    title: "Credits never expire",
    text: "Your credits stay in your wallet until you spend them — pay today, play next month, same balance.",
  },
  {
    icon: Smartphone,
    title: "MoMo friendly",
    text: "Ghana pays by Mobile Money transfer, Nigeria by bank transfer. Send the amount, submit your proof, done.",
  },
  {
    icon: KeyRound,
    title: "One account, every game",
    text: "Sign up once — your plans live on your account. Log in anywhere.",
  },
  {
    icon: ShieldCheck,
    title: "One device at a time",
    text: "Your access stays yours. A second login while active is blocked automatically.",
  },
  {
    icon: Brain,
    title: "AI slip analysis",
    text: "Vision AI reads every pick on your slip and returns its own call with reasoning.",
  },
  {
    icon: BadgeCheck,
    title: "Human review",
    text: "Manual payments are checked by real people, usually within minutes.",
  },
];

const REVIEWS = [
  {
    name: "Kwame A.",
    role: "Accra",
    stars: 5,
    text: "Paid with MTN MoMo at 7pm, password came through after review and I was in before kickoff. Clean and fast.",
  },
  {
    name: "Ama D.",
    role: "Kumasi",
    stars: 5,
    text: "The AI scan surprised me. It flagged two picks on my slip I was doubting and explained exactly why.",
  },
  {
    name: "Selorm K.",
    role: "Tema",
    stars: 4,
    text: "One price, no games. Paid GH₵500 for 12 credits on Friday, still had credits left Saturday night.",
  },
  {
    name: "Nana Y.",
    role: "Takoradi",
    stars: 5,
    text: "Simple interface, works perfectly on my phone. The credits wallet on the dashboard is a nice touch.",
  },
  {
    name: "Fatima B.",
    role: "Tamale",
    stars: 5,
    text: "Support approved my receipt in under ten minutes. Password copied straight to my notes.",
  },
  {
    name: "Kojo M.",
    role: "Cape Coast",
    stars: 4,
    text: "Premium scan covered every game on my slip. Worth it for a big accumulator.",
  },
];

const STEPS = [
  ["Sign up", "Name, email, username and password — takes 10 seconds."],
  [
    "Top up",
    "Four tiers — GH₵250 for 4 credits up to GH₵1,000 for 20 credits. Every scan or play costs 4 credits. Everything unlocked.",
  ],
  ["Play", "Jump straight in. Your credits never expire — come back anytime."],
];

/** Smart CTA: logged-in users go straight to the lobby, everyone else to register. */
function HeroCta() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(userToken.get() !== null);
  }, []);
  return (
    <Button asChild size="lg" className="h-13 rounded-full px-7 text-base">
      <Link to={authed ? "/predictor" : "/register"}>
        {authed ? "Open the lobby" : "Get started"} <ArrowRight className="size-4" />
      </Link>
    </Button>
  );
}

/** The credit wallet as a perforated ticket — the product, shown not told. */
function WalletTicket() {
  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-border bg-white shadow-lift" style={{ animationDelay: "120ms" }}>
      <div className="flex">
        {/* ticket stub — vertical kente weave */}
        <div
          className="w-4 shrink-0"
          aria-hidden
          style={{
            background:
              "repeating-linear-gradient(180deg, #E14D2A 0 18px, #2E3A8C 18px 36px, #FBF6EC 36px 48px, #0F766E 48px 60px)",
          }}
        />
        <div className="min-w-0 flex-1 border-l border-dashed border-border-strong p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Your wallet
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-bold text-primary">
              <Wallet className="size-3.5" /> Credit wallet
            </span>
          </div>
          <p className="mt-4 font-mono text-5xl font-semibold tracking-tight text-foreground tabular-nums">
            4–20 <span className="text-2xl">credits</span>
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-primary tabular-nums">From GH₵250</p>
          {/* 4-segment thread bar — one segment per tier */}
          <div className="mt-5 flex gap-1.5" aria-label="Four tiers, 4 to 20 credits">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="h-2.5 flex-1 rounded-full bg-primary" />
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            4 credits per scan or play · Never expires · Top-ups stack
          </p>

          <div className="mt-6 border-t border-dashed border-border pt-5">
            <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Today&apos;s call — sample
            </p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm font-bold">Aviator</p>
              <p className="font-mono text-sm font-semibold text-primary tabular-nums">2.41×</p>
              <p className="font-mono text-sm font-semibold tabular-nums">78%</p>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: "78%" }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Confidence thread — sample call, not a live pick.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() {
  return (
    <div>
      {/* Hero — split, on cream, no photo */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
          <div className="animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-1.5 text-xs font-semibold text-foreground shadow-soft">
              <span className="kente-strip h-[6px] w-6 rounded-full" aria-hidden />
              Made in Ghana · Pay with MoMo
            </span>
            <h1 className="mt-5 text-4xl leading-[1.05] font-black text-foreground sm:text-6xl">
              From GH₵250. <span className="text-primary">Aviator, live.</span> Never expires.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
              SignalVault reads Aviator live — and scans your slip with AI.
              Four tiers from GH₵250 for 4 credits to GH₵1,000 for 20 credits, MoMo or bank transfer. Each scan or play costs 4 credits.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <HeroCta />
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-13 rounded-full border-border bg-white px-7 text-base font-semibold text-foreground shadow-soft hover:border-primary/40 hover:text-primary"
              >
                <Link to="/scan">
                  <ScanLine className="size-4" /> Try the AI slip scan
                </Link>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Star className="fill-warning text-warning size-4" /> 4.9 average rating
              </span>
              <span>2,400+ top-ups sold</span>
            </div>
          </div>

          <WalletTicket />
        </div>
      </section>

      {/* How it works — perforated ticket strip, directly under the hero */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
          <div className="kente-strip h-[6px] w-full" aria-hidden />
          <div className="grid sm:grid-cols-3">
            {STEPS.map(([title, text], i) => (
              <div
                key={title}
                className="flex gap-4 p-6 sm:p-7 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-dashed [&:not(:last-child)]:border-border sm:[&:not(:last-child)]:border-r sm:[&:not(:last-child)]:border-b-0"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-base font-bold">{title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-border bg-background-alt">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-3xl font-bold sm:text-4xl">Why people stick with SignalVault</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="card-surface card-hover animate-rise p-6"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="bg-primary-soft text-primary flex size-11 items-center justify-center rounded-2xl">
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Games we cover */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">The game we cover</h2>
            <p className="text-muted-foreground mt-2">
              AI predictions for Aviator — the one crash engine, live.
            </p>
          </div>
          <Button asChild variant="secondary" className="rounded-full">
            <Link to="/engines">
              Explore engines <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {GAMES.map((g, i) => (
            <Link
              key={g.name}
              to="/engines/$gameId"
              params={{ gameId: g.id }}
              className="card-surface card-hover animate-rise group overflow-hidden"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="relative aspect-square overflow-hidden">
                <img
                  src={g.image}
                  alt={g.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <span className="absolute top-3 left-3 rounded-full border border-border bg-white/90 px-3 py-1 text-[11px] font-bold tracking-wide text-foreground uppercase backdrop-blur">
                  {g.tag}
                </span>
              </div>
              <div className="p-5">
                <h3 className="text-lg font-bold">{g.name}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{g.blurb}</p>
                <p className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-primary">
                  Open live engine <ArrowRight className="size-4" />
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Reviews */}
      <section className="border-y border-border bg-background-alt">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-3xl font-bold sm:text-4xl">What customers say</h2>
          <p className="text-muted-foreground mt-3 max-w-xl">
            Real feedback from people using SignalVault across Ghana.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {REVIEWS.map((r, i) => (
              <figure
                key={r.name}
                className="card-surface card-hover animate-rise flex flex-col p-6"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Quote className="size-7 font-display text-primary" />
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed">{r.text}</blockquote>
                <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                  <span className="gradient-brand text-primary-foreground flex size-10 items-center justify-center rounded-full text-sm font-bold">
                    {r.name.charAt(0)}
                  </span>
                  <figcaption className="min-w-0">
                    <p className="truncate text-sm font-bold">{r.name}</p>
                    <p className="text-muted-foreground text-xs">{r.role}</p>
                  </figcaption>
                  <span className="ml-auto flex gap-0.5">
                    {Array.from({ length: r.stars }).map((_, s) => (
                      <Star key={s} className="fill-warning text-warning size-3.5" />
                    ))}
                  </span>
                </div>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">Questions, answered</h2>
        <Accordion type="single" collapsible className="mt-10">
          {[
            [
              "Do my credits expire?",
              "Never. Credits stay in your wallet until you spend them — pay today, play next month, same balance.",
            ],
            [
              "I lost my password. Can I reset it?",
              "No. The password is shown once, right after payment. If it's lost, ask support — your credits stay on your account.",
            ],
            [
              "Can I buy two packs at once?",
              "Yes. Top-ups stack — buy 12 credits now and 40 more later, and your wallet holds 80.",
            ],
            [
              "How does the AI slip scan work?",
              "You top up credits, submit your payment proof, and once an admin approves it you upload your slip. Each completed scan costs 4 credits — the AI reads every pick and predicts.",
            ],
            [
              "Can I use my credits on two phones?",
              "No. One device at a time — a second login while a session is active is rejected.",
            ],
          ].map(([q, a], i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-b border-border">
              <AccordionTrigger className="text-left text-base font-semibold">{q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed">
                {a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
        <div className="kente-strip mb-0 h-[6px] w-full rounded-t-4xl" aria-hidden />
        <div className="gradient-hero shadow-lift relative overflow-hidden rounded-b-4xl px-6 py-14 text-center sm:px-12 sm:py-20">
          <h2 className="text-3xl font-black text-white sm:text-4xl">Ready when you are</h2>
          <p className="mx-auto mt-4 max-w-lg text-white/85">
            Register in seconds, open the lobby, and top up today — four tiers from GH₵250 for 20
            credits, never expires.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="inline-flex h-13 items-center justify-center rounded-full bg-white px-8 text-base font-bold text-primary transition-colors hover:bg-primary-soft"
            >
              Create my account
            </Link>
            <Link
              to="/manual-payment"
              className="inline-flex h-13 items-center justify-center rounded-full border border-white/60 px-8 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              Manual payment
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
