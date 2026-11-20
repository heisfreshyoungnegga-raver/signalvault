# TIERS PORT MAP — single 30-credit GH₵400 pack → four-tier ladder

- **Source (original SignalVault, four tiers):** `~/workspace/darkweb-rebrand/signalvault/` — read-only
- **Target (second SignalVault, single pack):** `~/workspace/darkweb-rebrand/rebrand2/` — read-only
- **Prince's order:** "Make him start with 250ghc, 300ghc, 500ghc then 1000ghc"
- **Scope of this map:** read-only mapping only. No files were edited, nothing deployed.
- **Headline verdict: the expected tier table MATCHES the source code exactly — no mismatch.** Every figure below is quoted from source code. The traps are not in the table; they are in the legacy fallback, the NG repricing, and the three separate plan catalogues (see §7).

Conventions: `SRC = ~/workspace/darkweb-rebrand/signalvault/`, `TGT = ~/workspace/darkweb-rebrand/rebrand2/`. Line numbers were read 2026-11-20 from the work copies on disk.

---

## 1. TIER TABLE — verified against source code ✅ (no mismatch)

Single source of truth in the source is `SRC lib/services/credits.js:44-49` (`PACKS`):

```js
const PACKS = [
  { code: 'STARTER', credits: 20, priceGhs: 250, priceNgn: 47000 },
  { code: 'STANDARD', credits: 25, priceGhs: 300, priceNgn: 56000 },
  { code: 'PREMIUM', credits: 40, priceGhs: 500, priceNgn: 94000 },
  { code: 'VAULT', credits: 80, priceGhs: 1000, priceNgn: 188000 },
];
```

| Tier | GH₵ | Credits | NGN | Uses (÷5) |
|---|---|---|---|---|
| STARTER | 250 | 20 | 47,000 | 4 |
| STANDARD | 300 | 25 | 56,000 | 5 |
| PREMIUM | 500 | 40 | 94,000 | 8 |
| VAULT | 1,000 | 80 | 188,000 | 16 |

- **5 credits/use, never expire, stack** — `SRC lib/services/credits.js:1-22` header:
  > "Every use costs 5 credits: one completed slip scan, one crash round, one bottle spin, one mines game… Credits NEVER expire and top-ups STACK on the balance."
  `COST_PER_USE = 5` (`SRC lib/services/credits.js:66`, same value in TGT `lib/services/credits.js:39` — do not change).
- **Default tier is PREMIUM (GH₵500 / 40), not STARTER** — `SRC lib/services/credits.js:50-51`:
  ```js
  /** Default tier: GH₵500 / 40 credits (what packCredits etc. report). */
  const DEFAULT_PACK = PACKS[2];
  ```
  Consequence: after the port, `credits.summary()` reports `packCredits: 40, packPriceGhs: 500, packPriceNgn: 94000` (see §2/§3). Any client that reads `packCredits` as "the pack" silently changes from 30 → 40.
- **The same ladder is mirrored in three other source files — all four must be ported together or prices disagree:**
  1. `SRC lib/util.js:87-98` (`PLAN`) — see §3.
  2. `SRC lib/util.js:109-119` (`SCAN_PLAN`) — scan buys are the same ladder under `SCAN_250/300/500/1000` codes.
  3. `SRC lib/services/funds.js:18-31` (`PLAN_NAIRA`) and `:39-51` (`SCAN_PLAN_NAIRA`) — NGN mirror.
  4. `SRC src/lib/api.ts:307-313` (`CREDIT_PACKS`) + `CREDIT_PACK` (`:314-319`, the 40/500/94,000 default) — frontend mirror.
- **Legacy 30-credit pack is NOT deleted in the source — it survives as a proportional fallback.** `SRC lib/services/credits.js:56-64`:
  ```js
  const PACK_CREDITS = 30;
  /** Ghana legacy pack price, cedis. */
  const PACK_PRICE_GHS = 400;
  /** Nigeria legacy pack price, naira. */
  const PACK_PRICE_NGN = 75000;
  ```
  Header comment (`SRC lib/services/credits.js:14-18`): "Legacy in-flight rows still earn on the OLD single-pack ratio (GH₵400 / NGN 75,000 → 30 credits): GH₵800 earns 60, GH₵550 earns 41, NGN 75,000 earns 30 — see creditsForPayment()." **Keep these three constants in the target; the simulator also grants `PACK_CREDITS` (see §6).**

---

## 2. PLANS ENDPOINTS

### 2a. `GET /api/payment/plans` — manual-payment catalogue

**Source — `SRC api/index.js:341-353` (public, no auth):**

```js
app.get('/api/payment/plans', h(async (req, res) => {
  // Credit-pack catalogue — the manual-payment page's plan picker reads
  // this route. Four tiers (2026-11-17): GH₵250 → 20, GH₵300 → 25,
  // GH₵500 → 40, GH₵1,000 → 80 credits (NGN 47,000 / 56,000 / 94,000 /
  // 188,000). The pricing page's per-game passes live at
  // /api/plans/catalogue below; the two catalogues are different products
  // and must not share a route.
  const list = Object.values(PLAN).map((p) => ({
    plan: p.name, code: p.code, hours: p.hours, amountCedis: p.amountCedis,
    credits: p.credits, priceGhs: p.amountCedis, priceNgn: p.amountNgn,
  }));
  res.json(ok('Available plans', list));
}));
```

Returns 4 items, shape per item: `{ plan, code, hours, amountCedis, credits, priceGhs, priceNgn }`. `PLAN` is imported from `lib/util.js` (see §3).

**Target — `TGT api/index.js:340-346` (public, no auth):**

```js
app.get('/api/payment/plans', h(async (req, res) => {
  // Subscription catalogue — the manual-payment page's plan picker reads
  // this route. The pricing page's per-game passes live at
  // /api/plans/catalogue below; the two catalogues are different products
  // and must not share a route.
  const list = Object.values(PLAN).map((p) => ({ plan: p.name, hours: p.hours, amountCedis: p.amountCedis }));
  res.json(ok('Available plans', list));
}));
```

Returns 1 item (`PREMIUM`, 400) with only `{ plan, hours, amountCedis }` — **no `code`, `credits`, `priceGhs`, `priceNgn` fields**. Port = replace the mapper with the source mapper verbatim (once `PLAN` in `TGT lib/util.js` has the four tiers, the mapper needs no other change). Route, auth (none), and envelope (`ok('Available plans', list)`) are identical — only the mapper and the underlying `PLAN` differ.

### 2b. `GET /api/scan/payment/plans` — scan-buy catalogue: TIERS in the source, single pack in the target

**Source — `SRC api/index.js:1884-1889` (public, no auth):**

```js
app.get('/api/scan/payment/plans', h(async (req, res) => {
  const list = Object.values(SCAN_PLAN).map((p) => ({
    code: p.code, name: p.name, amountCedis: p.amountCedis, maxPicks: p.maxPicks < 0 ? 'FULL' : p.maxPicks,
  }));
  res.json(ok('Available AI scan plans', list));
}));
```

Returns **4 tiers** (codes `SCAN_250`/`SCAN_300`/`SCAN_500`/`SCAN_1000`, names `STARTER`/`STANDARD`/`PREMIUM`/`VAULT`, amounts 250/300/500/1000, all `maxPicks: 'FULL'`). It does **not** return a single pack. Note the shape carries **no credits and no NGN price** — the frontend derives both client-side via `creditsForAmountGhs()` / `nairaForScanCode()` in `SRC src/lib/api.ts:322-338` (see §4).

**Target — `TGT api/index.js:1844-1849`:** byte-identical handler code, but `SCAN_PLAN` in `TGT lib/util.js:103-107` has only one entry:

```js
PREMIUM: { name: 'PREMIUM', code: 'SCAN_550', amountCedis: 400, maxPicks: -1 },
```

so it returns 1 item (`SCAN_550`, PREMIUM, 400, FULL). **No handler change needed — porting `SCAN_PLAN` in `lib/util.js` fixes this endpoint automatically.** Same applies to `POST /api/scan/payment/submit` (both files, same code): it accepts whatever `scanPlanFromCode()` resolves, so new codes start working once `SCAN_PLAN` is ported.

### 2c. The third catalogue the task did not name but the port must include: `GET /api/plans/catalogue`

**This is the endpoint `/pricing` actually reads** (both codebases — see §4). It is *not* `/api/payment/plans`.

- Source — `SRC api/index.js:362-365`:
  ```js
  app.get('/api/plans/catalogue', h(async (req, res) => {
    // Per-game predictor passes (Bronze/Silver/Gold) for the pricing page.
    res.json(ok('Available game passes', skyPayments.plansCatalogue()));
  }));
  ```
- Target — `TGT api/index.js:358-361`: identical handler. The difference is inside `skyPayments.plansCatalogue()`:
  - Source `SRC lib/services/skyPayments.js:25-33,82-94`:
    ```js
    /** The credit-pack catalogue — mirrors the frontend's PLAN_FALLBACK
     * and credits.js PACKS. FOUR TIERS (2026-11-17): GH₵250 → 20 credits,
     * GH₵300 → 25, GH₵500 → 40, GH₵1,000 → 80 (NGN 47,000 / 56,000 /
     * 94,000 / 188,000). Legacy 'PREMIUM' rows (old GH₵400 pack) still
     * resolve — their stored amount drives the credit grant. */
    const GAME_PLANS = {
      STARTER: { plan: 'STARTER', amountCedis: 250 },
      STANDARD: { plan: 'STANDARD', amountCedis: 300 },
      PREMIUM: { plan: 'PREMIUM', amountCedis: 500 },
      VAULT: { plan: 'VAULT', amountCedis: 1000 },
    };
    ```
    ```js
    function plansCatalogue() {
      const minutes = gameWindows.windowMinutes();
      const { PACKS } = require('./credits');
      const { nairaPriceForPlan } = require('./funds');
      return Object.values(GAME_PLANS).map((p) => ({
        plan: p.plan,
        minutes,
        hours: minutes / 60,
        amountCedis: p.amountCedis,
        credits: (PACKS.find((t) => t.code === p.plan) || {}).credits ?? null,
        priceNgn: nairaPriceForPlan(p.plan),
      }));
    }
    ```
    Returns 4 items with `credits` + `priceNgn` attached.
  - Target `TGT lib/services/skyPayments.js:25-28,76-84`:
    ```js
    /** The credit-pack catalogue — mirrors the frontend's PLAN_FALLBACK.
     * 30 credits for GH₵400 (was the GH₵800 Premium time pass). */
    const GAME_PLANS = {
      PREMIUM: { plan: 'PREMIUM', amountCedis: 400 },
    };
    ```
    ```js
    function plansCatalogue() {
      const minutes = gameWindows.windowMinutes();
      return Object.values(GAME_PLANS).map((p) => ({
        plan: p.plan,
        minutes,
        hours: minutes / 60,
        amountCedis: p.amountCedis,
      }));
    }
    ```
    Returns 1 item, no `credits`/`priceNgn`. **Port `GAME_PLANS` + the `plansCatalogue()` body (the two `require` lines + the two extra fields).** If this is missed, `/pricing` still shows one pack even after `PLAN` is ported, because pricing never calls `/api/payment/plans`.

### 2d. `GET /api/credits/balance` — shape change is automatic but visible

Both: `SRC api/index.js:1163-1175`, `TGT api/index.js:1123-1135` — same handler, `res.json(ok('Credit balance', credits.summary(balance)))`. The shape changes via `credits.summary()`:

- Source `SRC lib/services/credits.js:147-157`:
  ```js
  function summary(balance) {
    return {
      balance: Number(balance) || 0,
      costPerUse: COST_PER_USE,
      // Default tier (GH₵500 / 40 credits) — old clients read these.
      packCredits: DEFAULT_PACK.credits,
      packPriceGhs: DEFAULT_PACK.priceGhs,
      packPriceNgn: DEFAULT_PACK.priceNgn,
      // Full tier list for new clients.
      packs: PACKS.map((p) => ({ ...p })),
    };
  }
  ```
- Target `TGT lib/services/credits.js:121-129`: same minus `packs`, with `packCredits: PACK_CREDITS` (30), `packPriceGhs: 400`, `packPriceNgn: 75000`.
- Frontend type must gain the optional field — source `SRC src/lib/api.ts:340-346`:
  ```ts
  export type CreditSummary = {
    balance: number; costPerUse: number; packCredits: number;
    packPriceGhs: number; packPriceNgn: number;
    packs?: { code: string; credits: number; priceGhs: number; priceNgn: number }[];
  };
  ```
  Target `TGT src/lib/api.ts:302-307` lacks `packs?`. Additive — old clients ignore it.

---

## 3. GRANT LOGIC — full path, source vs target

### 3a. The tier enums (the actual port surface, backend)

**`lib/util.js` — `PLAN` (manual-payment plans):**

Source `SRC lib/util.js:87-98`:
```js
const PLAN = {
  // FOUR TIERS (2026-11-17) — mirrors credits.js PACKS (same codes,
  // credits, GH₵ + NGN prices). `hours` is legacy bookkeeping only;
  // access is governed by the credit wallet now, not by time.
  // Legacy 'PREMIUM' rows (old GH₵400 pack) still resolve here — their
  // stored amount drives the credit grant, so they still earn 30.
  STARTER: { name: 'STARTER', code: 'STARTER', amountCedis: 250, amountNgn: 47000, credits: 20, hours: 24 },
  STANDARD: { name: 'STANDARD', code: 'STANDARD', amountCedis: 300, amountNgn: 56000, credits: 25, hours: 24 },
  PREMIUM: { name: 'PREMIUM', code: 'PREMIUM', amountCedis: 500, amountNgn: 94000, credits: 40, hours: 24 },
  VAULT: { name: 'VAULT', code: 'VAULT', amountCedis: 1000, amountNgn: 188000, credits: 80, hours: 24 },
};
```
Target `TGT lib/util.js:86-91`:
```js
const PLAN = {
  // CREDIT PACK (2026-11-06): 30 credits for GH₵400 — replaces the old
  // GH₵800 Premium time pass. `hours` is legacy bookkeeping only; access
  // is governed by the credit wallet now, not by time.
  PREMIUM: { name: 'PREMIUM', code: 'PREMIUM', amountCedis: 400, hours: 24 },
};
```
Note the source `PLAN` entries carry `amountNgn` + `credits` fields the target entry lacks; `planFromCode()` (`SRC lib/util.js:99-107`, `TGT lib/util.js:93-101`) is identical logic and needs no change — it matches on `code` or `name`, case-insensitive, and throws `400 'Unknown plan: …'` otherwise.

**`lib/util.js` — `SCAN_PLAN` (scan buys):**

Source `SRC lib/util.js:109-119`:
```js
const SCAN_PLAN = {
  // FOUR TIERS (2026-11-17): a scan buy is a credit pack now — same
  // ladder as PLAN (GH₵250 → 20 credits … GH₵1,000 → 80); each
  // completed scan spends 5. Codes SCAN_250/300/500/1000 replace the
  // legacy SCAN_550 code; legacy 'PREMIUM' rows still resolve (their
  // stored amount drives the grant, so they still earn 30).
  STARTER: { name: 'STARTER', code: 'SCAN_250', amountCedis: 250, maxPicks: -1 },
  STANDARD: { name: 'STANDARD', code: 'SCAN_300', amountCedis: 300, maxPicks: -1 },
  PREMIUM: { name: 'PREMIUM', code: 'SCAN_500', amountCedis: 500, maxPicks: -1 },
  VAULT: { name: 'VAULT', code: 'SCAN_1000', amountCedis: 1000, maxPicks: -1 },
};
```
Target `TGT lib/util.js:103-107`:
```js
const SCAN_PLAN = {
  // CREDIT PACK (2026-11-06): a scan buy is 30 credits for GH₵400 now;
  // each completed scan spends 5. Code SCAN_550 is legacy data, kept.
  PREMIUM: { name: 'PREMIUM', code: 'SCAN_550', amountCedis: 400, maxPicks: -1 },
};
```
`scanPlanFromCode()` is identical in both (also falls back to matching on `amountCedis` as a string). **Warning:** after the port, a client submitting the bare amount `"400"` will no longer resolve (no tier costs 400); `"250"/"300"/"500"/"1000"` will. Old `SCAN_550` code stops resolving — legacy rows already stored keep working because approval reads the stored amount, not the code (see §3c).

**`lib/services/funds.js` — NGN tables (used for NG grants + commission + reports):**

Source `SRC lib/services/funds.js:18-31` (`PLAN_NAIRA`): `TWO_HOUR: 20000, THREE_HOUR: 40000, FIVE_HOUR: 60000` (unchanged legacy rows — keep) plus:
```js
  STARTER:   47000,
  STANDARD:  56000,
  PREMIUM:   94000,
  VAULT:     188000,
```
Target `TGT lib/services/funds.js:18-26`: same legacy rows plus only `PREMIUM: 75000`.

Source `SRC lib/services/funds.js:39-51` (`SCAN_PLAN_NAIRA`): `BASIC: 20000` plus `STARTER: 47000, STANDARD: 56000, PREMIUM: 94000, VAULT: 188000`. Target `TGT lib/services/funds.js:34-40`: `BASIC: 20000, STANDARD: 40000, PREMIUM: 75000`. Note the source comment: the old `STANDARD: 40000` entry is **retired** — `STANDARD` is now a tier name (NGN 56,000). `SCAN_SESSION_PLAN_NAIRA` is identical in both — do not touch.

### 3b. Payment submit — plan selection + amount validation

There are **three submit rails**, all with the same shape: the client sends a **plan code only — never an amount**. The server resolves the code to a plan and stores the plan's catalogue amount. **Neither codebase validates the paid amount server-side against the tier** (there is no amount in the request to validate, and the screenshot is never OCR'd/checked — the admin eyeballs it; the admin reject reason in `TGT src/routes/admin.index.tsx:129` is literally `"Screenshot doesn't match the amount"`).

**Rail 1 — manual subscription: `POST /api/payment/manual/submit` → `manualPayment.submit()`**
- Route: `SRC api/index.js:385-394`, `TGT api/index.js:379-388` — identical (destructures `{ email, plan, … }`, passes through).
- `SRC lib/services/manualPayment.js:82-130` vs `TGT lib/services/manualPayment.js:71-118`: identical except one non-tier difference — the source has an identity bridge (if the buyer has no legacy account row but has a site account, it creates the legacy row carrying their referral code) that the target lacks (target throws `409 'Cannot submit payment: … is not registered yet.'`). Flag for the implementer; not tier logic, do not silently drop or add without a decision.
- Key lines (both): `const plan = planFromCode(planCode);` then the INSERT stores the amount:
  ```js
  INSERT INTO manual_payments (id, email, plan, … status, amount_cedis)
  VALUES (…, ${plan.name}, …, 'PENDING', ${countryForManualSubmission(networkOrBank.trim()) === 'GH' ? plan.amountCedis : null})
  ```
  So **GH rows store the tier amount (250/300/500/1000 after port); NG rows store `amount_cedis = NULL`** and are priced from `funds.js` at approve/report time. `plan` stored is the plan *name* (`STARTER` etc.).

**Rail 2 — per-game pass (pricing page): `POST /api/plans/pay/init` → `skyPayments.initPass()`**
- Route: `SRC api/index.js:434-446`, `TGT api/index.js:428-440` — identical.
- `SRC lib/services/skyPayments.js:136-168` vs `TGT lib/services/skyPayments.js:126-158`: identical except the plan table. `const planDef = GAME_PLANS[String(plan || '')]; if (!planDef) throw new ApiError('Unknown plan: ' + plan, 400);` then INSERT into `game_passes` stores `planDef.amountCedis` as `amount` and `country === 'NG' ? 'NGN' : 'GHS'` as `currency`. Again: code in, catalogue amount out; no amount validation.

**Rail 3 — scan buy: `POST /api/scan/payment/submit` → `scanPurchase.submit()`**
- Route: `SRC api/index.js:1891-1900`, `TGT api/index.js:1851-1860` — identical. `scanPurchase.js` is **byte-identical between source and target** (verified by diff) — it resolves via `scanPlanFromCode()` and stores `plan.amountCedis` for GH, NULL for NG. Its behaviour changes purely because `SCAN_PLAN` + `creditsForPayment` + `SCAN_PLAN_NAIRA` change underneath it.

### 3c. Admin approval → credit grant (this is where the 30 becomes 20/25/40/80)

All three rails share one grant primitive: `credits.grantCredits(email, earned, { reason, ref })` writing `credit_balances` (upsert-add, so top-ups stack) + `credit_ledger` (dedupe on `ref`, so a double-approval cannot double-credit). Grant code itself (`SRC lib/services/credits.js:212-252`, `TGT lib/services/credits.js:165-205`) is identical. What differs is **`creditsForPayment()`**, which converts *amount actually paid* → credits:

Source `SRC lib/services/credits.js:184-201`:
```js
function creditsForPayment({ currency, amountGhs, amountNgn }) {
  if (currency === 'NGN') {
    const paid = Number(amountNgn);
    if (Number.isFinite(paid) && paid > 0) {
      const exact = PACKS.find((p) => p.priceNgn === paid);
      if (exact) return exact.credits;
      return Math.max(1, Math.round((paid / PACK_PRICE_NGN) * PACK_CREDITS));
    }
    return DEFAULT_PACK.credits;
  }
  const paid = Number(amountGhs);
  if (Number.isFinite(paid) && paid > 0) {
    const exact = PACKS.find((p) => p.priceGhs === paid);
    if (exact) return exact.credits;
    return Math.max(1, Math.round((paid / PACK_PRICE_GHS) * PACK_CREDITS));
  }
  return DEFAULT_PACK.credits;
}
```
Target `TGT lib/services/credits.js:152-161`: same structure but **no exact-tier branch** — always `Math.round((paid / 400) * 30)`, fallback `PACK_CREDITS` (30). So today GH₵500 → `round(500/400*30)` = 38 (not 40), GH₵250 → 19 (not 20), GH₵1000 → 75 (not 80). **Porting `PACKS` + this function is what makes approval grant the tier amounts.**

**Mismatched-amount behaviour (source, and target after port — same code path):**
- Exact tier amount (GH₵250/300/500/1000; NGN 47,000/56,000/94,000/188,000) → exact tier credits (20/25/40/80).
- Anything else positive → proportional legacy fallback `round(paid / 400 × 30)`, minimum 1. E.g. GH₵800 → 60, GH₵550 → 41, NGN 75,000 → 30. This is deliberate (in-flight rows paid before the cutover).
- No/NULL amount → default tier credits (source 40, target today 30). This is the NG-manual path only if `nairaPriceForPlan()` returns null — it cannot for a valid tier plan, but it **can** for a legacy plan name with no NGN entry.
- **There is no rejection for a wrong amount.** A user who picks VAULT but pays GH₵250 gets whatever the stored amount says (1000 → 80) unless the admin spots the screenshot mismatch and rejects. The grant is best-effort: all three approve functions wrap it in try/catch with a comment "a credit failure must never roll back an approval".

**Per-rail approval call sites (identical structure, different tier inputs):**

| Rail | Approve fn | Grant call | Admin route |
|---|---|---|---|
| Manual | `SRC lib/services/manualPayment.js:153-207` / `TGT lib/services/manualPayment.js:141-193` | `:175-180` SRC / `:161-166` TGT: `creditsForPayment({ currency: country==='NG'?'NGN':'GHS', amountGhs: payment.amountCedis, amountNgn: country==='NG' ? nairaForManual(payment.plan) : null })` → `grantCredits(payment.email, earned, { reason: 'MANUAL', ref: 'MANUAL_' + payment.id })`. Preceded by `account.assignSubscription(payment.email, plan)` (`:162` SRC / `:150` TGT) and followed by `commission.recordIfReferred('MANUAL_'+id, …, amount, …, currency)` where `amount` = NG: `nairaPriceForPlan(plan)`, GH: `storedOrLegacyGhs(payment.amountCedis, payment.plan)`. | `POST /api/admin/manual-payments/:id/approve` (`SRC api/index.js:965-966`, `TGT api/index.js:925-926`) |
| Pricing pass | `SRC lib/services/skyPayments.js:204-258` / `TGT lib/services/skyPayments.js:194-247` | `:235-240` SRC / `:224-229` TGT: same `creditsForPayment` call on `pass.amount` / `pass.currency`, `reason: 'PASS'`, `ref: 'MANUAL_PASS_' + id`. **Target-only bug to fix in the port:** TGT `:226` passes `nairaForPass('PREMIUM')` and TGT `:240` (commission) passes `nairaPriceForPlan('PREMIUM')` — hardcoded `'PREMIUM'` instead of `pass.plan`. Source `:237` / `:251` pass `pass.plan`. After the port the hardcoded `'PREMIUM'` would grant/report every NG pass at 94,000/40 regardless of tier. | `POST /api/admin/game-passes/:id/approve` (`SRC api/index.js:1000-1001`, `TGT api/index.js:960-961`) |
| Scan | `lib/services/scanPurchase.js:356-390` — **identical file in both** | `:380-385`: `creditsForPayment({ currency, amountGhs: purchase.amountCedis, amountNgn: scanCountry==='NG' ? nairaPriceForScanPlan(purchase.scanPlan) : null })` → `grantCredits(purchase.email, earned, { reason: 'SCAN', ref: 'SCAN_' + purchase.id })`. Status flips to APPROVED *before* the grant. | `POST /api/admin/scan-purchases/:id/approve` (`SRC api/index.js:1072-1073`, `TGT api/index.js:1032-1033`) |

All three also funnel through the combined queue `lib/services/manualDeposits.js` (identical in both; `approve(source, id, admin)` at `:134-142` delegates to the rail's own approve). Route: `POST /api/admin/manual-deposits/:source/:id/approve` (`SRC api/index.js:1027-1028`, `TGT api/index.js:987-988`). No tier logic of its own — but see the `NG_SCAN_AMOUNT` trap in §7.

**What exactly differs in the target today (grant path, summary):** the *plumbing* (submit → store plan amount → approve → `creditsForPayment` → `grantCredits` with `ref` dedupe) is already identical; only the *tables* differ (`PACKS` absent, `PLAN`/`SCAN_PLAN`/`GAME_PLANS` single-entry, `PLAN_NAIRA`/`SCAN_PLAN_NAIRA` single-entry, `creditsForPayment` proportional-only, `summary()` no `packs`, default 30). A pure table port + the two hardcoded-`'PREMIUM'` fixes in `skyPayments.js` is the whole backend change. No new tables, no migration (see §7).

### 3d. Frontend tier helpers that the grant path depends on (client-side mirror)

`SRC src/lib/api.ts` (target lacks all of these):
- `Plan` type (`SRC :112-121`): `{ plan, hours, minutes?, amountCedis, credits?, priceNgn? }`. Target `TGT src/lib/api.ts:112`: `{ plan: string; hours: number; minutes?: number; amountCedis: number }` — no `credits`/`priceNgn`.
- `CREDIT_PACKS` (`SRC :302-313`, quoted in §1) + `CREDIT_PACK` default 40/500/94,000 (`SRC :314-319`).
- `creditsForAmountGhs()` (`SRC :321-326`), `creditsForTierCode()` (`SRC :327-332`), `nairaForScanCode()` (`SRC :333-338`) — exact-match lookups over `CREDIT_PACKS`, returning `null` on no match (callers fall back to `?? 30`).
- `PLAN_FALLBACK` (`SRC :348-353`): four entries with `credits` + `priceNgn`. Target `TGT :309`: `[{ plan: "PREMIUM", hours: 0.75, minutes: 45, amountCedis: 400 }]`.
- `SCAN_PLAN_FALLBACK` (`SRC :355-360`): `SCAN_250/300/500/1000`. Target `TGT :311-313`: `[{ code: "SCAN_550", name: "PREMIUM", amountCedis: 400, maxPicks: "FULL" }]`.
- `planLabel()` (`SRC :372-373`): maps `STARTER/STANDARD/PREMIUM/VAULT` → Starter/Standard/Premium/Vault. Target `TGT :325-326`: only `PREMIUM` (+ legacy `MIN15/HOUR1/HOUR3`).
- `SCAN_PLAN_DISPLAY` (`SRC :377-383`): `SCAN_250/300/500/1000` → Starter/Standard/Premium/Vault, tagline "Full Coverage Scan". Target `TGT :330-333`: only `SCAN_550` (+ `SESSION_550`).
- USD reference comment: source `GHS 500 → ≈ $43.07`; target `TGT src/lib/api.ts:318`: `GHS 400 → ≈ $34.46` (rate `GHS_USD_RATE = 0.086145` unchanged).

---

## 4. FRONTEND PICKERS

### 4a. `src/routes/pricing.tsx` — the top-up page (reads `/api/plans/catalogue`, NOT `/api/payment/plans`)

**Source — `SRC src/routes/pricing.tsx` (546 lines):**
- Meta (`:44-54`): `"Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80. Every scan or play costs 5 credits — every engine, credits never expire."`
- Guest-browsable by design (`:104-112`, comment quoted verbatim):
  ```tsx
  // Guests can BROWSE the packs freely — this is the shop window. Only
  // the purchase itself needs an account: subscribe() below sends
  // logged-out visitors to /login (with redirect back here). Do NOT
  // auto-redirect on mount: the old gate bounced every logged-out
  // visitor to /login within seconds, so nobody could read the prices.
  ```
  No mount redirect. On 401 from `["me"]`, it clears the token and **stays on the page as a guest** (`:120-131`). A guest banner (`:341-360`) offers Log in / Register with `redirect: "/pricing…"`. Only `subscribe()` (`:185-236`) redirects to login when `!token`, and only after the game check.
- Data (`:133-149`): `useQuery(["plans"], () => api<Plan[]>("/api/plans/catalogue"))`, `placeholderData: PLAN_FALLBACK`. Selection: URL `?plan=` wins, then explicit choice, then `plans[0]` (default `"PREMIUM"` fallback — after port, first plan is STARTER; source keeps `"PREMIUM"` as the literal fallback string, so the default shown pre-fetch is still the PREMIUM fallback entry, but post-fetch the first catalogue entry wins only if no preselect/choice exists — check ordering when porting).
- Tier picker (`:267-302`) — a 2-column card grid, one card per plan:
  ```tsx
  {/* Four tiers — tap a card to pick it. GH₵1,000 (Vault) is best value. */}
  <div className="mb-6 grid grid-cols-2 gap-3">
    {plans.map((p) => {
      const credits = p.credits ?? creditsForAmountGhs(p.amountCedis) ?? 30;
      const best = p.plan === "VAULT";
      const active = selectedPlan === p.plan;
      …
      <p>{credits} <span>credits</span></p>
      <p>GHS {p.amountCedis}</p>
      <p>NGN {(p.priceNgn ?? 0).toLocaleString()} · {Math.floor(credits / 5)} uses</p>
      // + "Best value" badge when best
  ```
- Amount card (`:318-340`): NGN from `selectedPlanObj.priceNgn`, GHS from `amountCedis`, `usdApprox()` under GH; sub-line `"{credits} credits — 5 credits per scan or play · {uses} uses per pack · never expires"`.
- Hero (`:247-253`): game-aware — `"{credits} credits unlocks {gameName} — and every other game plus AI slip scans…"` or `"Four tiers, no subscriptions, no auto-renew: GH₵250 for 20 credits up to GH₵1,000 for 80. Every scan or play costs 5 credits."`
- Submit (`:185-236`): requires a game (`!game` → toast + navigate to `/predictor`); uploads screenshot via `downscaleImage(file)` then `POST /api/plans/pay/init { game, plan, … }`; on success navigates to `/payment/waiting?rail=pricing&id=…`. Button (`:465-473`): `Submit proof for {credits} credits` (or `"Log in to submit proof"` when logged out). Pending panel (`:479-484`): `"Your {credits} credits land on approval."` Success toast (`:181`): `` `${creditsForAmountGhs(status?.amount) ?? 30} credits added — entering …!` ``; success subtitle (`:261`): same dynamic credits.
- Footer trio (`:520-540`): `"Four tiers. Full stop."` / `"GH₵250 for 20 credits up to GH₵1,000 for 80 (NGN 47,000–188,000 in Nigeria) — every game, every scan, best value on Vault."` + `"5 credits a play"` + `"Never expires"`.
- **No 1-2-3 steps block in the source pricing page** (the target added one — see §5).

**Target — `TGT src/routes/pricing.tsx` (517 lines):**
- Meta (`:42-53`): `"30 credits for GH₵400. Every scan or play costs 5 credits — every engine, no tiers, no upsells."`
- **Redirects logged-out visitors to login — the opposite of the source.** Mount effect (`:103-107`):
  ```tsx
  useEffect(() => {
    if (!token)
      navigate({ to: "/login", search: { redirect: "/pricing" + (game ? `?game=${game}` : "") } });
  }, []);
  ```
  Plus a second redirect on 401 (`:120-126`). There is **no guest banner**. To mirror the source, delete/replace both effects with the source's stay-as-guest behaviour (and keep the `subscribe()`-time login redirect — the target's `subscribe()` (`:184-229`) currently has **no** `!token` check at all, because the mount gate made it unreachable; the source's `subscribe()` check at `SRC :186-189` must be restored).
- Picker (`:260-282`): **no card grid** — a `Select` dropdown rendered **only if `plans.length > 1`**, so with today's single plan there is no picker at all:
  ```tsx
  {plans.length > 1 && (
    <div className="mb-6 space-y-2">
      <Label htmlFor="pp-plan">Plan</Label>
      <Select value={selectedPlan} onValueChange={setPlanChoice}>
        …
        {plans.map((p) => (
          <SelectItem key={p.plan} value={p.plan}>
            30 credits — GHS {p.amountCedis}
          </SelectItem>
        ))}
  ```
  Replace with the source's 2-column card grid (or keep a dropdown — but then the "Best value on Vault" badge, per-tier NGN, and uses-per-pack have nowhere to live; the source grid is the reference).
- Amount card (`:296-315`): NGN hardcoded `"NGN 75,000"` (`:302`), credits hardcoded `30 credits — 5 credits per scan or play · 6 uses per pack · never expires` (`:308-309`).
- Hero (`:240-246`): `"30 credits unlocks {gameName} — …"` / `"One pack only: 30 credits. Every scan or play costs 5 credits. No tiers, no subscriptions, no auto-renew."`
- 1-2-3 steps (`:318-346`, target-only block): Send / Submit proof / Approved — wording is tier-neutral ("Transfer the amount to the details below") and can stay, but it does not exist in the source; keep or drop is a design call, not a tier requirement.
- Submit button (`:442`): `"Submit proof for 30 credits"` (no logged-out variant). Pending (`:454`): `"Your 30 credits land on approval."` Toast (`:178`): `` `30 credits added — entering …!` ``. Success subtitle (`:254`): `"30 credits added to your wallet — …"`.
- Footer trio (`:496-497`): `"One pack. Full stop."` / `"30 credits for GH₵400 (NGN 75,000 in Nigeria) — every game, every scan, no tiers."`
- Non-tier divergence to leave alone unless told otherwise: target uploads the raw `file` (`:210`: `upForm.set("image", file)`); source downscales first (`SRC :210`: `upForm.set("image", await downscaleImage(file))`, import `SRC :32`). The target also lacks `src/lib/image.ts` entirely (only in source). Do not port the downscaler as part of the tier change.

### 4b. `src/routes/manual-payment.tsx` — the manual top-up page (reads `/api/payment/plans`)

**Source — `SRC src/routes/manual-payment.tsx` (472 lines):**
- Data (`:55-64`): `useState("PREMIUM")` default plan; `useQuery(["plans"], () => api<Plan[]>("/api/payment/plans"), placeholderData: PLAN_FALLBACK)`; `selectedPlan = plans.find((p) => p.plan === plan) ?? plans[0]`.
- Gating: **form-gated, not redirect** — hero, plan select, country tabs, and amount stay visible to guests; only the form is gated (`formGated = !token || !!meError`, `:93`). Same in the target — **no change needed here**.
- Hero (`:106-109`): `"Four tiers, from GH₵250 for 20 credits to GH₵1,000 for 80 — pick your pack below. Each scan or play costs 5 credits, and credits never expire. Ghana pays by Mobile Money transfer, Nigeria by bank transfer. Both are reviewed manually — send the amount, submit your proof, and we confirm it."`
- Plan select (`:118-126`): `<SelectItem>` label `"{p.credits ?? \"?\"} credits — GHS {p.amountCedis}"` + `" · Best value"` when `p.plan === "VAULT"`.
- Amount line (`:147-163`): NGN from `selectedPlan.priceNgn` (`NGN ${(selectedPlan.priceNgn ?? 0).toLocaleString()}`), GHS from `amountCedis`; sub-line `"{selectedPlan.credits ?? \"?\"} credits, 5 per scan or play"` + `" · Best value"` on VAULT.
- Submit (`:252-280`): screenshot via `downscaleImage(file)` → `POST /api/upload` → `POST /api/payment/manual/submit { email: me.email, plan, … }` → `/payment/waiting?rail=manual&id=…`. (Target `:247-273` is the same minus downscale; the plan field sent is the selected plan code.)
- How-it-works (`:294-312` source): plain numbered list, step 3 `"Our team reviews it and releases your one-time password here."` Target (`:287-313`) restyled to numbered circles, step 3 `"Our team reviews it and the credits land in your wallet."` — tier-neutral; the source's "one-time password" line is stale relative to the credit wallet (target's is the correct post-credits wording — do not "restore" the source line).

**Target — `TGT src/routes/manual-payment.tsx` (473 lines):** same structure; differences are only the hardcoded pack strings:
- Hero (`:105-107`): `"One pack: 30 credits for GH₵400 (NGN 75,000 in Nigeria). …"`
- Select (`:123`): `"30 credits — GHS {p.amountCedis}"` (no Best-value suffix).
- Amount (`:150-152`): `"NGN 75,000"` hardcoded for Nigeria; `"· 30 credits, 5 per scan or play"`.

### 4c. `src/routes/scan.tsx` — the scan-buy picker (reads `/api/scan/payment/plans`)

Same pattern, third surface. Source `SRC src/routes/scan.tsx`:
- Meta (`:59`): `"Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80. Each AI slip scan costs 5 credits — credits never expire."`
- Plan `<select>` (`:374-381`): `"{creditsForAmountGhs(p.amountCedis) ?? 30} credits — {NGN nairaForScanCode(p.code) or GHS amount}"` + `" · Best value"` when `p.code === "SCAN_1000"`.
- Checklist line (`:176`): `"{credits} credits — {uses} scans per pack, 5 credits each"`.
- Amount card (`:405-415`): NGN via `nairaForScanCode(selectedPlan.code)`; `"{credits} credits — each completed scan costs 5 · credits never expire · {scanPlanTagline(selectedPlan)}"`.
- Target `TGT src/routes/scan.tsx`: `:171` `"30 credits — 6 scans per pack, 5 credits each"`; `:367` `"30 credits — {NGN 75,000 or GHS …}"`; `:394` `"NGN 75,000"` hardcoded; `:401` `"30 credits — each completed scan costs 5 · …"`. **Port these four spots to the source expressions** (they need `creditsForAmountGhs` + `nairaForScanCode` from §3d).

### 4d. `src/routes/payment.waiting.tsx` — waiting screen (dynamic in source, hardcoded in target)

- Source `SRC src/routes/payment.waiting.tsx:45-48`: `pricing: { label: "Credit top-up", … }` (target `:45`: `pricing: { label: "30 credits", … }`).
- Source `:272`: `{creditsForAmountGhs(data.amount) ?? 30} credits added — entering {data.game}.` / `:277`: `{creditsForTierCode(data.scanPlan) ?? 30} credits added — your slip scanner is ready.` Target `:270/:275`: hardcoded `"30 credits added — …"`. Needs the two helpers imported (`SRC :11-12` imports `creditsForAmountGhs, creditsForTierCode`; target `:12` imports only `scanPlanLabel`).

---

## 5. COPY SWEEP — every single-pack string in the TARGET frontend

Grep basis (target `src/` + `lib/`): `"30 credits"`, `"GH₵400"`, `"GHS 400"`, `"NGN 75,000"`, `"75000"`, `"One pack"`, `"Get 30"`, `"Top up 30"`, `"no tiers"`. "400" alone was excluded as noise (colour/width values). Each row: target location + current text → what the source says in the equivalent place (or "no source equivalent — rebrand-original copy, invent tier wording from the source's pricing/index wording").

### Must change — buy-flow surfaces (user will pay the wrong amount if missed)

| # | Target file:line | Current text | Source equivalent |
|---|---|---|---|
| 1 | `src/routes/pricing.tsx:46,51` (meta) | `"30 credits for GH₵400. Every scan or play costs 5 credits — every engine, no tiers, no upsells."` | `SRC pricing.tsx:48,53`: `"Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80. Every scan or play costs 5 credits — every engine, credits never expire."` |
| 2 | `src/routes/pricing.tsx:77` (comment) | `"The top-up page — one pack, 30 credits, same price for every game."` | `SRC pricing.tsx:79-81`: `"The top-up page — four credit tiers, same price for every game."` |
| 3 | `src/routes/pricing.tsx:178` (toast) | `` `30 credits added — entering …!` `` | `SRC :181`: `` `${creditsForAmountGhs(status?.amount) ?? 30} credits added — entering …!` `` |
| 4 | `src/routes/pricing.tsx:244-245` (hero) | `"30 credits unlocks {gameName} — …"` / `"One pack only: 30 credits. Every scan or play costs 5 credits. No tiers, no subscriptions, no auto-renew."` | `SRC :251-252`: `"{credits} credits unlocks {gameName} — …"` / `"Four tiers, no subscriptions, no auto-renew: GH₵250 for 20 credits up to GH₵1,000 for 80. Every scan or play costs 5 credits."` |
| 5 | `src/routes/pricing.tsx:254` (success) | `"30 credits added to your wallet — each scan or play costs 5. …"` | `SRC :261`: dynamic `creditsForAmountGhs(status?.amount) ?? 30` version |
| 6 | `src/routes/pricing.tsx:270` (picker) | `"30 credits — GHS {p.amountCedis}"` | `SRC :267-302` card grid (see §4a) |
| 7 | `src/routes/pricing.tsx:302` (amount) | `"NGN 75,000"` (hardcoded) | `SRC :327`: `` `NGN ${(selectedPlanObj.priceNgn ?? 0).toLocaleString()}` `` |
| 8 | `src/routes/pricing.tsx:308-309` | `"30 credits — 5 credits per scan or play · 6 uses per pack · never expires"` | `SRC :334-335`: dynamic credits + `{Math.floor(credits/5)} uses per pack` |
| 9 | `src/routes/pricing.tsx:442` (submit btn) | `"Submit proof for 30 credits"` | `SRC :470`: `` `Submit proof for {credits} credits` `` (+ `"Log in to submit proof"` when logged out) |
| 10 | `src/routes/pricing.tsx:454` (pending) | `"Your 30 credits land on approval."` | `SRC :483`: `"Your {credits} credits land on approval."` |
| 11 | `src/routes/pricing.tsx:496-497` (footer) | `"One pack. Full stop."` / `"30 credits for GH₵400 (NGN 75,000 in Nigeria) — every game, every scan, no tiers."` | `SRC :526-527`: `"Four tiers. Full stop."` / `"GH₵250 for 20 credits up to GH₵1,000 for 80 (NGN 47,000–188,000 in Nigeria) — every game, every scan, best value on Vault."` |
| 12 | `src/routes/manual-payment.tsx:105-107` (hero) | `"One pack: 30 credits for GH₵400 (NGN 75,000 in Nigeria). …"` | `SRC manual-payment.tsx:106-109`: `"Four tiers, from GH₵250 for 20 credits to GH₵1,000 for 80 — pick your pack below. …"` |
| 13 | `src/routes/manual-payment.tsx:123` (select) | `"30 credits — GHS {p.amountCedis}"` | `SRC :124`: `"{p.credits ?? \"?\"} credits — GHS {p.amountCedis}"` + `" · Best value"` on VAULT |
| 14 | `src/routes/manual-payment.tsx:150,152` (amount) | `"NGN 75,000"` / `"· 30 credits, 5 per scan or play"` | `SRC :153,157-158`: `priceNgn`-driven NGN / `"{credits} credits, 5 per scan or play"` + Best-value on VAULT |
| 15 | `src/routes/scan.tsx:56` (meta) | `"One pack: 30 credits. Each AI slip scan costs 5 credits — credits never expire."` | `SRC scan.tsx:59`: `"Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80. Each AI slip scan costs 5 credits — credits never expire."` |
| 16 | `src/routes/scan.tsx:171` | `"30 credits — 6 scans per pack, 5 credits each"` | `SRC scan.tsx:176`: dynamic `"{credits} credits — {uses} scans per pack, 5 credits each"` |
| 17 | `src/routes/scan.tsx:367` (plan option) | `"30 credits — {NGN 75,000 or GHS …}"` | `SRC :374-378`: `creditsForAmountGhs` + `nairaForScanCode(p.code)`, Best-value on `SCAN_1000` |
| 18 | `src/routes/scan.tsx:394,401` (amount) | `"NGN 75,000"` / `"30 credits — each completed scan costs 5 · …"` | `SRC :408,415`: `nairaForScanCode(selectedPlan.code)` / dynamic credits |
| 19 | `src/routes/scan-slip.tsx:26` (meta) | `"One pack: 30 credits. Each AI slip scan costs 5 credits — credits never expire."` | `SRC scan-slip.tsx:26`: `"Credit packs from GH₵250. Each AI slip scan costs 5 credits — credits never expire."` |
| 20 | `src/routes/scan-slip.tsx:318` | `"Top up 30 credits →"` | `SRC :318`: `"Top up credits →"` |
| 21 | `src/routes/scan-slip.tsx:398` | `"One pack = 30 credits. Each completed scan costs 5 credits — failed or …"` | `SRC :398`: `"Credit packs from GH₵250. Each completed scan costs 5 credits — failed or cancelled scans cost nothing."` |
| 22 | `src/routes/payment.waiting.tsx:45` | `pricing: { label: "30 credits", … }` | `SRC :47`: `pricing: { label: "Credit top-up", … }` |
| 23 | `src/routes/payment.waiting.tsx:270,275` | `"30 credits added — entering {data.game}."` / `"30 credits added — your slip scanner is ready."` | `SRC :272,277`: `creditsForAmountGhs(data.amount) ?? 30` / `creditsForTierCode(data.scanPlan) ?? 30` versions |

### Must change — marketing / entry surfaces (wrong price shown pre-purchase)

| # | Target file:line | Current text | Source equivalent |
|---|---|---|---|
| 24 | `src/routes/__root.tsx:91` (site meta description) | `"SignalVault — bold AI calls and slip scans, made in Ghana. 30 credits for GH₵400 — full access to every game engine and AI slip scan, 5 credits per play. Pay by Mobile Money or bank transfer."` | `SRC __root.tsx:91`: `"SignalVault is the predictor vault. Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80 — full access to every game engine and AI slip scan, 5 credits per play. Pay by Mobile Money or bank transfer."` |
| 25 | `src/routes/index.tsx:64,69` (meta) | `"30 credits for GH₵400 — every scan or play costs 5 credits, and credits never expire. …"` / `"Sign up, top up 30 credits, and play whenever you're ready."` | `SRC index.tsx:64,69`: `"Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80 — every scan or play costs 5 credits, and credits never expire. …"` / `"Sign up, top up credits from GH₵250, and play whenever you're ready."` |
| 26 | `src/routes/index.tsx:126` (testimonial) | `"One price, no games. Paid GH₵400 for 30 credits on Friday, still had credits left Saturday night."` | `SRC index.tsx:126`: `"One price, no games. Paid GH₵500 for 40 credits on Friday, still had credits left Saturday night."` |
| 27 | `src/routes/index.tsx:152` (steps: Top up) | `"One pack only — 30 credits for GH₵400. Every scan or play costs 5 credits. Everything unlocked."` | `SRC index.tsx:151-152`: `"Top up"` / `"Four tiers — GH₵250 for 20 credits up to GH₵1,000 for 80. Every scan or play costs 5 credits. Everything unlocked."` |
| 28 | `src/routes/index.tsx:166` (hero CTA) | `{authed ? "Open the lobby" : "Get 30 credits"}` | `SRC index.tsx:166`: `{authed ? "Enter casino" : "Get started"}` — source CTA does not name a pack; target's "Get 30 credits" is rebrand-original. Safest port: `"Get started"` (source) or `"Top up credits"` (tier-neutral). |
| 29 | `src/routes/index.tsx:196-200` (wallet ticket card) | `"30 credits"` / `"GH₵400"` / 6-segment bar (`aria-label="6 plays in a pack, 5 credits each"`) | `SRC index.tsx:192-197,222,232`: hero `"From GH₵250. Every engine. Never expires."` + `"Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80, …"` + marquee `"GH₵250–1,000 · 20–80 CREDITS · ALL ENGINES"` + `"20–80 credits — from GH₵250"`. The source has **no wallet ticket card** — the target card is rebrand-original; rework it to a tier range (e.g. "20–80 credits / From GH₵250", segments = 4/5/8/16 uses per tier, not a fixed 6). |
| 30 | `src/routes/index.tsx:241,245` (hero) | `"30 credits. Every engine. Yours to keep."` / `"GH₵400 for 30 credits, MoMo or bank transfer. Each scan or play costs 5 credits."` | `SRC index.tsx:192,197`: `"From GH₵250. Every engine. Never expires."` / `"Four tiers from GH₵250 for 20 credits to GH₵1,000 for 80, MoMo or bank transfer. Each scan or play costs 5 credits."` |
| 31 | `src/routes/index.tsx:415` (FAQ) | `"Yes. Top-ups stack — buy 30 credits now and 30 more later, and your wallet holds 60."` | `SRC index.tsx:396`: `"Yes. Top-ups stack — buy 40 credits now and 40 more later, and your wallet holds 80."` (source uses the default PREMIUM tier as the example) |
| 32 | `src/routes/index.tsx:442-443` (closing CTA) | `"Register in seconds, open the lobby, and top up today — one pack, GH₵400 for 30 credits, never expires."` | `SRC index.tsx:424-425`: `"Register in seconds, enter the vault, and top up today — four tiers from GH₵250 for 20 credits, never expires."` |
| 33 | `src/routes/dashboard.tsx:145` | `<Link to="/pricing">Top up 30 credits — GH₵400</Link>` | No source equivalent — the source dashboard (`SRC src/routes/dashboard.tsx`, 171 lines) contains no pack copy at all (verified by grep). Use tier-neutral `"Top up credits"` or `"Top up from GH₵250"`. |
| 34 | `src/routes/dashboard.tsx:198` | `"One pack — 30 credits for GH₵400. Top-ups stack and never expire."` | No source equivalent (same as #33). Suggested: `"Four tiers — 20 to 80 credits, from GH₵250. Top-ups stack and never expire."` |
| 35 | `src/routes/login.tsx:124,129` | `"One account, every game. 30 credits for GH₵400 — they never expire."` / `["Top up", "30 credits for GH₵400, MoMo or bank transfer."]` | No source equivalent — source login has no pack copy (verified by grep). Suggested: `"…credits from GH₵250 — they never expire."` / `"Top up", "Credits from GH₵250, MoMo or bank transfer."` |
| 36 | `src/routes/register.tsx:19,89,94,119` | Meta `"…then top up 30 credits for GH₵400."` / `"One account, every game. 30 credits for GH₵400 — they never expire."` / `["Top up", "30 credits for GH₵400, MoMo or bank transfer."]` / `"After signup, top up 30 credits for GH₵400 — they never …"` | No source equivalent — source register has no pack copy. Same "from GH₵250" treatment as #35. |
| 37 | `src/components/site/Header.tsx:97` | `"Get 30 credits"` (header CTA) | `SRC Header.tsx:49`: `"Get access"` — source CTA is pack-neutral. Port to `"Get access"` or `"Top up credits"`. |
| 38 | `src/components/site/Footer.tsx:14` | `"One pack, 30 credits, AI calls and slip scans — built for Ghana. …"` | `SRC Footer.tsx:13-15`: `"Timed access passes and AI betting-slip analysis, built for Ghana. Pay with Mobile Money, get in, get value."` (source footer is stale pre-credits wording — do not copy verbatim; use e.g. `"Four tiers, AI calls and slip scans — built for Ghana. …"`) |

### Should change — out-of-credits / game-gate copy (states a pack size that will not exist)

| # | Target file:line | Current text | Source equivalent |
|---|---|---|---|
| 39 | `src/components/window-ui.tsx:161,169` | `"…Top up 30 credits to jump straight back in."` / button `"Top up 30 credits"` | `SRC window-ui.tsx:155-156,164`: `"…Top up to jump straight back in."` / `"Top up credits"` |
| 40 | `src/components/predictor/crash/CrashPredictor.tsx:161` | `"Top up 30 credits"` (button) | `SRC CrashPredictor.tsx:163`: `"Top up credits"` |
| 41 | `src/components/predictor/crash/useCrashRun.ts:281,309` | `"Out of credits — top up 30 credits to keep playing."` | `SRC useCrashRun.ts:281,309`: `"Out of credits — top up to keep playing."` |
| 42 | `src/components/predictor/MinesBoard.tsx:118` | `"Out of credits — top up 30 credits to keep playing."` | `SRC MinesBoard.tsx:118`: `"Out of credits — top up to keep playing."` |
| 43 | `lib/services/credits.js:45` (API error string, surfaced to clients) | `'Out of credits. Buy 30 credits to keep playing — each scan or play costs 5 credits.'` | `SRC lib/services/credits.js:71`: `'Out of credits. Top up credits to keep playing — each scan or play costs 5 credits.'` |

### Backend / shared constants with the same strings (change with the code port, §3)

| # | Target file:line | Current text |
|---|---|---|
| 44 | `src/lib/api.ts:120` (comment) | `/* Account model: signup -> credit wallet (30 credits per GH₵400 pack, 5 per scan/play). … */` → source `SRC api.ts:120-122` names the four tiers. |
| 45 | `src/lib/api.ts:292-297` | `CREDIT_PACK = { credits: 30, priceGhs: 400, priceNgn: 75000, costPerUse: 5 }` → source `SRC :314-319` is 40/500/94,000. Plus add `CREDIT_PACKS` + the three helpers (§3d). |
| 46 | `src/lib/api.ts:309,311-313` | `PLAN_FALLBACK` single PREMIUM/400; `SCAN_PLAN_FALLBACK` single `SCAN_550`/400 → source four-entry versions (§3d). |
| 47 | `src/lib/api.ts:318` (comment) | `"GHS 400 → ≈ $34.46"` → source: `"GHS 500 → ≈ $43.07"` (same rate). |
| 48 | `lib/services/credits.js:4,32-37,149` | Header + `PACK_CREDITS/PACK_PRICE_*` comments describing the single pack → source header (§1). **Keep the constants** (legacy fallback + simulator); only the prose + `summary()` + `creditsForPayment()` change. |
| 49 | `lib/services/gameWindows.js:2` (comment) | `"2026-11-06: 30 credits for GH₵400 / NGN 75,000, 5 credits per play"` — comment-only; no code change. Source equivalent wording is the four-tier header. |
| 50 | `lib/services/scanPurchase.js:5-6` (comment) | `"grants credits to the wallet … 30 credits for GH₵400 / NGN 75,000 (in-flight GH₵800 rows earn 60)"` — **this stale comment exists in the SOURCE too** (`SRC scanPurchase.js:5-6`, identical file). Comment-only; fix the prose in both or leave — it does not affect behaviour. |
| 51 | `lib/services/manualPayment.js:155` (comment) | `"a fresh GH₵400 / NGN 75,000 pack earns 30"` → source `:169-174` tier comment. Comment-only. |
| 52 | `lib/services/skyPayments.js:26,219` (comment) | `"30 credits for GH₵400 …"` → source `:25-29` + `:223-228` tier comments. Comment-only. |
| 53 | `lib/services/simulator.js:171,223,230` | `"The amount is the real credit-pack price (GH₵400; …"` / `"approval grants 30 sim credits"` / `grantSimCredits(…, credits.PACK_CREDITS, …)` — **see §6: simulator is 30/400 in the SOURCE as well. Do not change; needs a Prince decision.** |

### Deliberately NOT in the sweep — simulator surfaces (identical 30/400 copy in the source; out of tier scope unless Prince orders it)

`TGT src/routes/simulator.payment.tsx:202,261,287`; `simulator.scan-slip.tsx:348,456`; `simulator.scan.tsx:204,419,450`; `simulator.waiting.tsx:35,76,194-195,229`; `TGT lib/services/simulator.js:171,201,223,230` (see #53). The source has the same strings at the same lines (verified: `SRC simulator.*` diff is empty). Porting tiers there would diverge from the source — flag to Prince instead of silently including it.

### "Unlocks" grep — no additional hits
The task's `"unlocks"` pattern hits only `TGT pricing.tsx:244` (row #4 above). `"Get 30 credits"` hits only `index.tsx:166` (#28) and `Header.tsx:97` (#37).

---

## 6. WHAT NOT TO TOUCH

### Recipient — CONFIRMED, target-only, must stay
- `TGT lib/services/settings.js:106-116` (`PAYMENT_DETAILS_DEFAULTS`):
  ```js
  const PAYMENT_DETAILS_DEFAULTS = {
    ghana: {
      accountName: 'KINSMAN SUSU VENTURES-SEKONDI',
      momoNumber: '0541568542',
    },
    nigeria: {
      bankName: 'Access Bank',
      accountNumber: '1945116494',
      receiverName: 'Amadi Victor Chinaemeze',
    },
  };
  ```
  Source is different (`SRC lib/services/settings.js:108-116`: `THERESAH MENSAH` / `0509620668` / `network: 'Telecel Cash'`, same Nigeria account). **Do not copy the source recipient.** The Ghana `network` field is also target-absent by design (`TGT settings.js:146` picks only `['accountName', 'momoNumber']`; `TGT src/lib/api.ts:246` type has no `network`; fallback `TGT api.ts:251`: `ghana: { accountName: "KINSMAN SUSU VENTURES-SEKONDI", momoNumber: "0541568542" }`). The tier port must not re-add `network`.
- The receiving-details endpoint itself (`GET /api/payment/details`, `SRC/TGT api/index.js:349-352` / `:347-350`) and `SendPaymentToCard` are tier-agnostic — untouched.

### ImgBB upload path — target-only, must stay (do NOT port the source's replacement)
- Target still uses ImgBB: `TGT api/index.js:462-466`:
  ```js
  app.post('/api/upload', upload.single('image'), h(async (req, res) => {
    const key = String(process.env.IMGBB_API_KEY || '').trim();
    if (!key) throw new ApiError('Image upload is not configured. Add IMGBB_API_KEY to the Vercel Production environment and redeploy.', 503);
  ```
- Source replaced it with self-hosted Neon-DB uploads (`SRC api/index.js:465-505`, `POST /api/upload` stores in an `uploads` table and returns `/api/uploads/<id>`; comment: ImgBB key "was never set — so every buyer hit 'Image upload is not configured'"). The task brief says the target's ImgBB path must stay, and the target's `MEMORY.md` entry says the full pay→play flow still awaits an IMGBB key. **Do not port the source upload code as part of the tier change** — it is a separate, larger migration (new table + route + all form callers). Note only that the tier port does not depend on which upload backend is used: both `pricing.tsx` and `manual-payment.tsx` just need `up.url`.

### Virtuals — shared credit wallet, must not break
> **2026-11-20 (owner order) — SUPERSEDED:** the virtual-football
> betting game described below was **removed** from SignalVault
> (`api/virtuals.js`, `lib/services/virtuals.js`,
> `src/routes/virtuals.tsx`, `src/lib/virtuals-api.ts` deleted;
> `/api/virtuals/*` now 404s). "Instant Virtuals" is now only dark
> web's AI slip-scan front door (lobby tile → `/scan`). The notes
> below are history of the removed game, not live code — do not
> re-add it from this map.
- Virtuals spend/grant through the same wallet the tiers feed: `SRC/TGT lib/services/virtuals.js:18-19` ("Min stake 5 credits; stake spent via `credits.spendAmount` (ref `VIRTUAL_STAKE_<betId>`), wins paid via `credits.grantCredits`"), `:406` (win payout `grantCredits`), `:639` (`spendAmount(key, nStake, …)`), `:650` (refund `grantCredits(key, nStake, …)`), `:656` (`balanceFor`). `virtuals.js` is identical in both codebases.
- **What the tier port changes for Virtuals:** nothing in code — but the *economics* change: a STARTER top-up (20 credits) now buys 4 minimum-stake bets instead of 6, and `credits.summary().packCredits` (read by the lobby/wallet label via `skyAccount.toAccountUser` → `credits.balanceForIdentities`) changes 30 → 40. Do not touch `spendAmount`, `COST_PER_USE`, or the Virtuals bet/settlement code.
- The lobby lock fix is already mirrored in the target (`TGT lib/services/skyAccount.js:97-108`, comment: "Mirrors the original SignalVault fix of 2026-11-17") — no action.

### Shared code the tier logic touches (blast radius)
| Shared piece | Used by | Tier-port caution |
|---|---|---|
| `lib/services/credits.js` — `creditsForPayment`, `summary`, `PACK_CREDITS/PACK_PRICE_*`, `grantCredits`, `spendCredits`, `spendAmount` | Manual, scan, pricing-pass approvals; all game/scan gates (`requireCredits`); Virtuals bets; simulator (sim wallet) | Keep `PACK_CREDITS=30` / `PACK_PRICE_GHS=400` / `PACK_PRICE_NGN=75000` as the legacy fallback — `simulator.js:230` grants `PACK_CREDITS` sim credits and `simulator.js:201` prices from `PACK_PRICE_*`. Deleting or redefining them breaks the simulator. Add `PACKS`/`DEFAULT_PACK`; do not rename the old constants. |
| `lib/util.js` — `PLAN`, `SCAN_PLAN`, `planFromCode`, `scanPlanFromCode`, `storedOrLegacyGhs` | All three submit/approve rails; `funds.js` + `stats.js` + admin summaries price rows from these | `storedOrLegacyGhs` is unchanged (legacy PREMIUM → 550). `PLAN` gains `amountNgn`/`credits` fields — check no consumer assumes `Object.keys(PLAN)` has one entry. |
| `lib/services/funds.js` — `PLAN_NAIRA`, `SCAN_PLAN_NAIRA`, `nairaPriceForPlan*` | NG grants (all rails), commissions, funds/admin reports | Changing the tables reprices **historical** NG rows in reports (see §7) — expected per source, but flag to Prince. |
| `lib/services/manualDeposits.js` — combined admin queue | Admin review UI for all three rails | Identical in both; no tier logic, but `NG_SCAN_AMOUNT = 75000` (`:32`, used `:80`) hardcodes the NG scan display amount — see §7. |
| `lib/services/skyPayments.js` — `GAME_PLANS`, `plansCatalogue`, `approvePass` | `/pricing` catalogue + pass approval | Fix the two hardcoded `'PREMIUM'` lookups (§3c) or NG passes mis-grant. |
| `src/lib/api.ts` — `Plan`, `CREDIT_PACK(S)`, `PLAN_FALLBACK`, `SCAN_PLAN_FALLBACK`, `planLabel`, `SCAN_PLAN_DISPLAY`, `CreditSummary` | pricing, manual-payment, scan, scan-slip, payment.waiting, dashboard wallet | Port as a block; a half-port (e.g. `PLAN_FALLBACK` without `credits` on `Plan`) leaves the pickers showing `?? "?"` / `?? 30` fallbacks. |
| `lib/schema.sql` | All tables | **Identical in both codebases (verified by diff). No migration needed** — see §7. |
| `lib/services/settings.js` | Payment details only | Recipient differs (above) — do not sync this file from source. |

### Files that differ between the trees but are NOT tier work
Full-tree diff (excluding `node_modules`, `.output`, `.vercel`, `stage*`, `verification`) shows many rebrand-only diffs (light theme, fonts, `src/lib/image.ts` missing in target, `ENGINES_FALLBACK` missing in target, `loaderApiBase` differences, `.env.example`, `DESIGN.md`, `README.md`, `GO-LIVE-CHECK.md`). The tier port must not "sync" those — only the files listed in §2–§5.

---

## 7. RISKS / AMBIGUITIES

1. **No server-side amount validation — the plan code is the only trust anchor (both codebases).** The client never sends an amount; the server stores the *catalogue* amount for the submitted code. A buyer who selects VAULT but transfers GH₵250 is stored as a GH₵1,000 row and, if approved, is granted 80 credits. The only defence is the admin comparing the screenshot to the plan amount (admin reject reason: `"Screenshot doesn't match the amount"`). The tier port **widens** this hole from 1 amount to 4 — an admin approving quickly can now mis-grant 20 vs 80. Recommendation for the implementer (not done in this map): surface the expected amount prominently in the admin queue row (it already shows `amount` via `manualDeposits.js` mappers) and consider a confirm step; do not invent an amount field on submit without a Prince decision, because the screenshot is the only evidence of what was actually paid.
2. **Legacy NG PREMIUM rows reprice 30 → 40 credits if approved after the port.** NG rows store `amount_cedis = NULL`; approval prices them via `funds.nairaPriceForPlan(plan)`. Pre-cutover NG PREMIUM sales genuinely paid NGN 75,000 (30 credits under the old rule), but after the port `PLAN_NAIRA.PREMIUM = 94000` → `creditsForPayment({currency:'NGN', amountNgn: 94000})` exact-matches PREMIUM → **40 credits**. The source acknowledges this in its own comment (`SRC funds.js:23-26`: "legacy 'PREMIUM' rows paid NGN 75,000 before the cutover; they now price at 94,000 in funds reports (no stored NGN amount survives to tell them apart — see manualPayment approve)"). Same for scan: old NG `STANDARD` scan rows reprice 40,000 → 56,000 in reports (`SRC funds.js:41-46`). GH rows are safe (stored amount drives the grant: 400 → 30, 550 → 41, 800 → 60). **Decision needed from Prince:** accept the source's behaviour verbatim (recommended — it is what the original does), or add a stored-NGN-amount column before porting. Do not silently "fix" it by keeping `PREMIUM: 75000` in `PLAN_NAIRA` — that would make new NG PREMIUM buyers pay 94,000 (per the picker) but get granted 30.
3. **Target's approval endpoint takes a plan field — but derives credits from the amount, not the plan.** `POST /api/admin/manual-payments/:id/approve` and the combined `POST /api/admin/manual-deposits/:source/:id/approve` take only `{source, id}` in the URL (no body plan/amount). The plan comes from the stored row; credits come from `creditsForPayment` on the stored amount / NGN table. So a row whose stored plan name and stored amount disagree (possible for legacy rows: e.g. a `PREMIUM` row with `amount_cedis = 550`) grants by **amount** (41), not by plan name. This is by design in the source; keep it.
4. **`manualDeposits.js` hardcodes the NG scan amount — it will misprice tiered NG scan rows in the admin queue.** `lib/services/manualDeposits.js:32` (identical in both): `const NG_SCAN_AMOUNT = 75000;`, used at `:80`: `amount: country === 'NG' ? NG_SCAN_AMOUNT : plan.amountCedis`. After the port, an NG `SCAN_250` row will display as ₦75,000 in the admin list while the buyer was told ₦47,000. The grant itself is correct (it uses `nairaPriceForScanPlan`), but the admin sees the wrong expected amount — exactly the check that guards risk #1. The source has the same bug (same file, same constant) — porting it verbatim reproduces it. Fix (small, recommended): `amount: country === 'NG' ? (nairaPriceForScanPlan(p.scanPlan) ?? NG_SCAN_AMOUNT) : plan.amountCedis`, importing `nairaPriceForScanPlan` from `./funds`. Flag it; do not assume it is in scope.
5. **No tier-related DB rows or seed data exist.** `lib/schema.sql` is identical between source and target; tiers live only in code constants. `manual_payments.plan`, `scan_purchases.scan_plan`, and `game_passes.plan` are free `TEXT` columns (no FK/enum — `SRC lib/schema.sql:280-302` notes amounts are "freeform … not validated against a hardcoded plan table"). No migration, no seed insert, no backfill is needed. Existing PENDING rows keep their stored plan/amount and will grant under the new `creditsForPayment` on approval (GH rows: by stored amount, so a pending GH₵400 row still earns 30; NG rows: by the new NGN table — see risk #2).
6. **`SCAN_550` dies; bare-amount plan codes change meaning.** After the port, `scanPlanFromCode('SCAN_550')` throws 400, and `scanPlanFromCode('400')` (amount fallback) throws 400 — only `250/300/500/1000` resolve by amount. Any bookmarked/deep-linked `?plan=SCAN_550` or stored client state breaks. `planFromCode('PREMIUM')` still resolves, but now means GH₵500/40 instead of GH₵400/30 — any client or admin tooling that assumes PREMIUM = 400 must be rechecked (notably the target's `skyPayments.js` hardcoded `'PREMIUM'` lookups, §3c).
7. **Default-plan fallback string.** Both `pricing.tsx` and `manual-payment.tsx` default the selected plan to `"PREMIUM"` when nothing is preselected (`plans[0]?.plan ?? "PREMIUM"`). After the port that still resolves — but now means the GH₵500 tier, not the cheapest. The source keeps this literal (it is the default tier). Prince's order lists 250 first; if he wants STARTER preselected, that is a one-line change (`plans[0]` is STARTER once the catalogue is tiered — the fallback only matters while the query is loading, when `PLAN_FALLBACK[0]` is STARTER in the source). Confirm with Prince; do not change silently.
8. **Source's own stale comments will mislead a careless port.** `SRC lib/services/scanPurchase.js:5-6` still says "30 credits for GH₵400"; `SRC lib/services/manualPayment.js` header-adjacent comments reference GH₵800; `SRC lib/util.js:62-85` still narrates the 2026-10-24 Premium 550→800 change. Code is the source of truth; comments are not. The same staleness exists in the target — update comments only where they state a price.
9. **Simulator stays single-pack in the source — scope decision required.** `lib/services/simulator.js` is byte-identical in both trees and grants `PACK_CREDITS` (30) sim credits at the GH₵400/NGN 75,000 sim price (`:171,201,223,230`); all `simulator.*` routes show 30/400 copy in both. The tier port as ordered ("make him start with 250…") is about the real-money rails. Either leave the simulator alone (recommended — matches the source) or get an explicit Prince order to tier it; do not tier it by inertia, and do not delete `PACK_CREDITS` (see §6).
10. **What "verify" means for this port (for the implementer, not this map).** No live verification was done here (read-only map). The source's own prior report is `SRC VIRTUALS-AND-TIERS-REPORT.md` — useful cross-check, but code wins on any disagreement. Suggested acceptance checks: `GET /api/payment/plans` returns 4 items with credits/priceNgn; `GET /api/scan/payment/plans` returns `SCAN_250…1000`; `GET /api/plans/catalogue` returns 4 with credits/priceNgn; submit each tier GH + NG, approve, and confirm wallet deltas of exactly 20/25/40/80 (and that a GH₵400 legacy-style amount still grants 30 via fallback); guest can browse `/pricing` without a login redirect; VAULT shows "Best value".

---

## Appendix — port checklist (backend → frontend, in dependency order)

1. `lib/services/credits.js` — add `PACKS` + `DEFAULT_PACK` (`SRC :44-51`); `summary()` gains `packs` + default-tier fields (`SRC :147-157`); `creditsForPayment()` gains exact-tier branch (`SRC :184-201`); update header/out-of-credits prose (`SRC :1-22`, `:71`). **Keep `PACK_CREDITS/PACK_PRICE_*`.**
2. `lib/util.js` — `PLAN` → 4 tiers (`SRC :87-98`); `SCAN_PLAN` → 4 tiers (`SRC :109-119`).
3. `lib/services/funds.js` — `PLAN_NAIRA` + `SCAN_PLAN_NAIRA` → 4 tiers (`SRC :18-51`).
4. `lib/services/skyPayments.js` — `GAME_PLANS` → 4 tiers (`SRC :30-33`); `plansCatalogue()` gains `credits`/`priceNgn` (`SRC :82-94`); fix hardcoded `'PREMIUM'` → `pass.plan` in `approvePass` NG grant (`SRC :237`) and commission (`SRC :251`).
5. `api/index.js` — `GET /api/payment/plans` mapper gains `code/credits/priceGhs/priceNgn` (`SRC :341-353`). (`/api/scan/payment/plans` and `/api/plans/catalogue` handlers need no change.)
6. `src/lib/api.ts` — `Plan` type + `CREDIT_PACKS`/`CREDIT_PACK` + 3 helpers + `PLAN_FALLBACK`/`SCAN_PLAN_FALLBACK` + `planLabel`/`SCAN_PLAN_DISPLAY` + `CreditSummary.packs?` + USD comment (`SRC :112-121, 302-360, 372-383`).
7. `src/routes/pricing.tsx` — card-grid picker, guest-browsable (remove mount + 401 redirects, restore `subscribe()` login check + guest banner), dynamic credits/NGN/uses, footer trio (§4a, §5 rows #1-11).
8. `src/routes/manual-payment.tsx` — hero, select labels, amount line (§4b, rows #12-14).
9. `src/routes/scan.tsx` + `src/routes/scan-slip.tsx` + `src/routes/payment.waiting.tsx` — dynamic credits/NGN (§4c-4d, rows #15-23).
10. Copy sweep rows #24-43 (index, dashboard, login, register, Header, Footer, window-ui, CrashPredictor, useCrashRun, MinesBoard, `credits.js` error string).
11. Optional but recommended: `manualDeposits.js` NG scan amount fix (risk #4). Do NOT touch: recipient (`settings.js` / `api.ts` fallback), ImgBB upload, Virtuals, simulator, `lib/schema.sql`.
