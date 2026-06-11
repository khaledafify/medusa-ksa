# Phase 2 — `medusa-payment-moyasar` Release Audit

Timestamp: `2026-06-11T08-12-41+0300`
Scope: `packages/payments/moyasar/` (`medusa-payment-moyasar`)
Reviewer pass: phase-target trace (A) + security (B) + code quality (C)

## Verdict: **NO-GO for ✅ Stable** — stays `🚧 Beta`

Single hard blocker: **the live sandbox e2e (T10) has not been run and cannot be run in this environment.** Everything else — all four gates, the full PRD task list (T1–T9 + Amendment A1.1–A1.5), the §6 guard gates, the §7 Definition of Done, and the security review — passes. The package is already honest about this (root matrix = `🚧 Beta`; package README roadmap lists "Live sandbox e2e in the demo store" as unchecked), so **no status change is made** and **no "fake stable" exists**.

This is a clean Beta: the code is release-grade; only the empirical end-to-end proof against Moyasar's live sandbox is missing.

## Gate results (all green)

| Gate | Result |
|---|---|
| `pnpm --filter medusa-payment-moyasar build` | ✅ exit 0 (1.4s) — one benign warning in the **generated** admin stub (`deepMerge` imported-but-unused in `__admin-extensions__.js`) |
| `pnpm --filter medusa-payment-moyasar test` | ✅ 143 passed, **0 skipped** (4 files) |
| `pnpm --filter medusa-payment-moyasar typecheck` | ✅ exit 0 |
| `pnpm lint` (eslint + dependency-cruiser + syncpack) | ✅ eslint clean · **dependency-cruiser 0 violations** (59 modules / 120 deps) · syncpack all valid |

Full output in [VERIFY.md](./VERIFY.md).

## Findings by severity

| Severity | Count | Open blockers? |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 | — |
| Low / Informational | 3 | none block release |
| **Release blocker (process, not security)** | **1** | **T10 live e2e not run** |

Security details in [SECURITY-FIXES.md](./SECURITY-FIXES.md); test gaps in [TEST-GAPS.md](./TEST-GAPS.md).

## Review A — Phase target / progress trace

Every PRD item is **DONE** except T10. See the full table in [VERIFY.md](./VERIFY.md#review-a--prd-trace). Highlights:

- **T2 loader** — `secretKey` required, `publishableKey` optional (A1.1), `webhookSecret` optional; fail-fast messages name the env var + where to get it. `detectSandbox` from prefix. ✅
- **Dual-mode (A1.2)** — no `source` → `createHostedPayment` (`POST /invoices`) → `requires_more` + `url` (does **not** throw); with `source` → `POST /payments`. `callback_url` required in both; publishable key not required for hosted. ✅
- **3DS / immediate-capture** — `initiated` + `transaction_url` → `requires_more`; `capturePayment` is a read-only confirm; **no `capture` option** exists. ✅
- **Webhook** — `verifySecretToken` (constant-time, fail-closed) → re-fetch authoritative state via `GET /payments/:id` → map events; idempotent against payment state, no dedup table; `payment_refunded` and redelivery are no-ops; browser `callback_url` is never trusted. ✅
- **Methods (A1.3)** — card + Mada + Apple Pay + STC Pay via hosted page, verified against docs.moyasar.com. Samsung Pay claim is *plausible but not crisply documented for the hosted page* — see Low-3. 
- **Refund / cancel / delete** — partial + full refund (one-refund rule respected); void only on `authorized`; hosted-invoice cancel via `PUT /invoices/:id/cancel`. ✅
- **Docs (A1.5)** + changeset (minor) present. ✅

## Review B — Security

Zero critical/high/medium. The provider reuses every core safety primitive correctly: Basic-auth secret is auto-redacted at the `HttpClient` boundary (`packages/core/src/http-client.ts:65`), request bodies (source tokens / card payloads) are **never** embedded in error messages, webhook auth is constant-time and fails closed, paid state is set only from the API-verified webhook, no card-collection code ships (hosted redirect is the PCI-safe default), and double-charge is guarded by a deterministic `given_id` + `withIdempotency`. Three low/informational notes in [SECURITY-FIXES.md](./SECURITY-FIXES.md).

## Review C — Code quality

Zero ADR violations. No raw `fetch`/axios, no `process.env` *read* (only the injectable-env default param handed to core), no hand-rolled crypto, no `*100`/`Math.round` on money. `@medusajs/*` are peer-only; the sole intra-repo import is `@medusa-ksa/core`; pure provider (no module/table/migration). No `any` on the exported surface; Moyasar statuses handled via exhaustive `switch` with safe `default`. Tests are thorough (143) across both modes and all lifecycle methods. The one structural gap is the absence of a live integration test (T10), covered in [TEST-GAPS.md](./TEST-GAPS.md).

## Ordered steps to reach ✅ Stable

1. Obtain the **full** `sk_test_…` secret (memory holds a masked value only — reveal/regenerate at dashboard.moyasar.com → Settings → API Keys) and put it in a git-ignored `apps/demo-store/.env` with the publishable key (+ optional webhook secret).
2. Scaffold `apps/demo-store` (currently just `.gitkeep`): a minimal Medusa app wiring `medusa-payment-moyasar`, a SAR region, 15% VAT, Postgres (already running on `:5432`).
3. Run the T10 round-trips against the live sandbox and record them in `VERIFY.md`:
   - (1) hosted-redirect (no source) → `url` returned → complete on hosted page → `payment_paid` webhook → order paid;
   - (2) source path (Moyasar.js token) → 3DS `requires_more` → webhook → paid;
   - (3) refund (partial + full).
4. While running (1), confirm the exact built-in webhook route suffix (README asserts `/hooks/payment/moyasar_moyasar`) and that **Samsung Pay** actually renders on the hosted page (Low-3); correct the README if either differs.
5. If all green: flip the root README matrix row to `✅ Stable`, add a changeset note, commit clean.
