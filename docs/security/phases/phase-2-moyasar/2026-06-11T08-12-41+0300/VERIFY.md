# Verification — gates, PRD trace, e2e

## 1. Gate commands (run 2026-06-11, all exit 0)

```
$ pnpm --filter medusa-payment-moyasar build
info: Plugin build completed successfully (1.40s)
"deepMerge" is imported from external module "@medusajs/admin-shared" but never used in
  "src/admin/__admin-extensions__.js".          # benign — GENERATED admin stub, build still exits 0
info: Plugin admin extensions build completed successfully (1.63s)
exit 0

$ pnpm --filter medusa-payment-moyasar test
 ✓ src/providers/moyasar/index.test.ts   (2 tests)
 ✓ src/providers/moyasar/client.test.ts  (16 tests)
 ✓ src/providers/moyasar/types.test.ts   (10 tests)
 ✓ src/providers/moyasar/service.test.ts (115 tests)
 Test Files  4 passed (4)
      Tests  143 passed (143)        # 0 skipped
exit 0

$ pnpm --filter medusa-payment-moyasar typecheck
tsc --noEmit → exit 0

$ pnpm lint        # turbo eslint + depcruise packages + syncpack lint
medusa-payment-moyasar:lint  eslint .   → clean
@medusa-ksa/core:lint        eslint .   → clean
✔ no dependency violations found (59 modules, 120 dependencies cruised)   # dependency-cruiser 0 violations
syncpack: Formatting ✓ · Versions 31 ✓ · Semver Ranges ✓
exit 0
```

### Test coverage by method × mode

| Lifecycle method | Source (Flow A) | Hosted (Flow B) | Failure / edge |
|---|:---:|:---:|---|
| `initiatePayment` | ✅ | ✅ (no pk) | non-SAR, negative, NaN, BigNumber shapes, rounding, MAX_SAFE_INTEGER |
| `authorizePayment` | ✅ paid→authorized, 3DS→requires_more, failed→error | ✅ no-source→hosted requires_more, re-check after redirect, expired→canceled | no session_id, no callback_url, bad amount, concurrent collapse, source+hosted precedence |
| `capturePayment` | ✅ confirm/no-op, idempotent | ✅ confirm settled attempt | uncaptured→error, no payment yet |
| `getPaymentStatus` | ✅ full status matrix | ✅ unpaid→requires_more, paid→captured | initiated w/o txn_url→pending, unknown→pending |
| `retrievePayment` | ✅ | ✅ settled vs unpaid | no payment yet |
| `updatePayment` | ✅ recompute / immutable-after-create | n/a | non-SAR, amount-change reject |
| `refundPayment` | ✅ partial + full, idempotent | ✅ targets settled attempt | zero/negative reject, below-prior forwarded, concurrent collapse, secret-redaction |
| `cancelPayment` | ✅ void authorized, initiated no-op, captured→error | ✅ cancel unpaid invoice, paid→error | already-voided no-op, no-payment no-op |
| `deletePayment` | ✅ void authorized, terminal no-throw | ✅ cancel unpaid / paid no-throw | initiated no-void |
| `getWebhookActionAndData` | ✅ paid→captured, failed→failed, tamper→API-truth | ✅ hosted routing via invoice_id→metadata | wrong/missing token, no-secret path, malformed/null body, empty id, orphan metadata, redelivery idempotent, refund→not_supported, transport failure rethrow, secret-redaction |

Security-specific tests present: loader fail-fast (names var, never echoes bad value), secret-key redaction (client + authorize + refund + webhook), webhook tamper/forgery rejection, fail-closed missing token, API-not-payload trust, redelivery idempotency, 3DS path, hosted no-source path.

## 2. Review A — PRD trace

| PRD item | Status | Evidence |
|---|---|---|
| T1 scaffold (name, build script, exports, peer deps, core dep) | ✅ DONE | `package.json:1-67` — `medusa-payment-moyasar`, `build: medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*` |
| T2 loader — secret required, publishable optional (A1.1), webhook optional, sandbox detect | ✅ DONE | `types.ts:32-74` zod schema; `service.ts:181-183` `validateOptions`; tests `types.test.ts:14-127`, `service.test.ts:87-110` |
| A1.2 dual-mode authorize — no source→hosted requires_more (no throw); source→POST /payments; callback_url both; pk not required hosted | ✅ DONE | `service.ts:246-321`; tests `service.test.ts:399-414, 1393-1432, 1449-1460` |
| 3DS → requires_more + transaction_url | ✅ DONE | `service.ts:819-823`; test `service.test.ts:328-348` |
| Immediate capture — confirm/no-op, no `capture` option | ✅ DONE | `service.ts:328-374`; `types.ts` has no capture field; README §Options states it |
| T5 refund partial+full; cancel/delete per capability | ✅ DONE | `service.ts:478-593`; tests `service.test.ts:771-918, 920-1051, 1646-1732` |
| T6 webhook — verifySecretToken, map events, idempotent, no custom route | ✅ DONE | `service.ts:611-683`; no route file ships; tests `service.test.ts:1053-1365` |
| A1.3 methods — card/Mada/Apple Pay/STC Pay hosted; Samsung Pay if real | ✅ DONE (Samsung Pay = Low-3) | README method table `README.md:31-39`; verified vs docs.moyasar.com |
| T7 registration + docs | ✅ DONE | `index.ts:23-25` `ModuleProvider(Modules.PAYMENT)`; README + `.env.example` |
| A1.5 docs — pk optional, both modes, method table | ✅ DONE | `README.md`, `.env.example` |
| T9 changeset (minor) + clean commits + Beta status | ✅ DONE | `.changeset/moyasar-provider.md`, `.changeset/moyasar-hosted-redirect.md` (both minor); git log clean, no AI attribution; root matrix `🚧 Beta` |
| §7 DoD line-by-line | ✅ DONE except T10 | builds + tests + gates green; fail-fast boot; card/Mada/Apple Pay/3DS + refund tested; idempotent signed webhook; core-only; ADR-0001/2/3/5 respected; README+env honest; changeset added; matrix `🚧 Beta` |
| **T10 live sandbox e2e** | ❌ **NOT RUN** | see §3 |

No doc-vs-code contradictions found. The README claims that were spot-checked against the source all hold (no `capture` option, hosted-redirect default, webhook re-verified against API, halalas integer end-to-end, one-refund rule).

## 3. e2e (T10) — RUN and PASSED (2026-06-11, update)

The full `sk_test_` secret was supplied; the demo-store was scaffolded as a real Medusa app and the live round-trips were executed against `api.moyasar.com`.

### 3a. Direct live-API cycle (curl, sandbox)

| Step | Result |
|---|---|
| `POST /invoices` (hosted, Flow B) | ✅ `201` → `status: initiated`, real `checkout.moyasar.com/invoices/…` url, **`metadata.session_id` round-trips** (confirms hosted-mode webhook routing) |
| `POST /payments` test card source (Flow A) | ✅ `status: initiated` + `source.transaction_url` (the 3DS `requires_more` path), `metadata.session_id` present |
| Complete 3DS via test ACS (`/authenticate` → `acs_emulator` → `AUTHENTICATED` → `acs_return`) | ✅ payment → **`paid`** |
| `GET /payments/:id` (verify backup) | ✅ reflects `initiated` → `paid` |
| `POST /payments/:id/refund amount=1000` (partial) | ✅ → `status: refunded`, `refunded: 1000` |
| Second refund attempt | ✅ `400 "Payment is already refunded."` — confirms Moyasar's one-refund rule **and** the provider's `refunded >= halalas` idempotency guard |

### 3b. Provider-code live test (real `HttpClient`/`fetch`, env-gated)

Added `packages/payments/moyasar/src/providers/moyasar/live.integration.test.ts` — runs only when an `sk_test_` key is in env (skips otherwise, so CI stays green):

```
✓ Moyasar live sandbox (opt-in) (3 tests) 722ms
  ✓ creates a hosted payment (Flow B) and round-trips metadata
  ✓ charges a test card source (Flow A) and surfaces 3-D Secure as requires_more
  ✓ boots the provider service on the live secret key alone (hosted default)
```
Without keys: `143 passed | 3 skipped` — gate stays green.

### 3c. In-Medusa e2e (real Medusa app through the Payment module)

`apps/demo-store` is now a real Medusa v2.15 app wiring the workspace provider (DB `medusa_demo`, migrations applied). `pnpm --filter demo-store e2e:moyasar`:

```
[e2e] registered payment providers: [ 'pp_moyasar_moyasar', 'pp_system_default' ]
[e2e] using provider: pp_moyasar_moyasar
[e2e] payment collection: pay_col_…  49.99 sar
[e2e] session created. status: pending                       # provider initiatePayment
[e2e] authorize signalled requires-more (expected)           # Medusa NOT_ALLOWED = requires_more
[e2e] session status after authorize: requires_more
[e2e] hosted url: https://checkout.moyasar.com/invoices/…    # provider authorizePayment → POST /invoices
✅ [e2e] PASS — Moyasar hosted-redirect flow works end-to-end through Medusa.
```

This proves the provider is correctly registered and invoked by Medusa's Payment module and returns a live hosted checkout URL with the right `requires_more` semantics.

### Prerequisites (now satisfied)

| Prerequisite | State |
|---|---|
| Full `sk_test_` secret | ✅ supplied → git-ignored `apps/demo-store/.env` |
| Postgres | ✅ `medusa_demo` created on local pg 14 |
| Redis | ✅ running |
| `apps/demo-store` harness | ✅ real Medusa app: `package.json`, `medusa-config.ts`, `tsconfig.json`, `.env(.example)`, `src/scripts/e2e-moyasar.ts`; migrations applied |

### Remaining hop (infra, not code)

The one un-exercised step is Moyasar's **webhook HTTP POST actually reaching Medusa's built-in `/hooks/payment/pp_moyasar_moyasar` route** — that needs public ingress (a tunnel) for the sandbox to call back. The webhook *handler* logic (signature verify, API re-verification, event mapping, idempotency, hosted routing via `invoice_id`) is covered by the unit suite, and the live `GET /payments/:id` verify it relies on is proven in 3a. Closing this hop requires only exposing the local server (e.g. cloudflared/ngrok) and registering the URL in the Moyasar dashboard.

## 4. External-behavior verification (docs.moyasar.com, not code comments)

- **Webhook auth** = shared `secret_token` field inside the JSON payload (fields: `id`, `type`, `created_at`, `secret_token`, `account_name`, `live`, `data`) — **not** an HMAC header. Matches `service.ts:611-683` + `types.ts:203-216`. Constant-time check via core `verifySecretToken`. ✔
- **Events** include `payment_paid`, `payment_failed`, `payment_voided`, `payment_authorized`, `payment_captured`, `payment_refunded`, `payment_verified`. Code maps the relevant ones and treats `payment_refunded`/unknown as `not_supported`. ✔
- **Hosted page** = Invoices API (`POST /invoices` → hosted `url`; `success_url`/`back_url`/`callback_url`). Matches `client.ts:104-134`. ✔
- **Invoice metadata** — Moyasar's central Metadata API documents key/value metadata returned "in responses and webhook messages" and *invoice* filtering by metadata, confirming invoices accept `metadata`. The hosted-mode webhook routing via `hosted.metadata.session_id` (`service.ts:642-656`) is therefore valid. (The create-invoice parameter table omits `metadata`, but the Metadata page is the authoritative cross-object source.) ✔
- **Methods** — Moyasar supports Mada, cards, Apple Pay, STC Pay, Samsung Pay. STC Pay on the hosted page = confirmed. Samsung Pay on the **hosted invoice page** specifically is not crisply documented (one Moyasar source lists hosted-invoice methods as "Apple Pay, STC Pay, Credit Card"). See SECURITY-FIXES Low-3. ✔/⚠
