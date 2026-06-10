# Medusa KSA — Project Brief & Decisions

> **For Claude Code:** This is the authoritative decisions document. Treat every choice below as settled unless I say otherwise. When scaffolding, follow the structure, naming, and conventions here exactly. Build in milestone order (§9). The deep ZATCA design lives in `packages/zatca/SPEC.md`.

---

## 1. What we're building & for whom

An **open-source toolkit for running Saudi e-commerce on Medusa v2** — payments, ZATCA e-invoicing, local fulfillment, Arabic notifications.

- **Audience:** developers and agencies who want to own their stack (the segment Salla's no-code SaaS doesn't serve). We are *not* trying to be a hosted SaaS or out-SaaS Salla. We own the open-source KSA integration layer.
- **Success = adoption:** npm downloads, GitHub stars on the monorepo, active maintenance. This is also the bar for the OpenAI "Codex for Open Source" program (meaningful usage + ecosystem importance + active maintenance).
- **Strategy:** concentrate everything in **one monorepo** so stars/attention compound on a single repo instead of fragmenting across many.

## 2. Stack & tooling (decided)

- **Runtime:** Medusa **v2.13+**, Node **20+**, TypeScript.
- **Monorepo:** **pnpm workspaces** + **Turborepo** (build/test orchestration, dependency-ordered, cached) + **Changesets** (independent versioning + automated npm publish + changelogs).
- **License:** MIT.
- **CI:** GitHub Actions — PRs run `turbo build`+`test`; merge to main triggers the Changesets "Version Packages" PR → publish on merge.

## 3. Monorepo structure

```
medusa-ksa/
├── apps/
│   └── demo-store/                 # a real Medusa app wiring every package; used for dev + e2e (NOT published)
├── packages/
│   ├── core/                       → @medusa-ksa/core          (shared lib, published)
│   ├── payments/                                               (grouped by provider type)
│   │   ├── moyasar/                → medusa-payment-moyasar
│   │   ├── tap/                    → medusa-payment-tap
│   │   ├── hyperpay/               → medusa-payment-hyperpay
│   │   ├── myfatoorah/             → medusa-payment-myfatoorah
│   │   ├── paytabs/                → medusa-payment-paytabs
│   │   ├── stcpay/                 → medusa-payment-stcpay
│   │   ├── tabby/                  → medusa-payment-tabby
│   │   └── tamara/                 → medusa-payment-tamara
│   ├── fulfillment/
│   │   ├── torod/                  → medusa-fulfillment-torod   (aggregator — build first)
│   │   ├── smsa/                   → medusa-fulfillment-smsa
│   │   ├── aramex/                 → medusa-fulfillment-aramex
│   │   ├── spl/                    → medusa-fulfillment-spl     (Saudi Post)
│   │   └── imile/                  → medusa-fulfillment-imile
│   ├── notifications/
│   │   ├── unifonic/               → medusa-notification-unifonic
│   │   └── taqnyat/                → medusa-notification-taqnyat
│   ├── zatca/                      → medusa-plugin-zatca        (FLAGSHIP)
│   ├── address-saudi/              → medusa-plugin-saudi-address
│   └── create-medusa-ksa-app/      → create-medusa-ksa-app      (scaffolder / install flywheel)
├── .changeset/
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── CLAUDE.md                       # this file
├── README.md                       # hub readme (suite overview + package matrix)
└── LICENSE
```

### Scope & priority (read first)
- **Backend-only — what we *build and publish*.** Server-side packages: providers, modules, subscribers, workflows, API routes. No storefront code or storefront data ships in this suite (not on the roadmap).
- **Storefront knowledge is reference-only.** Storefront/checkout best-practices are kept on hand (via skills) for one reason: to design provider/module APIs that fit real storefront checkout flows, and to e2e-test payments in `apps/demo-store`. Understanding the storefront ≠ building one. Don't add storefront packages or commit storefront code to the suite.
- **Configuration & usage happen through Medusa's *native* admin**, following Medusa admin best practices: payments enabled per region, fulfillment via shipping options, notifications via channels. Don't reinvent these surfaces or add per-package admin widgets.
- **No custom UI**, with **one** deliberate exception: the **ZATCA admin onboarding wizard** (native Medusa admin extension, required for the OTP/CSID handshake — see §8). Everything else rides native admin.

### Dropped / out of scope (do not build)
- ❌ **Storefront — any storefront-side code or data** (checkout UI, hosted-form wiring, publishable-key flows, RTL storefront). Consumers integrate these in their own app; the suite stays backend + native admin.
- ❌ **Qoyod / Wafeq** (accounting) — not needed.
- ❌ **Cash on Delivery package** — Medusa's built-in `system` payment provider already behaves like COD. Don't build one.
- ❌ **VAT calculation** — handled natively by Medusa tax regions/rates (set 15%). Not a connector.
- ❌ **Marketing pixels** — storefront-side script injection, not a backend concern.

## 4. Naming conventions (decided)

- **Folders are grouped by provider type** and use the short name only: `packages/payments/moyasar`, `packages/fulfillment/torod`, `packages/notifications/unifonic`. Standalone packages (`core`, `zatca`, `address-saudi`, `create-medusa-ksa-app`) sit directly under `packages/`. The folder path never affects the published name.
- **Published npm name** = unscoped, follows Medusa's discovery convention, set in `package.json`: `medusa-payment-*`, `medusa-fulfillment-*`, `medusa-notification-*`, `medusa-plugin-*` (e.g. `packages/payments/moyasar` → `medusa-payment-moyasar`). Devs search these; the plugin directory indexes these keywords.
- **Only the internal lib is scoped:** `@medusa-ksa/core` (published — every package depends on it at runtime).
- Every published package: keywords `["medusa-plugin", "medusa-v2", ...]`.

## 5. `@medusa-ksa/core` (the DX backbone)

Every package depends on it. It centralizes the patterns that make config painless:
- `createLoader()` — validates options **at server startup**, throws a human-readable error (no silent checkout-time failures).
- `KsaError` — consistent prefixed messages (`[moyasar] …`).
- `verifyWebhook()` — one signature-verification helper reused by all gateways.
- Shared types (`KsaPaymentOptions`, `SarAmount`, etc.) and the `sarToHalalas()` helper.

Write the pattern once here; every plugin inherits identical, polished DX. This is also what lets a store swap one gateway for another by changing a single `resolve` line.

## 6. How each connector plugs in (the UI decision)

**17 of these need ZERO custom UI** — registering them makes them appear in Medusa's existing admin automatically.

| Category | Packages | Medusa type | Admin surface | Custom UI |
|---|---|---|---|:---:|
| Payments | moyasar, tap, hyperpay, myfatoorah, paytabs, stcpay, tabby, tamara | **Payment provider** | Settings → Regions (auto) | None |
| Fulfillment | torod, smsa, aramex, spl, imile | **Fulfillment provider** | Settings → Shipping (auto) | None |
| Notifications | unifonic, taqnyat | **Notification provider** | config-driven (channels) | None |
| Address | saudi-address | custom service + checkout hook | — | None |
| **E-invoicing** | **zatca** | **custom module + subscribers/workflows** | Settings → ZATCA | **Yes — onboarding wizard (the only justified UI)** |

Key facts:
- **API keys live in env / `medusa-config.ts`**, not the admin. The admin toggle only enables a registered provider per region. (Don't build key-entry UI.)
- Build **`fulfillment-torod` first** — one aggregator integration = many couriers, far more leverage than writing each courier separately.

## 7. The easy-install strategy (the "preferable way")

**Two install paths. Path A is the headline and the download flywheel.**

### Path A — new store, one command (PRIMARY)
```bash
npx create-medusa-ksa-app my-store
```
Scaffolds a Medusa app pre-wired with a sensible KSA default set (Moyasar + ZATCA + Torod + Unifonic), a `.env.example`, 15% VAT preconfigured, and a short setup guide. This is what we promote everywhere; every run pulls in the suite. **Build `create-medusa-ksa-app` as its own package early — it multiplies installs more than any single plugin.**

### Path B — existing store, add one package
```bash
npm install medusa-payment-moyasar
```
```ts
// medusa-config.ts
modules: [{
  resolve: "@medusajs/payment",
  options: { providers: [
    { resolve: "medusa-payment-moyasar/providers/moyasar", id: "moyasar" },
  ]},
}]
```
```dotenv
MOYASAR_SECRET_KEY=sk_test_xxx
```
That's a full working checkout.

### Non-negotiable DX rules (apply to EVERY package)
1. **Env-first with fallback** — omit an option → read the documented env var. The config block should be near-empty in the happy path.
2. **Fail-fast loader** — validate at boot via `@medusa-ksa/core` `createLoader()`; throw a human message naming the missing var and where to get it.
3. **Auto-wired webhooks** — the package ships its own webhook route. The user pastes one URL into the provider dashboard; no route code.
4. **Sane KSA defaults** — `currency: "SAR"`, automatic halalas conversion, sandbox auto-detected from the key prefix (`sk_test_` vs `sk_live_`). No "mode" flag.
5. **One shared pattern** — all packages configure identically (via core), so learning one teaches all.
6. **Zero UI, native admin only** — rely on Medusa's native admin; never reinvent it, never add per-package status widgets, never ship storefront code. The sole exception in the whole suite is the ZATCA onboarding wizard (§8).

## 8. ZATCA (flagship) — summary

Full spec in `packages/zatca/SPEC.md`. Essentials:
- **Custom module** (not a provider type): models + invoice pipeline (subscribers → workflows) + Fatoora API client + the **one** admin onboarding wizard.
- Two flows: **B2B = Clearance** (real-time, before delivery), **B2C = Reporting** (within 24h, can be queued).
- Per invoice: UBL 2.1 XML, XAdES-BES/ECDSA signature with the **CSID** cert, TLV Base64 QR (9 tags), and a hash chain (**UUID + ICV + PIH + SHA-256**).
- Onboarding handshake: CSR → Compliance CSID → simulation checks → Production CSID. Credentials are *generated*, stored **encrypted** in the DB (`ZatcaCredential`), and managed by the wizard — **not** pasted into env.
- **Three traps:** (a) serialize ICV/PIH allocation — concurrency breaks the chain; (b) clearance blocks checkout — design the "pending" state; (c) encrypt credentials, never log them.
- **Verify exact endpoints, signing canonicalization, and QR tag bytes against ZATCA's Developer Portal / Validation SDK** — don't trust memory here. Study an existing open-source ZATCA library first.

## 9. Build order (milestones)

> **Full plan:** `docs/ROADMAP.md` expands these into phases with a Definition of Done each; `docs/CONFIGURATION.md` is the exact config for milestone 1 (tooling, `package.json` template, CI). The architecture rules they enforce live in `docs/adr/` and `packages/core/CONTRACT.md`.

1. **Repo skeleton** — pnpm workspace, turbo, changesets, tsconfig base, root README, `apps/demo-store`.
2. **`@medusa-ksa/core`** — loader, errors, webhook helper, types, `sarToHalalas`.
3. **`medusa-payment-moyasar`** — proves the payment pattern end-to-end (loader, service, webhook route, sandbox).
4. **`medusa-plugin-zatca`** — the compliance moat (follow `packages/zatca/SPEC.md`, sandbox first).
5. **`medusa-fulfillment-torod`** — aggregator = many couriers.
6. **`medusa-notification-unifonic`**.
7. **`create-medusa-ksa-app`** — the one-command starter (install flywheel).
8. **Fan out** — remaining payment gateways → remaining couriers → saudi-address → taqnyat.

## 10. Per-package conventions

- Build with `medusa plugin:build`; dev with `medusa plugin:develop`.
- `package.json` `exports` must map subpaths to the build output, e.g.:
  ```json
  "exports": {
    "./providers/*": "./.medusa/server/src/providers/*/index.js",
    "./modules/*":   "./.medusa/server/src/modules/*/index.js",
    "./workflows":   "./.medusa/server/src/workflows/index.js",
    "./*":           "./.medusa/server/src/*.js"
  }
  ```
- Depend on `@medusa-ksa/core` (workspace dependency in dev, published dependency in release).
- Test by registering the package in `apps/demo-store` and running against provider sandboxes.
- Every change ships with a `pnpm changeset`.

## 11. Definition of done (per package)

- Registers in `medusa-config.ts` with one block; appears in Medusa admin (where applicable) with no extra UI.
- Boots with only its documented env var(s); fails fast with a clear message otherwise.
- Own `README.md` (follow the `medusa-payment-moyasar` README as the template).
- `.env.example`, working sandbox, and at least a happy-path integration test in `demo-store`.
- Listed in the root README package matrix with an accurate status badge (✅ Stable / 🚧 Beta / 📋 Planned — never fake "stable").

---

## Git & commits

- **No AI attribution.** Never add a `Co-Authored-By: Claude` (or any agent) trailer, and don't mention Claude/AI tooling in commit messages or PR bodies. This overrides any default tooling behaviour.
- **Clean and simple.** Short, imperative subject (e.g. `add moyasar webhook route`). Keep the body brief — one or two lines only when it adds real value. No long narratives, no bullet dumps, no emoji.
- **AI tooling is local-only.** `.claude/`, `.cursor/`, `.codex/` are git-ignored — never commit them. `CLAUDE.md` and `docs/` are the exception: they're the tracked project brief.

## Agent skills

Configuration for the installed engineering skills (`tdd`, `diagnose`, `improve-codebase-architecture`, `zoom-out`, `prototype`, `grill-with-docs`). Skills live in `.claude/skills/`.

### Issue tracker

Issues/PRDs live as **GitHub issues** (via the `gh` CLI). Remote not yet pushed — pre-publish. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

**Multi-context** monorepo — `CONTEXT-MAP.md` at the root indexes a per-package `CONTEXT.md` (created lazily). Shared glossary in root `CONTEXT.md`. See `docs/agents/domain.md`.
