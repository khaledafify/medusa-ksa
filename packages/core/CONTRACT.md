# `@medusa-ksa/core` — Integration Contract

The single safety surface for the whole suite. Every primitive below is implemented **once** here and is the **only** sanctioned way to do that thing (ADR-0002). This file is the contract; the implementation is built lazily in milestone 2. Signatures are indicative, not final — but the *rules* are binding.

> **Golden rule for connector authors:** if you are about to call `fetch`, verify a signature, read `process.env`, encrypt a secret, multiply money by 100, or hand-format an error message — stop. Use the corresponding core primitive. If it doesn't exist yet, add it to core, don't inline it.

## Configuration & boot validation

```ts
createLoader<T>(schema: ZodSchema<T>, opts?: { envPrefix?: string }): MedusaLoader
```
- Validates a connector's options **at server boot**, with documented **env-var fallback** per option (CLAUDE.md §7.1).
- On failure throws a `KsaError` that names the missing/invalid var **and where to get it** — never a silent failure at checkout.
- Connectors never validate their own config or read env directly.

## Errors

```ts
class KsaError extends Error            // prefixed: "[moyasar] …", carries a stable `code`
toMedusaError(err: unknown): MedusaError // normalize any provider/transport error to Medusa's shape
```
- All thrown errors are `KsaError` (internal) or mapped via `toMedusaError` at the API/provider boundary.
- **Never** include secrets, tokens, or full request bodies in a message.

## Outbound HTTP (the only network path)

```ts
class HttpClient {
  constructor(opts: {
    baseUrl: string
    auth?: AuthStrategy
    timeoutMs: number          // REQUIRED — no unbounded calls
    retry?: { retries: number; backoff: "exponential-jitter" }
    redact?: (string | RegExp)[]
  })
  request<T>(req: HttpRequest): Promise<T>
}
```
- **Timeout is mandatory** on every call — the #1 cause of hung checkouts.
- Retries use exponential backoff + jitter, honor `Retry-After`, and apply **only** to idempotent operations.
- Secrets/PII are redacted at this boundary, so no log statement downstream can leak them.
- Transport errors are surfaced as typed `KsaError`s, not raw exceptions.

## Idempotency

```ts
idempotencyKey(seed?: string): string
withIdempotency<T>(key: string, fn: () => Promise<T>): Promise<T>
```
- Every payment capture/refund carries an idempotency key so a retry can never double-charge.

## Webhooks

```ts
verifyWebhook(raw: Buffer | string, signature: string, secret: string, opts?: { toleranceSec?: number }): boolean
```
- **Constant-time** HMAC comparison; rejects on mismatch (caller returns `401`).
- Timestamp tolerance defends against replay. Callers also **dedupe by event id** and process asynchronously, returning `2xx` fast.

## Secrets at rest

```ts
secrets.encrypt(plaintext: string, key: Buffer): string   // AES-256-GCM
secrets.decrypt(ciphertext: string, key: Buffer): string
```
- For credentials stored in the DB (e.g. ZATCA `ZatcaCredential`). Key comes from a `*_ENCRYPTION_KEY` env var, validated for length at boot.
- Plaintext is **never logged** and **never returned from an API route**.

## Money

```ts
type SarAmount = Brand<number, "halalas">      // integer halalas; floats banned
sarToHalalas(sar: number): SarAmount
halalasToSar(h: SarAmount): number
assertSar(currencyCode: string): void          // guards against silently-wrong currency
```
- Conversion happens only here, at the core boundary. Connectors never see floats or multiply by 100.

## Environment & mode

```ts
detectSandbox(key: string): boolean            // from key prefix, e.g. sk_test_ vs sk_live_
```
- Sandbox vs live is **inferred**, never a `mode` flag (CLAUDE.md §7.4).

## Shared types

`KsaPaymentOptions`, `KsaFulfillmentOptions`, `KsaNotificationOptions`, `SarAmount`, `AuthStrategy`, `HttpRequest` — the option/handshake shapes every connector reuses, so learning one teaches all.

---

### Connector author checklist
- [ ] Options validated via `createLoader` (env-first).
- [ ] All network I/O through one `HttpClient` (timeout set).
- [ ] Webhook route verifies via `verifyWebhook`, dedupes, returns 2xx fast.
- [ ] Money only as `SarAmount`; conversion only at the core boundary.
- [ ] Errors are `KsaError` / `toMedusaError`; no secrets in messages or logs.
- [ ] No `@medusajs/*` in `dependencies` (peer only); no import of any sibling package (ADR-0003).
