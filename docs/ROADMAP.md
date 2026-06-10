# Medusa KSA — Delivery Roadmap

The end-to-end plan to take this repo from skeleton to a published, adoption-ready suite. Build **top to bottom** — each phase depends on the one above. Every phase has a hard **Definition of Done (DoD)**; don't advance until it's green.

**Authority chain:** `CLAUDE.md` (decisions) → `docs/adr/*` (non-negotiables) → `packages/core/CONTRACT.md` (core API) → `CONTEXT.md` (language) → this roadmap (sequence) → `docs/CONFIGURATION.md` (exact config). When in doubt, the higher document wins.

**Scope reminder:** backend-only; native Medusa admin; the *only* custom UI in the whole suite is the ZATCA onboarding wizard. Storefront knowledge is reference-only (for API design + e2e tests), never shipped.

---

## Phase map

| # | Phase | Output | Gate |
|---|---|---|---|
| 0 | Foundation & tooling | A buildable, lint-clean, CI-gated empty monorepo | `pnpm build` + `pnpm lint` + CI green on an empty PR |
| 1 | `@medusa-ksa/core` | The safety surface from `CONTRACT.md`, fully tested | 100% of CONTRACT primitives implemented + unit-tested |
| 2 | `payment-moyasar` | The reference connector (proves the pattern) | Sandbox checkout works end-to-end in `demo-store` |
| 3 | `medusa-plugin-zatca` | The flagship compliance module | Sandbox → simulation certified |
| 4 | `fulfillment-torod` | Aggregator courier provider | Sandbox shipment created in `demo-store` |
| 5 | `notification-unifonic` | Arabic SMS provider | Sandbox SMS delivered on `order.placed` |
| 6 | `create-medusa-ksa-app` | One-command starter (the install flywheel) | `npx` scaffolds a booting KSA store |
| 7 | Fan-out | Remaining payments, couriers, address, taqnyat | Each meets the per-package DoD |
| 8 | Launch & adoption | README matrix, docs, first npm publish | Packages live on npm; repo public |

---

## Phase 0 — Foundation & tooling (the "extreme config" layer)

**Goal:** a monorepo where the *machine* enforces every architectural rule, so vibe-coding can't erode it. Nothing here is feature code — it's the rails.

**Tasks** (exact file contents in `docs/CONFIGURATION.md`):
1. `git init`; `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc` (Node 20), root `LICENSE` (MIT).
2. **pnpm workspace** — `pnpm-workspace.yaml` globbing `packages/*` + `apps/*`.
3. **Turborepo** — `turbo.json` with `build → test → lint` pipeline, dependency-ordered (`^build`), cached, `core` first.
4. **TypeScript** — `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `verbatimModuleSyntax`); per-package `tsconfig.json` extending it with **project references**.
5. **Changesets** — `.changeset/config.json` (independent versioning, `access: public`, `@medusa-ksa/core` linked baseline).
6. **Lint/format** — ESLint (flat config) + Prettier + `eslint-config-prettier`. Type-aware rules on.
7. **Dependency boundaries (ADR-0003 enforcement)** — `dependency-cruiser` config: forbid package→package imports (only `@medusa-ksa/core` allowed), forbid `@medusajs/*` in `dependencies`. Wire into CI + `pnpm lint`.
8. **Version consistency** — `syncpack` to keep shared dep versions identical across packages.
9. **Commit hooks** — Husky + lint-staged (Prettier + `tsc --noEmit` + affected tests on staged files). *(Skill: `setup-pre-commit` if installed.)*
10. **CI** — `.github/workflows/ci.yml` (PR: install → build → lint → boundary check → typecheck → test, matrix Node 20) and `release.yml` (Changesets "Version Packages" PR → publish on merge, npm provenance).
11. **Community health** — `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, `.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md`.
12. **`apps/demo-store`** — a real Medusa v2 app (private, unpublished) that will register every package and run e2e against sandboxes.

**Best practices baked in:**
- Node engine pinned (`engines.node >= 20`) in every `package.json`.
- One source of truth for shared dev deps (root), packages carry only their own runtime deps.
- CI is the boundary cop — architecture violations fail the build, not review.

**DoD:** `pnpm install && pnpm build && pnpm lint && pnpm test` all pass on the empty skeleton; CI green on a no-op PR; a deliberately-wrong cross-package import **fails** the boundary check.

---

## Phase 1 — `@medusa-ksa/core`

**Goal:** implement every primitive in `packages/core/CONTRACT.md`, each with tests, so the rest of the suite is thin.

**Build order (each is red→green→refactor via the `tdd` skill):**
1. `KsaError` + `toMedusaError` — prefixing, stable codes, secret redaction.
2. `createLoader(zodSchema)` — boot validation, env fallback, human error messages.
3. `sarToHalalas` / `SarAmount` brand / `assertSar` — money, with rounding-vector tests.
4. `detectSandbox(key)`.
5. `secrets.encrypt/decrypt` (AES-256-GCM) — round-trip + tamper-detection tests.
6. `verifyWebhook` — constant-time compare + replay-tolerance tests.
7. `HttpClient` — timeout, retry/backoff/jitter, redaction, error mapping (network mocked with nock/msw).
8. `idempotencyKey` / `withIdempotency`.
9. Shared types (`KsaPaymentOptions`, …).

**Best practices:** zero suite deps (ADR-0003 graph root); `@medusajs/framework` as a peer; published as `@medusa-ksa/core` with `access: public`; every export covered by a unit test; no `any` on the public surface.

**DoD:** all CONTRACT primitives implemented; unit tests cover success + failure + security behavior (redaction, constant-time, tamper); `core` builds and publishes a dry-run cleanly.

---

## Phase 2 — `payment-moyasar` (the reference connector)

**Goal:** prove the full payment pattern once; this package becomes the template all others copy (CLAUDE.md §9.3).

**Tasks:**
1. Provider class extending Medusa's `AbstractPaymentProvider` (`src/providers/moyasar/`) — implement the full lifecycle (initiate, authorize, capture, refund, cancel, status, webhook action). *Verify exact method set against the MedusaDocs MCP.*
2. Options via `createLoader` (env: `MOYASAR_SECRET_KEY`, optional `MOYASAR_WEBHOOK_SECRET`).
3. All Moyasar API calls through core `HttpClient`; amounts as `SarAmount`.
4. Auto-wired webhook route (`src/api/hooks/...`) → `verifyWebhook` → dedupe → map to Medusa payment event.
5. Sandbox auto-detected from key prefix.
6. Unit tests (mocked HTTP) + integration test in `demo-store` against Moyasar sandbox.
7. `README.md` from the existing template; `.env.example`.

**Skills:** `building-with-medusa`, `tdd`, `building-storefronts` (reference, to confirm the checkout/session shape).

**DoD:** a SAR region with Moyasar enabled in native admin completes a sandbox payment end-to-end in `demo-store`; webhook verified; fail-fast on bad key; happy-path integration test passes. **This README + structure is now the canonical template.**

---

## Phase 3 — `medusa-plugin-zatca` (flagship)

Follow `packages/zatca/SPEC.md` §8 sub-milestones; honors ADR-0004. **Sandbox → simulation before any deadline.**

| Step | Output |
|---|---|
| 3.1 | Models (`ZatcaInvoice`, `ZatcaCredential`) + module wiring + fail-fast loader (`ZATCA_ENCRYPTION_KEY`) |
| 3.2 | `xml-builder` + `hash-chain` (serialized ICV/PIH) — validate XML offline vs ZATCA SDK |
| 3.3 | `signer` (XAdES-BES/ECDSA) + `qr` (TLV, 9 tags) — validate against known-good samples |
| 3.4 | `fatoora-client` (sandbox) + `onboard-egs` workflow (CSR→CCSID→PCSID) |
| 3.5 | `report-invoice` (B2C) end-to-end in sandbox |
| 3.6 | `clear-invoice` (B2B) + compensation + `pending_clearance` state |
| 3.7 | `order-placed` subscriber + `retry-reporting` scheduled job |
| 3.8 | Admin onboarding wizard (native admin extension — the one sanctioned UI; skill: `building-admin-dashboard-customizations`) |
| 3.9 | Simulation certification → production readiness |

**Best practices:** credentials encrypted via core `secrets`, never logged/returned; module link to Order (ADR-0001); module-level migrations via `db-generate`/`db-migrate`.

**DoD:** both flows pass in sandbox; ICV/PIH chain verified under concurrency; wizard onboards an EGS; credentials provably encrypted at rest.

---

## Phase 4 — `fulfillment-torod`

**Goal:** one aggregator = many couriers (highest leverage, CLAUDE.md §6).

**Tasks:** provider extending `AbstractFulfillmentProviderService` — `getFulfillmentOptions`, `validateFulfillmentData`, `calculatePrice`, `createFulfillment`, `cancelFulfillment`, return handling; all I/O via core `HttpClient`; loader for Torod creds; webhook/status updates if applicable.

**DoD:** a Torod shipping option appears via native admin; a sandbox shipment is created and tracked in `demo-store`.

---

## Phase 5 — `notification-unifonic`

**Tasks:** provider extending `AbstractNotificationProviderService` (`send`), attached to the `sms` channel; Arabic templates; loader for Unifonic creds; HTTP via core.

**DoD:** `order.placed` triggers a sandbox Arabic SMS; provider is pure config (no admin toggle), per CONNECTORS.md.

---

## Phase 6 — `create-medusa-ksa-app`

**Goal:** the install flywheel (CLAUDE.md §7 Path A).

**Tasks:** a CLI that scaffolds a Medusa v2 app pre-wired with the sensible KSA default set (Moyasar + ZATCA + Torod + Unifonic), 15% VAT tax region, `.env.example`, and a short setup guide. Template lives in `packages/create-medusa-ksa-app/template/`.

**DoD:** `npx create-medusa-ksa-app my-store` produces an app that boots, with all four defaults registered and VAT configured.

---

## Phase 7 — Fan-out

Apply the Phase-2 template to the rest (CLAUDE.md §9.8), each meeting the per-package DoD:
- Payments: `tap`, `hyperpay`, `myfatoorah`, `paytabs`, `stcpay`, `tabby`, `tamara`.
- Fulfillment: `smsa`, `aramex`, `spl`, `imile`.
- `address-saudi` (backend checkout/API validation hook).
- `notification-taqnyat`.

Each is a near-mechanical copy of the reference connector + the gateway's specifics — the payoff of Phases 0–2.

---

## Phase 8 — Launch & adoption

**Goal:** turn working code into stars + downloads (the program's success bar).

**Tasks:** accurate README package matrix (status badges, no fake "stable"); per-package READMEs; a docs pass; first Changesets publish to npm (provenance on); make repo public; seed `good first issue`s; announce.

**DoD:** packages resolve on npm and install into a fresh Medusa app per their README in one block; root README matrix matches reality.

---

## Cross-cutting standards

### Per-package Definition of Done (every published package)
- [ ] Registers in `medusa-config.ts` with one block; appears in native admin where applicable (no extra UI).
- [ ] Boots with only its documented env var(s); fails fast otherwise (core loader).
- [ ] All network I/O via core `HttpClient`; money as `SarAmount`; errors via `KsaError`/`toMedusaError`.
- [ ] No `@medusajs/*` in `dependencies` (peer only); no sibling-package import (ADR-0003).
- [ ] Own `README.md` (Moyasar template), `.env.example`, working sandbox, ≥1 happy-path integration test in `demo-store`.
- [ ] `exports` map per CLAUDE.md §10; built with `medusa plugin:build`.
- [ ] A `pnpm changeset` accompanies the change.
- [ ] Listed in root README matrix with an honest status badge.

### Testing strategy
- **Unit:** network mocked (nock/msw); assert retry/backoff/signature/idempotency/redaction explicitly. Never hit a real gateway.
- **Module/integration:** `@medusajs/test-utils` runners (`moduleIntegrationTestRunner`, `medusaIntegrationTestRunner`) against provider sandboxes via `demo-store`.
- **Contract:** record/replay fixtures so provider API drift is caught.

### Release & versioning
- Changesets per change → CI opens "Version Packages" PR → merge publishes. Independent SemVer per package. npm **provenance** enabled. `@medusa-ksa/core` published `public`.

### Security
- Secrets env-first, never in admin, never logged; redact at the `HttpClient` boundary. ZATCA creds encrypted at rest. `SECURITY.md` with a disclosure path. Run `/security-review` before each publish.

---

## Skill routing (which skill drives which phase)

| Work | Skill |
|---|---|
| Any backend module/provider/workflow | `building-with-medusa` (+ MedusaDocs MCP) |
| ZATCA admin wizard | `building-admin-dashboard-customizations` |
| Migrations | `db-generate`, `db-migrate` |
| Test-first feature work | `tdd` |
| Hard bug / perf regression | `diagnose` |
| Stress-testing a design before building | `grill-with-docs` (records decisions as ADRs) / `grill-me` (no doc side-effects) |
| Sanity-checking a data model / state machine | `prototype` |
| Refactors for testability/navigability | `improve-codebase-architecture` |
| Designing provider APIs to fit real checkout / e2e | `building-storefronts`, `storefront-best-practices` (reference only) |
| Long session → continuation | `handoff` |
