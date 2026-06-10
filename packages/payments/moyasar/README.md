<div align="center">

# 💳 medusa-payment-moyasar

**The Moyasar payment provider for Medusa v2 — built for the Saudi market.**

Accept Mada, Visa/Mastercard, and Apple Pay in your Medusa store with a single line of config.

[![npm version](https://img.shields.io/npm/v/medusa-payment-moyasar.svg?style=flat-square)](https://www.npmjs.com/package/medusa-payment-moyasar)
[![npm downloads](https://img.shields.io/npm/dm/medusa-payment-moyasar.svg?style=flat-square)](https://www.npmjs.com/package/medusa-payment-moyasar)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2-purple.svg?style=flat-square)](https://medusajs.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](../../../LICENSE)

</div>

---

## ✨ Why this plugin

[Moyasar](https://moyasar.com) is a SAMA-supervised Saudi payment gateway, but there was no first-class provider for Medusa v2. This plugin fills that gap with **zero-friction configuration** as a design goal:

- 🔑 **Two env vars to go live** — your secret + publishable keys. Everything else is inferred.
- 🧪 **Auto sandbox detection** — `sk_test_…` vs `sk_live_…` is detected from the key. No mode flag.
- 🛡️ **Fail-fast startup** — a misconfigured key throws a clear, human-readable error *when the server boots*, not silently at checkout.
- 🔁 **Webhooks via Medusa's built-in endpoint** — no route code to write; you paste one URL into the Moyasar dashboard.
- 🇸🇦 **Built for KSA defaults** — SAR currency, halalas conversion handled for you.

## 💰 Supported payment methods

| Method | Status | Notes |
|---|:---:|---|
| Mada | ✅ | Saudi domestic debit network (3-D Secure mandated) |
| Visa / Mastercard | ✅ | Local & international |
| Apple Pay | ✅ | Requires domain verification in Moyasar |
| STC Pay | 📋 Planned | Separate OTP lifecycle — deferred to a later release |

## 📋 Requirements

- Medusa **v2.13** or newer
- Node.js **20+**
- A [Moyasar account](https://dashboard.moyasar.com) with API keys

## 📦 Installation

```bash
npm install medusa-payment-moyasar    # or yarn add / pnpm add
```

## ⚙️ Configuration

Register Moyasar inside the Payment Module's `providers` array in `medusa-config.ts`. The `id` you set here is what Medusa Admin references when you enable the provider per region.

### Minimal (recommended)

Leave `options` out entirely and the plugin reads `MOYASAR_SECRET_KEY` and `MOYASAR_PUBLISHABLE_KEY` from your environment automatically.

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
            // options omitted → read from MOYASAR_* env vars
          },
        ],
      },
    },
  ],
})
```

### Environment variables

```dotenv
# .env
MOYASAR_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx
MOYASAR_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxx
MOYASAR_WEBHOOK_SECRET=your-shared-webhook-token   # optional, recommended
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `secretKey` | `string` | `env.MOYASAR_SECRET_KEY` | Your `sk_test_…` or `sk_live_…` secret key. Sandbox/live is auto-detected from the prefix. |
| `publishableKey` | `string` | `env.MOYASAR_PUBLISHABLE_KEY` | Your `pk_…` key. Surfaced in the payment session so the storefront can tokenize with Moyasar.js. |
| `webhookSecret` | `string` | `env.MOYASAR_WEBHOOK_SECRET` | Shared secret token used to verify incoming webhooks. Strongly recommended in production. |
| `timeoutMs` | `number` | core default | Per-request timeout for Moyasar API calls. |
| `retry` | `{ retries, baseDelayMs }` | core default | Retry policy for idempotent (GET) requests. |

There is deliberately **no `capture` option**: Moyasar captures immediately on a successful charge, so `capturePayment` is a confirmation read, never a second charge. There is also **no mode flag** — sandbox is detected from the key prefix.

> 💡 **Fail-fast check:** if a required key is missing or malformed, the server refuses to start with a message naming the env var and where to get it — e.g. `[moyasar] secretKey is required — copy it from the Moyasar Dashboard → Settings → API Keys`.

## 🔄 How a payment flows (source/token + 3-D Secure)

This provider implements Moyasar's **source/token flow**:

1. `initiatePayment` returns session data carrying the **publishable key**, the amount in **halalas**, and the currency. No API call is made yet.
2. Your storefront tokenizes the card / Apple Pay payload with **Moyasar.js** and writes `source` + `callback_url` (your 3-D Secure return route) back onto the payment session.
3. `authorizePayment` charges via `POST /payments`. Saudi cards mandate 3-D Secure, so the result is usually **`requires_more`** with a `transaction_url` in the session data — redirect the customer there.
4. The customer completes the challenge and lands back on your `callback_url`. **The browser return is never trusted**: the authoritative outcome arrives on the `payment_paid` / `payment_failed` **webhook**, and the provider re-verifies every event against `GET /payments/:id` before acting.

Payment creation is idempotent: the Moyasar payment id is derived deterministically from the Medusa session id, so a retried or concurrent authorization can never double-charge.

## 🔁 Webhook setup

Medusa v2 ships a built-in webhook endpoint for every payment provider — there is no route code in this plugin. Point Moyasar at it:

1. In the **Moyasar Dashboard** → **Settings → Webhooks**, add an endpoint (note the provider id suffix):
   ```
   https://your-store.com/hooks/payment/moyasar_moyasar
   ```
2. Select at least the `payment_paid` and `payment_failed` events.
3. Set a **shared secret token** on the endpoint and copy the same value into `MOYASAR_WEBHOOK_SECRET`.

When `MOYASAR_WEBHOOK_SECRET` is configured, the payload's `secret_token` is verified in constant time and tampered events are rejected. Either way, every event is re-verified against Moyasar's API before Medusa acts on it, and redelivered events are idempotent against the payment's state.

## 🏪 Enabling Moyasar in Admin

After starting your server, open **Medusa Admin → Settings → Regions**, edit a region that uses SAR, and select **Moyasar** from the payment providers dropdown. Save. Enablement is pure native-admin behaviour — this plugin adds no custom admin UI.

> 💡 **Amounts (halalas):** Moyasar expects amounts in **halalas** (1 SAR = 100 halalas). The plugin converts Medusa's SAR amounts once, at the boundary — you never multiply by 100, and amounts stay integers end-to-end.

## ↩️ Refunds & cancellation

- **Refunds** (partial and full) go through `POST /payments/:id/refund`, driven from Medusa. A payment Moyasar already reports as fully refunded is not refunded twice.
- **Cancel** voids a payment that is still voidable (`initiated`/`authorized`). Because Moyasar captures immediately, a captured payment cannot be cancelled — issue a refund instead.

## 🧪 Testing (sandbox)

Use a `sk_test_…` key and the plugin runs entirely against Moyasar's sandbox automatically — no separate flag. For Mada / Apple Pay / 3-D Secure test credentials, see the [Moyasar testing docs](https://docs.moyasar.com/testing/cards).

## 🩺 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server won't start, `[moyasar] secretKey is required` | Key missing | Set `MOYASAR_SECRET_KEY` (and `MOYASAR_PUBLISHABLE_KEY`) in `.env` |
| Moyasar not in Region dropdown | Provider not registered | Confirm the `resolve` path ends in `/providers/moyasar` |
| Payments stay `pending` | Webhook not reaching server | Verify the webhook URL (`/hooks/payment/moyasar_moyasar`) is publicly reachable |
| Webhook events ignored | Wrong shared secret | Re-copy the token from the dashboard into `MOYASAR_WEBHOOK_SECRET` |

## 🗺️ Roadmap

- [ ] STC Pay (OTP lifecycle)
- [ ] Saved payment methods (tokenization)
- [ ] Live sandbox e2e in the demo store

## 📄 License

[MIT](../../../LICENSE) © Medusa KSA contributors

---

<div align="center">

Part of the **[Medusa KSA](https://github.com/khaledafify/medusa-ksa)** plugin suite — payments, e-invoicing (ZATCA), fulfillment, and notifications for Saudi commerce.

⭐ If this saved you time, a star helps others find it.

</div>
