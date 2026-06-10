# Moyasar provider: source-based, immediate-capture, webhook-authoritative

The `medusa-payment-moyasar` provider uses Moyasar's **source/token flow** (the storefront tokenizes the card with Moyasar.js and hands the backend a single-use `source`; the backend calls `POST /payments`), **not** a backend-created hosted invoice. Because Saudi cards (Mada and most issuers) mandate 3-D Secure, `authorizePayment` frequently returns a **"requires more action"** state carrying Moyasar's redirect URL; the customer is redirected and returns via `callback_url`, but the **webhook (`payment_paid`/`payment_failed`) is the authoritative source of truth** for the final outcome (with a `GET /payments/:id` verify as backup). The browser return is never trusted to mark an order paid.

This decision sets the pattern every other token-based gateway in the suite will copy.

## Consequences

- **Immediate capture only.** Moyasar captures funds when `POST /payments` succeeds — there is no authorize-only step. `capturePayment` is a confirm/no-op; the provider exposes **no `capture` option** (promising authorize-only would be faking a capability Moyasar lacks).
- **Webhook redelivery is handled by idempotency against Medusa's payment state**, not a dedup table — re-processing `payment_paid` on an already-captured payment is a no-op. Moyasar stays a pure Payment **provider** with zero schema (ADR-0001).
- **Config is `MOYASAR_SECRET_KEY` + `MOYASAR_PUBLISHABLE_KEY` (both required)** + optional `MOYASAR_WEBHOOK_SECRET`. The provider surfaces the publishable key in `initiatePayment` session data so the storefront can tokenize; the storefront writes `source` + `callback_url` back to the session before `authorizePayment`.
- **v1 scope:** card + Mada + Apple Pay ride one unified source→3DS→webhook path. **STC Pay is deferred** — its OTP handshake is a separate, multi-step lifecycle.
- All Moyasar I/O goes through core `HttpClient`; money is integer halalas (`SarAmount`); webhook signatures verify via core `verifyWebhook`; errors via `KsaError`/`toMedusaError` (ADR-0002).

## Considered and rejected

- **Flow B (backend-created hosted Invoice + redirect)** — rejected: it's storefront-agnostic but less idiomatic for Medusa and gives a worse card UX; the source/token flow matches how Medusa payment sessions are designed (cf. Stripe).
- **A webhook dedup table** — rejected: needs a custom module, violating the pure-provider shape for no benefit once handlers are idempotent against payment state.
