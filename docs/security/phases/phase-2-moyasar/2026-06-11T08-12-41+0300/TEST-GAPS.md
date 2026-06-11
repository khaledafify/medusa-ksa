# Test gaps — `medusa-payment-moyasar`

The unit suite is genuinely strong: **143 tests, 0 skipped**, covering both modes, every lifecycle method, the status matrix, failure paths, and the security-critical cases (secret redaction, webhook tamper/forgery/replay, fail-closed token, fail-fast loader, 3DS, hosted no-source). The gaps below are about **release confidence**, not unit correctness.

## G1 (BLOCKER) — no live sandbox e2e (T10)

Every test injects a fake `MoyasarClient` or a fake `fetch`. **Nothing in the suite exercises the real Moyasar sandbox**, and `apps/demo-store` is empty (`.gitkeep` only). The Release bar (PRD §7, T10, ADR-0005) requires a passing live round-trip. Add, in `apps/demo-store`:

- **e2e-1 hosted (default):** initiate → authorize (no source) → assert `requires_more` + a real `https://…moyasar.com/invoices/…` `url` → complete on the hosted page → receive `payment_paid` on the built-in webhook route → Medusa payment captured / order paid.
- **e2e-2 source (3DS):** tokenize with Moyasar.js → write `source` + `callback_url` → authorize → assert `requires_more` + `transaction_url` → complete 3DS → webhook → paid.
- **e2e-3 refunds:** partial refund (assert `refunded` < amount) then a full/remaining refund; confirm Moyasar's one-refund-per-payment rule surfaces as expected.
- **e2e-4 webhook auth live:** set `MOYASAR_WEBHOOK_SECRET`, confirm a wrong/absent `secret_token` is rejected and a correct one is accepted end-to-end.

Prerequisite: the **full** `sk_test_` secret (memory value is masked) + the publishable key in a git-ignored `apps/demo-store/.env`; Postgres is already up.

## G2 (verify during e2e) — built-in webhook route suffix

The README asserts the URL `/hooks/payment/moyasar_moyasar`. No test (and no code) pins the exact provider-id suffix Medusa v2 generates for the built-in `POST /hooks/payment/:provider` route. Confirm the real suffix while running e2e-1 and correct the README if it differs — a wrong URL silently leaves payments `pending`.

## G3 (verify during e2e) — Samsung Pay on the hosted page

No test asserts Samsung Pay availability (it has no backend code). Tied to SECURITY-FIXES Low-3: confirm Samsung Pay actually renders on the hosted invoice page, or amend the README method table.

## Minor unit additions (optional, not blocking)

- **Per-request timeout already covered in core**, but no Moyasar-level test asserts that a Moyasar call surfaces a core timeout as `KsaError` — a one-line test (fake fetch that never resolves + `sleepImpl`) would lock the contract at the provider boundary.
- **`updatePayment` in hosted mode** — current tests cover `updatePayment` only for the source/no-payment cases; add one for a session carrying `moyasar_hosted_payment_id` to pin behavior.
- **Zod session-data parse** (if Low-2 is adopted) — add a test that a malformed `source`/`callback_url` shape is rejected before any network call.

## What is NOT a gap

- Loader fail-fast, secret redaction, webhook tamper/replay/fail-closed, double-charge collapse, 3DS, hosted no-source, refund idempotency, status mapping, BigNumber shapes, and money rounding are all already tested — see the matrix in [VERIFY.md](./VERIFY.md#test-coverage-by-method--mode).
