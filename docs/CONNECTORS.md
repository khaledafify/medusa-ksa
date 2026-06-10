# Medusa KSA — Connector → Provider Type Map

How each connector plugs into Medusa v2, and exactly how much UI you build (spoiler: almost none).

Medusa has four relevant native provider types — **Payment**, **Fulfillment**, **Notification**, and **Tax**. Anything that maps to one of these inherits Medusa's existing admin/config plumbing. Anything that doesn't is a **custom module** wired with subscribers/workflows and configured via env — no admin UI, with one suite-wide exception: ZATCA's onboarding wizard.

> **Scope:** backend-only. No storefront code or data. Configuration/enablement runs through Medusa's *native* admin. See `CLAUDE.md` §3 (Scope & priority).

---

## 💳 Payment providers — zero UI

Register in the Payment module's `providers` array → they appear automatically in **Settings → Regions → Payment Providers**, and at checkout. You build no UI.

| Connector | Medusa type | Appears in admin | UI to build |
|---|---|---|:---:|
| Moyasar | Payment provider | Settings → Regions | None |
| Tap | Payment provider | Settings → Regions | None |
| HyperPay | Payment provider | Settings → Regions | None |
| MyFatoorah | Payment provider | Settings → Regions | None |
| PayTabs | Payment provider | Settings → Regions | None |
| STC Pay | Payment provider | Settings → Regions | None |
| Tabby (BNPL) | Payment provider | Settings → Regions | None |
| Tamara (BNPL) | Payment provider | Settings → Regions | None |
| Cash on Delivery | **Built-in** `system` provider | Settings → Regions | None — **don't build a package**, Medusa's system provider already behaves like COD |

> API keys live in `.env` / `medusa-config.ts`. The admin toggle only turns a registered provider on per region.

## 🚚 Fulfillment providers — zero UI

Register in the Fulfillment module's `providers` array → they appear in **Settings → Locations & Shipping** and are selectable per region's shipping options. You build no UI.

| Connector | Medusa type | Appears in admin | UI to build |
|---|---|---|:---:|
| SMSA | Fulfillment provider | Settings → Shipping | None |
| Aramex | Fulfillment provider | Settings → Shipping | None |
| Saudi Post (SPL) | Fulfillment provider | Settings → Shipping | None |
| iMile | Fulfillment provider | Settings → Shipping | None |
| Torod (aggregator) | Fulfillment provider | Settings → Shipping | None — **one provider, many couriers behind it.** Highest leverage; build this early |

## 📲 Notification providers — zero UI (config-driven)

Register in the Notification module's `providers` array and attach to a channel (`sms`, etc.). There's no admin toggle for notification providers — it's pure config. Still nothing custom to build.

| Connector | Medusa type | Channel | UI to build |
|---|---|---|:---:|
| Unifonic | Notification provider | `sms` / WhatsApp | None |
| Taqnyat | Notification provider | `sms` | None |

## ⚙️ Custom modules — config-driven

Not one of Medusa's native provider types, so no built-in admin home. Build as a **custom module + subscribers/workflows**; configure via env. Only ZATCA gets a (required) admin UI.

| Connector | How it's built | Config | UI to build |
|---|---|---|:---:|
| **ZATCA / Fatoora** | Custom module + order/invoice subscribers (XML, QR, cryptographic stamping, clearance) | boot env (`ZATCA_ENV`, encryption key); CSID generated + stored encrypted | **Required** — native admin onboarding wizard for the OTP/CSID handshake (the suite's one custom UI) |
| Saudi National Address | Custom service + backend checkout/API validation hook | env (API key) | None (backend hook; no storefront code) |

---

## By the numbers

- **15 connectors** ride Medusa's native plumbing with **zero custom UI** (8 payment + COD via the built-in `system` provider, 5 fulfillment, 2 notification).
- **2 custom modules** are config-driven: ZATCA (the one required admin onboarding wizard) and Saudi National Address (no UI).
- **0 connectors** require a new UI framework, a Salla-style app store, or any storefront code.

## Two things you do *not* need to build

- **VAT (15%)** — handled natively by Medusa's tax regions/rates. Just configure it; it's not a connector.
- **An "Integrations marketplace" page** — Medusa's per-region provider selection already covers discovery/enablement for payments and fulfillment.

## Suggested build order

1. `core` (shared loader, types, webhook helper)
2. `payment-moyasar` (proves the payment pattern)
3. `zatca` (the mandatory-compliance moat → forced adoption)
4. `fulfillment-torod` (one aggregator = many couriers)
5. `notification-unifonic`
6. Fan out: remaining payment gateways → remaining couriers → `address-saudi` → `notification-taqnyat`
