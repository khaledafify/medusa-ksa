<!--
  Before publishing, replace the placeholders:
    • khaledafify   → your GitHub org/username (used in every badge & link)
    • (optional) add a banner image at .github/assets/banner.png and embed it in the hero
-->

<div align="center">

# 🇸🇦 Medusa KSA

### The open-source toolkit for running Saudi e-commerce on [Medusa v2](https://medusajs.com)

Local payments · mandatory **ZATCA** e-invoicing · Saudi fulfillment · Arabic notifications — **one maintained suite, one configuration pattern.**

[![CI](https://img.shields.io/github/actions/workflow/status/khaledafify/medusa-ksa/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white)](https://github.com/khaledafify/medusa-ksa/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](./LICENSE)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2.13+-7C3AED.svg?style=flat-square)](https://medusajs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20+-339933.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/status-pre--release-orange.svg?style=flat-square)](./docs/ROADMAP.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](./CONTRIBUTING.md)

[**Quick start**](#-quick-start) · [**Packages**](#-packages) · [**How it works**](#-how-it-works) · [**Docs**](#-documentation) · [**Contributing**](#-contributing)

</div>

---

## Why Medusa KSA

Medusa v2 is a brilliant, fully open commerce engine — but it ships with **Stripe**, which onshore Saudi merchants can't use, and it knows nothing about Saudi tax law. Running a real KSA store yourself means stitching together:

- **Local payment gateways** — Mada, STC Pay, Apple Pay, and BNPL (Tabby, Tamara)
- **Legally mandated ZATCA (Fatoora) Phase 2 e-invoicing** — signed UBL XML, QR stamping, the clearance/reporting handshake
- **Saudi couriers** — SMSA, Aramex, Saudi Post, iMile, or an aggregator
- **Arabic SMS** for order updates

Today that's weeks of bespoke integration per store. **Medusa KSA turns it into `npm install`.** Every package shares one philosophy:

> **One key in. Sane KSA defaults. Fail-fast errors. Zero hand-wiring.**

This is the layer you'd otherwise rebuild for every project — maintained once, in the open, for the developers and agencies who want to **own their stack** instead of renting a closed SaaS.

## ✨ Highlights

- 🔑 **Env-first config** — drop in one API key; everything else is inferred (currency, halalas conversion, sandbox vs live from the key prefix). No "mode" flags.
- 🛡️ **Fail-fast at boot** — a misconfigured key throws a clear, human-readable error *when the server starts*, never silently at checkout.
- 🔁 **Webhooks auto-wired** — each package ships its own verified webhook route. Paste one URL into the provider dashboard; write no route code.
- 🧩 **Native Medusa admin** — providers appear in Settings → Regions / Shipping automatically. No custom UI to learn (the lone exception: the ZATCA onboarding wizard).
- 🔄 **One-line swaps** — every gateway implements the same interface, so changing providers is a single `resolve` change.
- 🇸🇦 **KSA-correct by default** — SAR, integer halalas (no float money bugs), 15% VAT via native tax regions, Arabic-ready messaging.
- 🔐 **Secure by construction** — secrets never touch the admin or logs; ZATCA credentials are encrypted at rest; webhook signatures are verified in constant time.

## 🚀 Quick start

### Path A — new store, one command _(recommended)_

Scaffold a Medusa app pre-wired with a sensible KSA default set (Moyasar + ZATCA + Torod + Unifonic), 15% VAT, and a `.env.example`:

```bash
npx create-medusa-ksa-app my-store
```

### Path B — add one package to an existing store

```bash
npm install medusa-payment-moyasar
```

```ts
// medusa-config.ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  modules: [
    {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          { resolve: "medusa-payment-moyasar/providers/moyasar", id: "moyasar" },
        ],
      },
    },
  ],
})
```

```dotenv
# .env
MOYASAR_SECRET_KEY=sk_test_xxxxxxxxxxxx
```

That's a full working Moyasar checkout — enable it per region in **Settings → Regions**. Every package follows this exact shape, so learning one teaches all. See each package's README for full options.

> **Requirements:** Node **20+**, Medusa **v2.13+**, PostgreSQL.

## 📦 Packages

Each package publishes independently to npm with its own README and changelog. **Status is honest** — everything is `📋 Planned` until it has a working sandbox and an integration test (see [`docs/ROADMAP.md`](./docs/ROADMAP.md)).

| Package | Folder | What it does | Status |
|---|---|---|:---:|
| `@medusa-ksa/core` | [`packages/core`](./packages/core) | Shared loader, errors, webhook + HTTP helpers, money & types | 🚧 Beta |
| **Payments** | | | |
| `medusa-payment-moyasar` | [`payments/moyasar`](./packages/payments/moyasar) | Moyasar — Mada, Apple Pay, STC Pay, cards _(reference connector)_ | 📋 Planned |
| `medusa-payment-tap` | [`payments/tap`](./packages/payments/tap) | Tap Payments gateway | 📋 Planned |
| `medusa-payment-hyperpay` | [`payments/hyperpay`](./packages/payments/hyperpay) | HyperPay gateway | 📋 Planned |
| `medusa-payment-myfatoorah` | [`payments/myfatoorah`](./packages/payments/myfatoorah) | MyFatoorah gateway | 📋 Planned |
| `medusa-payment-paytabs` | [`payments/paytabs`](./packages/payments/paytabs) | PayTabs gateway | 📋 Planned |
| `medusa-payment-stcpay` | [`payments/stcpay`](./packages/payments/stcpay) | STC Pay wallet | 📋 Planned |
| `medusa-payment-tabby` | [`payments/tabby`](./packages/payments/tabby) | Tabby BNPL | 📋 Planned |
| `medusa-payment-tamara` | [`payments/tamara`](./packages/payments/tamara) | Tamara BNPL | 📋 Planned |
| **Fulfillment** | | | |
| `medusa-fulfillment-torod` | [`fulfillment/torod`](./packages/fulfillment/torod) | Torod aggregator — many couriers behind one provider | 📋 Planned |
| `medusa-fulfillment-smsa` | [`fulfillment/smsa`](./packages/fulfillment/smsa) | SMSA Express | 📋 Planned |
| `medusa-fulfillment-aramex` | [`fulfillment/aramex`](./packages/fulfillment/aramex) | Aramex | 📋 Planned |
| `medusa-fulfillment-spl` | [`fulfillment/spl`](./packages/fulfillment/spl) | Saudi Post (SPL) | 📋 Planned |
| `medusa-fulfillment-imile` | [`fulfillment/imile`](./packages/fulfillment/imile) | iMile | 📋 Planned |
| **Notifications** | | | |
| `medusa-notification-unifonic` | [`notifications/unifonic`](./packages/notifications/unifonic) | Arabic SMS / WhatsApp via Unifonic | 📋 Planned |
| `medusa-notification-taqnyat` | [`notifications/taqnyat`](./packages/notifications/taqnyat) | Arabic SMS via Taqnyat | 📋 Planned |
| **Compliance & tooling** | | | |
| `medusa-plugin-zatca` | [`zatca`](./packages/zatca) | **ZATCA / Fatoora Phase 2** e-invoicing — UBL XML, QR, signing, clearance _(flagship)_ | 📋 Planned |
| `medusa-plugin-saudi-address` | [`address-saudi`](./packages/address-saudi) | Saudi National Address validation | 📋 Planned |
| `create-medusa-ksa-app` | [`create-medusa-ksa-app`](./packages/create-medusa-ksa-app) | One-command KSA store scaffolder | 📋 Planned |

## 🧩 How it works

Every package is a thin adapter over a shared backbone, **`@medusa-ksa/core`** — and that's deliberate. All the parts that are easy to get subtly wrong live in one audited place:

| Primitive | Guarantees |
|---|---|
| `createLoader()` | Boot-time option validation with env fallback; human-readable failures |
| `HttpClient` | Mandatory timeouts, retry + backoff, secret redaction — the only outbound path |
| `verifyWebhook()` | Constant-time signature checks, replay tolerance |
| `secrets` | AES-256-GCM encryption for credentials at rest |
| `SarAmount` / `sarToHalalas()` | Integer-only money; floats are banned |
| `KsaError` | Consistent, prefixed, secret-free errors |

Connectors stay **isolated Medusa modules** (no cross-module foreign keys — associations use Module Links), `@medusajs/*` are **peer dependencies** (one framework instance), and the only allowed intra-repo import is `core`. These rules are enforced in CI, not left to review.

📖 The decisions behind this live in [`docs/adr/`](./docs/adr) and the full core API in [`packages/core/CONTRACT.md`](./packages/core/CONTRACT.md).

## 🔐 Security

- **Secrets are env-first** — never entered in the admin, never logged, redacted at the HTTP boundary.
- **ZATCA credentials** (private key, CSIDs) are **encrypted at rest** and never returned from an API route.
- **Webhooks** are signature-verified before processing; invalid payloads are rejected.

Found a vulnerability? Please follow [`SECURITY.md`](./SECURITY.md) — don't open a public issue.

## 🗺️ Roadmap & status

Medusa KSA is **building in public** and pre-release. The build order — foundation → `core` → Moyasar (reference) → ZATCA (flagship) → Torod → Unifonic → scaffolder → fan-out — and the Definition of Done for each phase are in [`docs/ROADMAP.md`](./docs/ROADMAP.md). Watch/star the repo to follow along.

## 🛠️ Local development

This is a [pnpm](https://pnpm.io) workspace orchestrated with [Turborepo](https://turbo.build), versioned with [Changesets](https://github.com/changesets/changesets).

```bash
git clone https://github.com/khaledafify/medusa-ksa.git
cd medusa-ksa
pnpm install

pnpm build      # turbo, dependency-ordered (core first)
pnpm dev        # run apps/demo-store with every package wired up
pnpm test       # unit + integration (against provider sandboxes)
pnpm lint       # eslint + dependency-boundary + version checks
```

Releasing is automated: add a `pnpm changeset` with your change, and CI opens a "Version Packages" PR that publishes to npm on merge. See [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md) for the full tooling setup.

## 📚 Documentation

| Doc | What's in it |
|---|---|
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Phased delivery plan with a Definition of Done per milestone |
| [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md) | Exact monorepo config + the canonical `package.json` |
| [`docs/CONNECTORS.md`](./docs/CONNECTORS.md) | How each connector maps to a Medusa provider type |
| [`docs/adr/`](./docs/adr) | Architecture Decision Records (the non-negotiables) |
| [`packages/core/CONTRACT.md`](./packages/core/CONTRACT.md) | The `@medusa-ksa/core` API contract |
| [`packages/zatca/SPEC.md`](./packages/zatca/SPEC.md) | Deep ZATCA / Fatoora design |
| [`CONTEXT.md`](./CONTEXT.md) | Shared domain glossary |

## 🤝 Contributing

Contributions are very welcome — new gateways and couriers, bug fixes, docs, and Arabic translations especially. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) and look for [`good first issue`](https://github.com/khaledafify/medusa-ksa/labels/good%20first%20issue). Every package follows the same template, so adding the next gateway is mostly mechanical.

## 💬 Community & support

- 💡 **Questions & ideas** → [GitHub Discussions](https://github.com/khaledafify/medusa-ksa/discussions)
- 🐛 **Bugs** → [open an issue](https://github.com/khaledafify/medusa-ksa/issues)

## 📄 License

[MIT](./LICENSE) © Medusa KSA contributors. Not affiliated with Medusa or ZATCA.

---

<div align="center">

**Built for the Saudi developer community.** If this saves you time, a ⭐ helps others find it.

</div>
