# Security findings — `medusa-payment-moyasar`

**Result: 0 critical · 0 high · 0 medium · 3 low/informational.** No open security blocker.

The provider is a thin, correct reuse of the core safety surface. Each adversarial check below passed; the three Low items are hardening notes, not release blockers.

## Passed checks (evidence)

| Check | Verdict | Evidence |
|---|---|---|
| Secret key never logged / never in errors | ✅ | Basic-auth username (= secret) auto-added to redact list `http-client.ts:65`; provider passes no `redact` of its own but inherits it; tests `client.test.ts:244-260`, `service.test.ts:516-534, 900-917, 1315-1330` assert the secret is masked even when echoed in a 401 body |
| Secret never returned from an API route / session data | ✅ | No API route ships. `mergePaymentIntoData` (`service.ts:686-707`) deletes `source`; only the **publishable** (non-secret) key is surfaced in `initiatePayment` data, and only when configured (`service.ts:220-222`) |
| Request body (source token, card data) never in error text | ✅ | `toStatusError`/`toTransportError` (`http-client.ts:390-409, 370-388`) include only method+path+**response** snippet, never `req.body` |
| Webhook constant-time, fails closed | ✅ | `verifySecretToken` (`webhook.ts:187-192`) → `timingSafeEqual`; missing/empty received OR empty configured secret → `false`. Tests `service.test.ts:1131-1153` |
| Forged/tampered payload cannot mark paid | ✅ | Action derived from API re-fetch (`GET /payments/:id`), never the event body (`service.ts:640-677`). Test `service.test.ts:1117-1129` (body says paid, API says failed → failed) |
| Browser `callback_url` never trusted to mark paid | ✅ | `callback_url` is only forwarded to Moyasar as the redirect target; paid state comes solely from webhook/verify (ADR-0005); no code path sets captured from the return |
| Replay / redelivery handled | ✅ | Idempotent against Medusa payment state (no dedup table); replayed `payment_paid` → same `captured` action. Test `service.test.ts:1167-1177` |
| No card collection (PCI) | ✅ | Hosted redirect is the default; source path only forwards a storefront-produced token (`service.ts:302-317`). No PAN/CVV handling anywhere |
| Double-charge guarded | ✅ | Deterministic `given_id` from session id (`paymentIdForSession` `service.ts:59-66`) + `withIdempotency` collapses concurrent/retried creates (`service.ts:285-315`); writes never retried at transport level (`client.ts:38-44`, tests `client.test.ts:289-326`) |
| Every outbound call bounded + non-2xx → KsaError | ✅ | `timeoutMs` mandatory (`http-client.ts:129-138`), default 15s (`client.ts:14`); non-2xx → `KsaError(http_error)` (test `client.test.ts:227-242`) |
| Amounts integer halalas end-to-end (no float, no *100) | ✅ | All conversion via core `sarToHalalas`/`halalasToSar`; session amount re-validated `Number.isInteger` before charge (`service.ts:276-281`); no `*100` in package |
| SSRF guard | ✅ | Absolute URLs rejected by default (`http-client.ts:260-268`); ids `encodeURIComponent`-escaped (`client.ts:72,90,99,122,129`) |

## Low-1 (informational) — HTTP error response-snippet redaction is allow-list only

`toStatusError` (`packages/core/src/http-client.ts:390-409`) appends up to 500 chars of the **response** body to the error, redacting only known needles (auth parts, configured `redact`, header values). If Moyasar ever echoed a *source token* or other sensitive value it received in the **request** back in an error body, that value is not in the redact set and would survive into the (non-user-facing, but loggable) error message.

- Real-world risk: very low. Moyasar does not echo card PANs (PCI), and the `source` token is single-use. This is a core-layer note, not a Moyasar-provider defect.
- Optional hardening: have connectors that send tokenized sources pass those token values into the `HttpClient` `redact` list for the duration of the call, or have core redact request-body string values from response snippets.

## Low-2 (informational) — session data validated by explicit guards, not a zod schema

`authorizePayment` validates session input with manual `typeof` / `Number.isInteger` guards (`service.ts:263-281`) rather than a zod schema. `source` is forwarded to Moyasar as an opaque `Record<string, unknown>`.

- This *is* validation (non-empty `session_id`, non-empty `callback_url`, integer non-negative `amount`), and Moyasar rejects malformed sources, so the risk is low.
- The PRD/Review-B wording anticipated a zod schema. Consider a small `MoyasarSessionData` zod parse at the authorize boundary for symmetry with the options loader and to reject unexpected `source` shapes before the network call. Non-blocking.

## Low-3 (honesty / doc accuracy) — Samsung Pay marked supported on the hosted page

`README.md:37` lists **Samsung Pay** as `✅` under "Hosted page (default)". Moyasar supports Samsung Pay as a method generally, but its hosted **Invoices** documentation is ambiguous about Samsung Pay specifically (one Moyasar source enumerates hosted-invoice methods as "Apple Pay, STC Pay, Credit Card"). PRD A1.3 requires: *"Samsung Pay → supported only if Moyasar offers it, else omit it honestly."*

- Not a code defect (no per-method backend code; the hosted page renders whatever the account enables).
- Action: confirm Samsung Pay actually renders on the hosted invoice page during the T10 sandbox run. If it does not, drop the Samsung Pay row (or footnote it as account-dependent) before claiming it. Until verified, treat the claim as unproven.

## Note (not a finding) — generated admin stub

`medusa plugin:build` emits a warning about an unused `deepMerge` import in the **generated** `src/admin/__admin-extensions__.js`. This is triggered by the empty `src/admin/.gitkeep` placeholder; the package ships no custom admin UI. Build exits 0. Harmless; optionally remove the empty `admin` placeholder to silence it.
