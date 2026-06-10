# Security And Contract Fixes

## Phase A: Webhook Replay Protection

Finding: `packages/core/src/webhook.ts:76` checks timestamp tolerance only when both `timestamp` and `toleranceSec` are supplied, and `packages/core/src/webhook.ts:93` signs only `rawBody`. An old body plus old signature can verify if the caller passes a fresh timestamp.

Required fix:

- Make replay validation impossible to silently misconfigure.
- Bind the signed timestamp to the HMAC input for timestamped schemes, or accept a provider-specific signed payload callback.
- If `toleranceSec` is supplied without a timestamp, return `false`.
- Keep length mismatch safe: return `false`, never throw.

Suggested shape:

```ts
type VerifyWebhookOptions = {
  toleranceSec?: number
  timestamp?: number
  now?: number
  signedPayload?: string | Buffer
}

const payload = opts?.signedPayload ?? rawBody
```

If using the common Stripe-like pattern, `signedPayload` should be `${timestamp}.${rawBody}`.

## Phase B: HTTP Boundary

Finding: `packages/core/src/http-client.ts:153` allows absolute URLs to bypass `baseUrl`.

Required fix:

- Reject absolute URLs by default.
- Only allow absolute URLs through an explicit allowlist option if there is a real use case.

Finding: `packages/core/src/http-client.ts:30` does not implement contract `auth?: AuthStrategy`; `packages/core/src/types.ts:19` only defines the type.

Required fix:

- Add `auth?: AuthStrategy` to `HttpClientOptions`.
- Centralize bearer/basic/api-key header generation.
- Redact raw credential parts automatically.

Finding: `packages/core/src/http-client.ts:98` accepts `HttpClientRequest`, while `packages/core/src/types.ts:48` exports `HttpRequest` with `query` and `timeoutMs`.

Required fix:

- Use one exported request type.
- Implement `query` serialization and drop `undefined` query values.
- Implement per-request `timeoutMs` or remove it from the public type.

Finding: `packages/core/src/http-client.ts:78` accepts `NaN`, `Infinity`, and infinite retry counts.

Required fix:

- Validate finite positive `timeoutMs`.
- Validate `retry.retries` as a finite integer `>= 0`.
- Validate `retry.baseDelayMs` as finite and `>= 0`.

Finding: `packages/core/src/http-client.ts:95` redacts full header values only.

Required fix:

- Redact bearer token substrings, basic username/password, api-key values, and full header values.
- Implement contract support for `redact?: (string | RegExp)[]` or update the contract if intentionally not supported.

## Phase C: Secrets

Finding: `packages/core/src/secrets.ts:37` uses private decrypt codes: `malformed_ciphertext` and `decrypt_failed`.

Required fix:

- Use `KsaErrorCodes.DECRYPTION_FAILED` for malformed, wrong-key, tampered ciphertext, and auth-tag failure paths.
- Keep `KsaErrorCodes.INVALID_ENCRYPTION_KEY` for invalid key length.
- Do not include payload, plaintext, or key material in messages.

Finding: `packages/core/src/index.ts:5` exports only bare `encrypt` and `decrypt`, but contract exposes `secrets.encrypt` and `secrets.decrypt`.

Required fix:

- Export a `secrets` namespace object while keeping named exports.

Suggested shape:

```ts
export { encrypt, decrypt } from "./secrets.js";
import { encrypt, decrypt } from "./secrets.js";
export const secrets = { encrypt, decrypt } as const;
```

## Phase D: Money And Idempotency

Finding: `packages/core/src/money.ts:39` can return unsafe integer halalas for very large SAR inputs.

Required fix:

- After rounding, reject when `!Number.isSafeInteger(halalas)`.
- Throw `KsaErrorCodes.INVALID_AMOUNT`.

Finding: `packages/core/src/idempotency.ts:29` keeps successful entries forever in a process-global `Map`.

Required fix:

- Add TTL/LRU cleanup, or narrow `withIdempotency` to in-flight dedupe only.
- Document that durable idempotency must still be delegated to provider/database keys.
