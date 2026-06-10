# Moyasar provider: hosted-redirect-first (dual-mode), immediate-capture, webhook-authoritative

The `medusa-payment-moyasar` provider takes payments in **two modes that converge on one confirmation model**:

- **Hosted redirect (default, no SDK).** The backend creates a Moyasar **hosted payment** and returns its URL; the storefront — typically a **separate custom React app that does not use Moyasar.js** — simply **redirects** the customer, who completes any method on Moyasar's hosted page. This is the baseline because it works for any storefront with zero client SDK and zero PCI exposure.
- **Source / token (optional).** If the storefront *does* embed Moyasar.js and writes a single-use `source` onto the session, the backend charges it directly via `POST /payments`.

Both paths return a **"requires more action"** state carrying the redirect (3-D Secure / hosted) URL; the customer returns via `callback_url`, but the **webhook (`payment_paid`/`payment_failed`) is the authoritative source of truth** for the final outcome (with a `GET /payments/:id` verify as backup). The browser return is **never** trusted to mark an order paid.

This dual-mode, webhook-authoritative pattern is what every other token-based gateway in the suite copies.

## Why dual-mode (not source-only)

Storefronts in this ecosystem are decoupled, custom-designed apps. Mandating Moyasar.js — and the **PCI-DSS SAQ-D** exposure of collecting raw card data on a custom form — is unacceptable, so **hosted redirect is the safe baseline that needs no SDK**. The source path is kept only as an optimization for storefronts that choose to embed Moyasar.js.

## Consequences

- **Immediate capture only.** Moyasar captures funds when a payment succeeds — there is no authorize-only step. `capturePayment` is a confirm/no-op; the provider exposes **no `capture` option** (faking authorize-only would violate "never fake," CLAUDE.md §11).
- **Webhook redelivery handled by idempotency against Medusa's payment state**, not a dedup table — re-processing `payment_paid` on an already-captured payment is a no-op. Moyasar stays a pure Payment **provider** with zero schema (ADR-0001).
- **Config: `MOYASAR_SECRET_KEY` (required)** + **`MOYASAR_PUBLISHABLE_KEY` (optional)** + optional `MOYASAR_WEBHOOK_SECRET`. The publishable key is needed **only** for the embedded source path; when present it's surfaced in `initiatePayment` session data. The storefront supplies its **`callback_url`** via session data in both modes; it writes a `source` back only in the embedded path.
- **Methods (all via the hosted page, and via source where Moyasar.js supports them): card + Mada + Apple Pay + STC Pay.** STC Pay is **no longer deferred** — its OTP runs on Moyasar's hosted page. **Samsung Pay** is included **only if Moyasar actually offers it** (hosted or source) — to be verified against docs.moyasar.com; if Moyasar has no Samsung Pay support we don't fake a gateway capability.
- All Moyasar I/O goes through core `HttpClient`; money is integer halalas (`SarAmount`); webhook auth via core `verifyWebhook` / `verifySecretToken`; errors via `KsaError`/`toMedusaError` (ADR-0002).

## Considered and rejected

- **Source-only (require Moyasar.js everywhere)** — rejected: forces a client SDK on every (custom) storefront and, if avoided naively, pushes merchants into self-collecting cards = PCI SAQ-D.
- **Self-collected card form on the custom storefront** — rejected outright: PCI-DSS SAQ-D, never.
- **A separate provider/package per method** (`moyasar-applepay`, `moyasar-stcpay`, …) — rejected: methods are sources / hosted options, not gateways; one source-agnostic provider covers them.
- **A webhook dedup table** — rejected: needs a custom module, violating the pure-provider shape for no benefit once handlers are idempotent against payment state.
