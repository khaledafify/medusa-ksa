<div align="center">

# 💳 medusa-payment-moyasar

**The Moyasar payment provider for Medusa v2 — built for the Saudi market.**

Accept Mada, Apple Pay, STC Pay, and cards in your Medusa store with a single line of config.

[![npm version](https://img.shields.io/npm/v/medusa-payment-moyasar.svg?style=flat-square)](https://www.npmjs.com/package/medusa-payment-moyasar)
[![npm downloads](https://img.shields.io/npm/dm/medusa-payment-moyasar.svg?style=flat-square)](https://www.npmjs.com/package/medusa-payment-moyasar)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2-purple.svg?style=flat-square)](https://medusajs.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](./CONTRIBUTING.md)

</div>

---

## ✨ Why this plugin

[Moyasar](https://moyasar.com) is a SAMA-supervised Saudi payment gateway, but there was no first-class provider for Medusa v2. This plugin fills that gap with **zero-friction configuration** as a design goal:

- 🔑 **One option to go live** — just an API key. Everything else is inferred.
- 🧪 **Auto sandbox detection** — `sk_test_…` vs `sk_live_…` is detected from the key. No mode flag.
- 🛡️ **Fail-fast startup** — a misconfigured key throws a clear, human-readable error *when the server boots*, not silently at checkout.
- 🔁 **Webhooks auto-wired** — the plugin ships its own webhook route. You paste one URL into the Moyasar dashboard; nothing to hand-code.
- 🇸🇦 **Built for KSA defaults** — SAR currency, halalas conversion handled for you, Arabic-ready receipts.

## 💰 Supported payment methods

| Method | Supported | Notes |
|---|:---:|---|
| Mada | ✅ | Saudi domestic debit network |
| Visa / Mastercard | ✅ | Local & international |
| Apple Pay | ✅ | Requires domain verification in Moyasar |
| STC Pay | ✅ | Wallet |
| American Express | ✅ | Where enabled on your account |

## 📋 Requirements

- Medusa **v2.0** or newer (tested up to v2.13)
- Node.js **20+**
- A [Moyasar account](https://dashboard.moyasar.com) with API keys

## 📦 Installation

```bash
# npm
npm install medusa-payment-moyasar

# yarn
yarn add medusa-payment-moyasar

# pnpm
pnpm add medusa-payment-moyasar
```

## ⚙️ Configuration

Register Moyasar inside the Payment Module's `providers` array in `medusa-config.ts`. The `id` you set here is what Medusa Admin references when you enable the provider per region.

### Minimal (recommended)

The only thing you *need* is your secret key. Leave it out entirely and the plugin reads `MOYASAR_SECRET_KEY` from your environment automatically.

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  modules: [
    {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-moyasar/providers/moyasar",
            id: "moyasar",
            // options omitted → falls back to MOYASAR_SECRET_KEY env var
          },
        ],
      },
    },
  ],
})
```

### Full options

```ts
{
  resolve: "medusa-payment-moyasar/providers/moyasar",
  id: "moyasar",
  options: {
    apiKey: process.env.MOYASAR_SECRET_KEY,        // required (or via env)
    webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET, // optional, recommended
    capture: true,        // auto-capture on authorize. default: true
    currency: "SAR",      // default: "SAR"
    description: "Order from {store_name}", // statement description template
  },
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | `env.MOYASAR_SECRET_KEY` | Your `sk_test_…` or `sk_live_…` secret key. Sandbox/live mode is auto-detected from the prefix. |
| `webhookSecret` | `string` | `env.MOYASAR_WEBHOOK_SECRET` | Shared secret used to verify incoming webhooks. Strongly recommended in production. |
| `capture` | `boolean` | `true` | Capture immediately on authorize, or authorize-only for manual capture. |
| `currency` | `string` | `"SAR"` | ISO currency code. |
| `description` | `string` | `undefined` | Optional statement descriptor. Supports `{store_name}` and `{order_id}` tokens. |

### Environment variables

```dotenv
# .env
MOYASAR_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx
MOYASAR_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxx
```

> 💡 **Fail-fast check:** if `MOYASAR_SECRET_KEY` is missing or malformed, the server refuses to start with:
> `[moyasar] MOYASAR_SECRET_KEY is missing or invalid — copy it from dashboard.moyasar.com → Settings → API Keys`

## 🔁 Webhook setup

The plugin auto-registers a webhook endpoint. You don't write any route code — just point Moyasar at it:

1. In the **Moyasar Dashboard** → **Settings → Webhooks**, add a new endpoint:
   ```
   https://your-store.com/hooks/payment/moyasar
   ```
2. Select events: `payment_paid`, `payment_failed`, `payment_refunded`, `payment_authorized`.
3. Copy the signing secret into `MOYASAR_WEBHOOK_SECRET`.

Signatures are verified automatically; invalid payloads are rejected with `401`.

## 🏪 Enabling Moyasar in Admin

After starting your server, open **Medusa Admin → Settings → Regions**, edit a region that uses SAR, and select **Moyasar** from the payment providers dropdown. Save. That's it. Enablement is pure native-admin behaviour — this plugin adds no custom admin UI.

> 💡 **Amounts (halalas):** Moyasar expects amounts in **halalas** (1 SAR = 100 halalas). The plugin converts Medusa's amounts for you on the server — you never multiply by 100 manually. The payment session it returns already carries the halalas amount.

## 🧪 Testing (sandbox)

Use a `sk_test_…` key and the plugin runs entirely against Moyasar's sandbox automatically — no separate flag.

| Card | Number | Result |
|---|---|---|
| Visa (success) | `4111 1111 1111 1111` | Paid |
| Generic (declined) | use any expired date | Failed |

> For the full set of Mada / Apple Pay / 3-D Secure test credentials, see the [Moyasar testing docs](https://docs.moyasar.com).

## 🩺 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server won't start, `MOYASAR_SECRET_KEY invalid` | Key missing or malformed | Set a valid `sk_test_`/`sk_live_` key in `.env` |
| Moyasar not in Region dropdown | Provider not registered | Confirm the `resolve` path ends in `/providers/moyasar` |
| Payments stay `pending` | Webhook not reaching server | Verify the webhook URL and that `MOYASAR_WEBHOOK_SECRET` matches |
| `401` on webhook | Wrong signing secret | Re-copy the secret from the dashboard |

## 🗺️ Roadmap

- [ ] Saved payment methods (tokenization)
- [ ] Partial refunds from Admin
- [ ] Moyasar Invoices / payment links support
- [ ] Apple Pay domain auto-verification helper

## 🤝 Contributing

PRs and issues welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Run the test suite with `npm test` and build with `npm run build` (`medusa plugin:build`).

## 📄 License

[MIT](./LICENSE) © Medusa KSA contributors

---

<div align="center">

Part of the **Medusa KSA** plugin suite — payments, e-invoicing (ZATCA), and fulfillment for Saudi commerce.

⭐ If this saved you time, a star helps others find it.

</div>
