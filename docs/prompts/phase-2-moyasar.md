# Phase 2 Execution Prompt — `medusa-payment-moyasar` (reference connector)

> Paste everything below the line into a fresh session opened in this repo. It is self-contained.

---

You are continuing **medusa-ksa**, an open-source, **backend-only** suite of Medusa v2 plugins for Saudi e-commerce. Phase 0 (monorepo tooling) and Phase 1 (`@medusa-ksa/core`, fully tested) are complete and on `main`. Your job is **Phase 2: build `medusa-payment-moyasar`** — the Moyasar payment provider. This is the **reference connector**: every other gateway will be copied from it, so it must be exemplary.

Working directory: `/Users/khaledafify/RiderProjects/Medusa` (pnpm + Turborepo monorepo, Node 20+, TypeScript strict).

## 0. Read first (authority chain — higher wins; do not skip)

- `CLAUDE.md` — decisions (§3 scope, §4 naming, §6 UI, §7 DX rules, §10 conventions, "Git & commits")
- `docs/adr/0001`–`0004` — non-negotiable rules
- `packages/core/CONTRACT.md` **and** `packages/core/src/*.ts` — the real exported primitives/signatures you MUST reuse
- `docs/ROADMAP.md` — Phase 2 + per-package Definition of Done + testing strategy
- `docs/CONFIGURATION.md` — canonical `package.json` + build config
- `docs/CONNECTORS.md` — payment-provider mapping
- `CONTEXT.md` — shared glossary (use this vocabulary)
- `packages/payments/moyasar/README.md` — already written; your implementation must match what it documents

Use the **`building-with-medusa`** skill + the **MedusaDocs MCP** for all Medusa v2 specifics, and the **`tdd`** skill to build test-first. `building-storefronts`/`storefront-best-practices` are reference-only (to understand the checkout flow your provider serves) — do not add storefront code.

## 1. Objective

A production-quality `medusa-payment-moyasar` Medusa v2 **Payment Provider** for Moyasar (Mada, cards, Apple Pay, STC Pay) such that a SAR region can take a **sandbox payment end-to-end**, with comprehensive unit tests and every repo gate green. It must be clean enough that the next gateway is a near-mechanical copy.

## 2. Scope / non-goals

- **Backend only.** No storefront code (no React, no hosted-form snippets shipped in the package). Fiat **SAR** only — no cryptocurrency.
- **No custom admin UI** — payment providers surface in native admin automatically.

## 3. Hard guardrails (MUST / NEVER)

Use `@medusa-ksa/core` for everything it covers (ADR-0002):
- All Moyasar HTTP through core **`HttpClient`** (timeout, retry, redaction). **Never** call `fetch`/axios directly.
- Validate options with core **`createLoader`**, env-first (`MOYASAR_SECRET_KEY`, optional `MOYASAR_WEBHOOK_SECRET`). **Never** read `process.env` directly in the provider.
- Verify webhooks with core **`verifyWebhook`**. **Never** hand-roll HMAC.
- Money as **`SarAmount`** / `sarToHalalas`. **Never** multiply by 100 by hand.
- Sandbox via **`detectSandbox(key)`**. **Never** a "mode" flag.
- Errors via **`KsaError`** / **`toMedusaError`**. **Never** leak a secret in a message or log line.
- Double-charge safety: use core **idempotency** on capture/refund.

Boundaries & hygiene:
- `@medusajs/*` are **peerDependencies** (+ devDependencies for build/test). The only intra-repo import allowed is **`@medusa-ksa/core`** (`workspace:*`). Never import another package (ADR-0003; dependency-cruiser enforces this).
- It is a **Provider** registered in the Payment module's `providers` array (ADR-0001) — no cross-module FKs, no custom module.
- Commits: clean, short, imperative. **No `Co-Authored-By`, no mention of Claude/AI/Codex** anywhere. Keep `.claude/`, `.cursor/`, `.codex/`, `.agents/`, `AGENTS.md`, `.mcp.json` git-ignored — never commit them.
- **Do not trust memory** for Medusa or Moyasar APIs — verify against live docs.

## 4. Verify against live sources (don't trust memory)

- **Medusa v2 Payment Provider contract** — via MedusaDocs MCP / `building-with-medusa`: the exact abstract base (likely `AbstractPaymentProvider` from `@medusajs/framework/utils`), the required method set and their current signatures/return shapes, the static `identifier`, and the `getWebhookActionAndData` webhook pattern. Confirm before coding.
- **Moyasar API** — https://docs.moyasar.com : base URL, auth (HTTP Basic, secret key as username + empty password), create/fetch/refund payment endpoints, the payment object + status values, amounts in **halalas**, and the **webhook payload + signature scheme**. Confirm endpoints, fields, and signing.

## 5. File layout (under `packages/payments/moyasar/`)

```
package.json
tsconfig.json            # mirror packages/core (lint/typecheck sees tests)
tsconfig.build.json      # excludes *.test.ts  (note: connectors build with `medusa plugin:build`, not tsc)
vitest.config.ts
.env.example             # MOYASAR_SECRET_KEY, MOYASAR_WEBHOOK_SECRET
src/providers/moyasar/index.ts     # provider registration export
src/providers/moyasar/service.ts   # MoyasarProviderService extends AbstractPaymentProvider
src/providers/moyasar/client.ts    # thin Moyasar API wrapper over core HttpClient
src/providers/moyasar/types.ts     # options + Moyasar req/resp types
src/api/hooks/payment/moyasar/route.ts  # auto-wired webhook (verify the route path convention)
src/**/*.test.ts
README.md                # already exists — update only if implementation diverges
```

## 6. `package.json` (adapt from `docs/CONFIGURATION.md`)

- `name`: `medusa-payment-moyasar`, `version` `0.1.0`, MIT, `repository` `khaledafify/medusa-ksa` `directory` `packages/payments/moyasar`
- `keywords`: `medusa-plugin, medusa-v2, payment, moyasar, saudi, ksa, mada`
- `type: module`, `engines.node >=20`
- `scripts`: `build: "medusa plugin:build"`, `dev: "medusa plugin:develop"`, `test: "vitest run"`, `lint: "eslint ."`, `typecheck: "tsc --noEmit"`
- `exports` map per CLAUDE.md §10 (`./providers/* → ./.medusa/server/src/providers/*/index.js`, etc.); `files: [".medusa/server","README.md","LICENSE"]`
- `dependencies`: `{ "@medusa-ksa/core": "workspace:*" }` (+ `zod` if used)
- `peerDependencies`: `@medusajs/framework`, `@medusajs/medusa` `^2.13.0`
- `devDependencies`: `@medusajs/framework`, `@medusajs/medusa`, `vitest ^2.1.8`, `typescript ^5.7.3`, `@types/node ^20` — **keep versions identical to root/core** (syncpack enforces)
- `publishConfig: { access: "public", provenance: true }`

## 7. Build plan (TDD: red → green → refactor)

1. Scaffold `package.json` + `tsconfig(.build).json` + `vitest.config.ts`; `pnpm install`; confirm `@medusa-ksa/core` resolves.
2. `types.ts`: provider options (`apiKey?`, `webhookSecret?`, `capture?` default true, `currency?` default `SAR`) + Moyasar payment types.
3. `client.ts`: `MoyasarClient` on core `HttpClient` (baseUrl `https://api.moyasar.com/v1`, Basic auth from the secret key, `timeoutMs`, retry). Methods: `createPayment`, `fetchPayment`, `refundPayment`. **Test first** with an injected fake `fetch`: assert auth header, halalas amounts, non-2xx → `KsaError`, secret redaction.
4. `service.ts`: `MoyasarProviderService extends AbstractPaymentProvider`. Validate options via `createLoader` (fail-fast at boot). Implement each required method, mapping the Medusa payment lifecycle ↔ Moyasar, returning the shapes Medusa expects. `SarAmount` for money, `detectSandbox` for mode, `toMedusaError` for failures, `capture` option controls authorize-vs-capture. **Unit-test every method** (success + failure) against a mocked client.
5. `route.ts` (webhook): verify signature via core `verifyWebhook` using `MOYASAR_WEBHOOK_SECRET`, dedupe by event id, map event → Medusa payment action, return 2xx fast. Test: valid → action, bad sig → rejected, replay handled.
6. `index.ts`: export the provider registration so `resolve: "medusa-payment-moyasar/providers/moyasar"` works.
7. Confirm fail-fast: missing/invalid `MOYASAR_SECRET_KEY` throws a clear `KsaError` at boot.

## 8. Verification process & Definition of Done

Run from the repo root and make **all green**:
- `pnpm --filter medusa-payment-moyasar build` (emits `.medusa/server`) → exit 0
- `pnpm --filter medusa-payment-moyasar test` → all unit tests pass: client (auth/halalas/errors/redaction), every service method (success + failure), webhook (valid/invalid/replay), fail-fast loader
- `pnpm --filter medusa-payment-moyasar typecheck` → exit 0
- `pnpm lint` (root) → eslint + **dependency-cruiser (0 boundary violations — proves only `@medusa-ksa/core` is imported and `@medusajs/*` stay peer)** + syncpack (versions consistent) → exit 0
- **Adversarial security pass** (use `diagnose`/`/security-review` mindset): no secret ever logged or in an error message; webhook rejects tampered/replayed payloads; capture/refund are idempotent (a retry can't double-charge); amounts are integer halalas end-to-end.
- Meet the **per-package DoD** in `docs/ROADMAP.md`.

**Live sandbox integration (may be DEFERRED):** if Moyasar `sk_test_` keys + Postgres are available, register the package in `apps/demo-store`, create a SAR region, enable Moyasar in admin, create a payment session, and confirm a sandbox payment + webhook round-trip. If deferred, **say so explicitly** and keep the status at `🚧 Beta` — `✅ Stable` requires the passing sandbox e2e (CLAUDE.md §11; never fake "stable").

## 9. Commit & deliver

- `pnpm changeset` (minor for `medusa-payment-moyasar`).
- Commit in small, clean chunks (e.g. `add moyasar client`, `add moyasar provider service`, `add moyasar webhook route`) — no AI attribution.
- Push to `main` (`khaledafify/medusa-ksa`).
- Update the root README package matrix status for `medusa-payment-moyasar` (`🚧 Beta`, or `✅ Stable` only if the live sandbox e2e passed).
- Verify `.agents/`, `AGENTS.md`, `.claude/`, `.cursor/`, `.codex/`, `.mcp.json`, `node_modules`, `.medusa`, `dist` are NOT committed.

## Done =
`medusa-payment-moyasar` builds; all unit tests + repo gates green; uses only core primitives; respects every ADR; README/`.env.example` accurate; changeset added; pushed; status set honestly. It is now THE template — keep it clean enough to copy for the next gateway.
