# `@medusa-ksa/core`

The single safety surface for the **medusa-ksa** suite. Every connector in the
monorepo depends on this package and reuses its primitives so that config,
errors, network I/O, webhook verification, secrets, money, and sandbox detection
behave identically everywhere.

> **Golden rule:** if you are about to call `fetch`, verify a signature, read
> `process.env`, encrypt a secret, multiply money by 100, or hand-format an
> error message — stop and use the corresponding core primitive.

## What lives here

| Concern | Primitive |
|---|---|
| Boot-time config validation (env-first) | `createLoader`, `validateOptions` |
| Error normalization | `KsaError`, `toMedusaError` |
| Outbound HTTP (timeout + retry + redaction) | `HttpClient` |
| Webhook signature verification | `verifyWebhook` |
| Secrets at rest (AES-256-GCM) | `encrypt`, `decrypt` |
| Money (integer halalas) | `SarAmount`, `sarToHalalas`, `halalasToSar`, `assertSar` |
| Idempotency | `idempotencyKey`, `withIdempotency` |
| Sandbox vs live | `detectSandbox` |
| Redaction | `redactSecrets` |
| Shared types | `KsaPaymentOptions`, `KsaFulfillmentOptions`, `KsaNotificationOptions`, `AuthStrategy`, `HttpRequest` |

## Install

```bash
npm install @medusa-ksa/core
```

`@medusajs/framework` is a **peer** dependency — your Medusa app already
provides it.

## Contract

The exported surface and the binding rules behind it are documented in
[`CONTRACT.md`](./CONTRACT.md). The rationale for centralizing all integration
safety in this one package is recorded in
[ADR-0002](../../docs/adr/0002-core-safety-surface.md).

## License

MIT
