# Missing And Weak Tests

Current tests are partly meaningful, but they do not fully protect the core safety surface.

## Phase A: Webhook Tests

Add tests:

- `toleranceSec` without `timestamp` returns `false`.
- Timestamped signatures verify only when the timestamp is included in the signed payload.
- Old body plus old signature with a fresh timestamp is rejected.
- Length mismatch never throws and returns `false`.

Weak existing tests:

- `packages/core/src/webhook.test.ts:63` signs only `BODY` and passes a timestamp separately. This proves timestamp age checking, but not timestamp binding.
- `packages/core/src/webhook.test.ts:118` codifies that stale timestamps are ignored when `toleranceSec` is omitted. That may be acceptable only if replay protection is explicitly opt-in and documented as unsafe by default.

## Phase B: HTTP Tests

Add tests:

- Absolute URL path is rejected by default.
- `auth: { type: "bearer" }` sets `Authorization` and redacts both `Bearer token` and raw token.
- `auth: { type: "basic" }` sets the correct Basic value and redacts username/password.
- `auth: { type: "api-key" }` sets the selected header and redacts the key value.
- `query` params are appended to the URL and `undefined` values are dropped.
- Per-request `timeoutMs` overrides client default, if the public type keeps it.
- Constructor rejects `NaN`, `Infinity`, negative timeout, non-integer retries, negative retries, infinite retries, and negative/infinite base delay.
- `redact` accepts `RegExp` if the contract keeps that type.

Weak existing tests:

- `packages/core/src/http-client.test.ts:49` rejects only `timeoutMs: 0`; it would still pass with `NaN` and `Infinity` accepted.
- `packages/core/src/http-client.test.ts:215` redacts only the full header value, not a leaked bearer token substring.
- There is no test proving `AuthStrategy` is implemented, despite being part of the shared type surface.
- There is no test proving the exported `HttpRequest` shape is the request shape accepted by `HttpClient.request()`.

## Phase C: Secrets Tests

Add tests:

- `decrypt()` wrong key throws `KsaErrorCodes.DECRYPTION_FAILED`.
- Tampered ciphertext throws `KsaErrorCodes.DECRYPTION_FAILED`.
- Tampered auth tag throws `KsaErrorCodes.DECRYPTION_FAILED`.
- Malformed/truncated payload throws `KsaErrorCodes.DECRYPTION_FAILED`.
- `secrets.encrypt` and `secrets.decrypt` are exported from `src/index.ts`.

Weak existing tests:

- `packages/core/src/secrets.test.ts:70` expects `"decrypt_failed"`, a private code not present in the public error-code contract.
- `packages/core/src/secrets.test.ts:112` expects `"malformed_ciphertext"`, also a private code.

## Phase D: Money Tests

Add tests:

- `sarToHalalas(Number.MAX_SAFE_INTEGER / 100 + 1)` throws `KsaError`.
- Rounded halalas must be `Number.isSafeInteger`.
- Keep existing `1.005` and `0.1 + 0.2` style drift tests.

Weak existing tests:

- `packages/core/src/money.test.ts:36` tests large values, but only within safe ranges.
- No test proves unsafe integer outputs are rejected.

## Phase E: Idempotency Tests

Add tests:

- Empty key is rejected, if key validation is added.
- Successful keys are evicted after TTL, or settled successes are not cached if changing to in-flight-only behavior.
- A rejected in-flight operation still releases the key for retry.

Weak existing tests:

- `packages/core/src/idempotency.test.ts:50` asserts successful results are sticky forever. That creates unbounded memory growth unless TTL/LRU is added.

## Phase F: Contract Export Tests

Add a small public surface test that imports from `src/index.ts` or built `dist/index.js` and asserts every contract primitive exists:

- `createLoader`
- `validateOptions`
- `KsaError`
- `toMedusaError`
- `HttpClient`
- `verifyWebhook`
- `secrets.encrypt`
- `secrets.decrypt`
- `encrypt`
- `decrypt`
- `sarToHalalas`
- `halalasToSar`
- `assertSar`
- `detectSandbox`
- `idempotencyKey`
- `withIdempotency`
- `redactSecrets`

Also add a TypeScript-only surface check for exported types:

- `SarAmount`
- `AuthStrategy`
- `HttpRequest`
- `KsaPaymentOptions`
- `KsaFulfillmentOptions`
- `KsaNotificationOptions`
