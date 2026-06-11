# Phase 3 Execution Runner — `medusa-plugin-zatca` (B2C v1) — for Cursor

> Paste everything below the line into Cursor. It is a **prescriptive task runner**. Every design decision is already made. Your job is to **execute, verify, commit — one task at a time** — not to think, redesign, or improvise.

---

You are implementing Phase 3 of the **medusa-ksa** monorepo: `medusa-plugin-zatca`, a ZATCA/Fatoora Phase-2 e-invoicing **custom module** for Medusa v2. Working dir: `/Users/khaledafify/RiderProjects/Medusa`.

## ROLE — read first, obey exactly
- You are an **executor, not a designer.** All architecture is decided in the PRD + ADRs below. **Do not** redesign, choose alternatives, "improve," or deviate.
- **If anything is ambiguous or seems to need a decision: STOP and ask. Do not guess, do not stub, do not fake.**
- Work the tasks **in order, one at a time.** After each task, run its **Verification Gate**. Green → commit (clean) → next. Red → fix; after **2 failed attempts** on the same gate, **STOP and report** the exact error and what you tried. **Never advance on a red gate. Never delete or weaken a test to pass.**
- **Never trust memory for any external detail** (ZATCA endpoints, UBL shape, XAdES canonicalization, QR TLV bytes, CSID/Reporting APIs). Verify against the ZATCA Developer Portal / Validation SDK and the chosen open-source library, every time.

## READ BEFORE STARTING (do not write code until you have)
1. `docs/prds/phase-3-zatca.md` — THE spec: locked decisions, data models, slices, guard gates, DoD.
2. `packages/zatca/SPEC.md` — the deep ZATCA design.
3. `docs/adr/0001` (module isolation/links), `0002` (core safety surface), `0003` (peer deps/boundaries), `0004` (hash chain mechanism), `0006` (B2C/single-EGS scope), `0007` (signing adapt-and-validate-offline).
4. `packages/core/CONTRACT.md` + `packages/core/src/*.ts` — the primitives you MUST reuse.
5. `CLAUDE.md` (§3 scope, §7 DX, §10 conventions, "Git & commits"), `CONTEXT.md` (ZATCA glossary — use these exact terms).
6. `packages/payments/moyasar/**` — copy its package structure, dual tsconfig, vitest config, core-usage style, and test rigor. **This is your template for "what good looks like."**

## ABSOLUTE RULES (never violate — these are gate failures if broken)
- **B2C only** (ADR-0006): Simplified invoices via Reporting. **No** B2B/Standard/Clearance, **no** multi-EGS, **no** buyer-VAT routing. Single EGS (`ZatcaCredential` is effectively a singleton).
- **Custom MODULE, not a provider** (ADR-0001). `ZatcaInvoice` ↔ Order via a **Module Link** in `src/links/` (one link per file), never a foreign key. Cross-module reads via `query.graph()`.
- **Core for everything** (ADR-0002): all HTTP via core `HttpClient`; all secrets via core `secrets`; all errors `KsaError`/`toMedusaError`; money as `SarAmount`. **No** raw `fetch`/axios, **no** `process.env` reads in logic, **no** hand-rolled crypto for transport, **no** `*100` float money.
- **Boundaries** (ADR-0003): `@medusajs/*` are `peerDependencies` (+ dev). The only intra-repo import is `@medusa-ksa/core`. No sibling-package imports.
- **Credential security:** `private_key` + CSIDs **encrypted at rest** (core `secrets`, AES-256-GCM, key from `ZATCA_ENCRYPTION_KEY`, length-validated, fail-fast at boot). **Never logged, never returned from any API route.** The wizard sees **status only**.
- **Signing/QR/XML** (ADR-0007): adapt a **proven open-source ZATCA library**, never hand-roll from the PDF; **validate every output offline against ZATCA SDK golden samples before any network call**; honor the source license (record it).
- **Hash chain** (ADR-0004): ICV/PIH allocation under a **per-EGS Postgres advisory lock** (or `SELECT … FOR UPDATE` on a chain-head row), wrapping `allocate→build→hash→sign→persist`; submission **outside** the lock. ICV consumed at generation (no reuse).
- **Trigger** = `payment_captured` default (configurable `order_placed`); **idempotent one `ZatcaInvoice` per order.**
- **Hygiene:** commits clean + imperative, **no `Co-Authored-By`, no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret. Don't fake capability or status.

## STANDARD PER-TASK LOOP (apply to EVERY task)
1. Write the tests first from the task's acceptance criteria, then the code.
2. Run the task **Verification Gate** + the **Global Gate** below.
3. Green → `git add` the task files (+ a `pnpm changeset` once, at the first publishable change) → commit clean → next task.
4. Red → fix; after 2 attempts STOP and report. Never skip/weaken a gate.

## GLOBAL GATE (must pass after every task)
```
pnpm --filter medusa-plugin-zatca build       # medusa plugin:build
pnpm --filter medusa-plugin-zatca test
pnpm --filter medusa-plugin-zatca typecheck
pnpm lint                                      # eslint + dependency-cruiser (0 violations) + syncpack
```

## PREREQUISITES (S1–S3 need none; confirm before S4 — if missing, STOP and report)
- ZATCA Fatoora developer-portal / **sandbox** access + the per-environment endpoint URLs.
- `ZATCA_ENCRYPTION_KEY` (32-byte base64), `ZATCA_ENV`, `ZATCA_TRIGGER` in `apps/demo-store/.env` (git-ignored).
- The chosen **open-source ZATCA library** identified + its license recorded.
- **ZATCA Validation SDK golden samples** available to byte-match against (S2/S3).

---

# TASKS (execute in order)

## S1 — Module skeleton
- **T1.1 Scaffold.** Create `packages/zatca/package.json` (name `medusa-plugin-zatca`, `build: medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`), `tsconfig.json` + `tsconfig.build.json` (mirror `packages/payments/moyasar`), `vitest.config.ts`, `.env.example` (`ZATCA_ENV`, `ZATCA_ENCRYPTION_KEY`, `ZATCA_TRIGGER`).
  **Gate:** `pnpm install` resolves core; typecheck passes; `pnpm lint` syncpack versions match root/core.
- **T1.2 Models.** `src/modules/zatca/models/zatca-credential.ts` + `zatca-invoice.ts` with exactly the fields in PRD §3. Secret fields are plain columns (encryption happens in the service, not the model).
  **Gate:** typecheck; `medusa plugin:build` compiles the models.
- **T1.3 Module wiring.** `service.ts` (extends `MedusaService`), `index.ts` (module definition), loaders dir.
  **Gate:** module registers in `apps/demo-store` `medusa-config.ts` and the app boots.
- **T1.4 Module Link.** `src/links/zatca-invoice-order.ts` linking `ZatcaInvoice` → Order (ADR-0001).
  **Gate:** `medusa db:migrate` syncs the link; a test creates a link and reads it via `query.graph()`.
- **T1.5 Fail-fast loader.** Validate `ZATCA_ENCRYPTION_KEY` (length) + `ZATCA_ENV` via core `createLoader`/`validateOptions`.
  **Gate:** test — boot throws `KsaError` naming the var on missing/short key; boots clean with valid config.
- **T1.6 Migrations.** `medusa db:generate zatca` + `db:migrate`.
  **Gate:** migration file generated; applies; tables exist (verify in pg).

## S2 — `xml-builder` + `hash-chain` (offline-validated)
- **T2.1 Vendor reference + samples.** Identify the open-source ZATCA library to adapt; record its name + license in the package README and an ADR note if needed. Add the **ZATCA SDK golden samples** as test fixtures under `src/modules/zatca/__fixtures__/`.
  **Gate:** fixtures present; license recorded; STOP-and-report if samples/library unavailable.
- **T2.2 `xml-builder`.** `services/xml-builder.ts` — build a **Simplified UBL 2.1** invoice from a `ZatcaInvoice` + order data (embed UUID, ICV, PIH placeholders).
  **Gate:** for a fixed sample input, the generated XML **byte-matches** the golden sample (offline test).
- **T2.3 `hash-chain`.** `services/hash-chain.ts` — acquire per-EGS Postgres advisory lock; read chain head (last ICV + last `invoice_hash`); allocate ICV=last+1, PIH=last hash; compute SHA-256 `invoice_hash` over the canonical XML.
  **Gate:** unit test of allocation; **CONCURRENCY test** — N parallel allocations yield strictly sequential ICVs + correct PIH links, **zero duplicates/stale** (use a real pg advisory lock against the test DB).
- **T2.4 Generate step.** Compose builder + chain into one `generate` path persisting a `pending` `ZatcaInvoice`.
  **Gate:** a generated invoice has correct ICV/PIH/hash and XML matching the sample.

## S3 — `signer` + `qr` (offline-validated)
- **T3.1 `signer`.** `services/signer.ts` — XAdES-BES/ECDSA stamp using the EGS `private_key` (decrypt via core `secrets` at point of use; never log it).
  **Gate:** signed XML **byte-matches** the golden signed sample (offline).
- **T3.2 `qr`.** `services/qr.ts` — TLV 9-tag Base64 QR, with **tags 6/7/8 derived from the signed hash**.
  **Gate:** QR Base64 **byte-matches** the golden sample (offline).
- **T3.3 Integrate.** Wire sign + qr into the generate pipeline (after hash, inside the lock's critical section per ADR-0004).
  **Gate:** full `generate` (xml→hash→sign→qr) byte-matches the end-to-end golden sample; a secret-leak test asserts the private key never appears in logs/errors.

## S4 — `fatoora-client` + onboarding (sandbox)
- **T4.1 `fatoora-client`.** `services/fatoora-client.ts` over core `HttpClient`, per-environment base URL (sandbox/simulation/production from `ZATCA_ENV`).
  **Gate:** unit tests (mocked fetch) — correct endpoints/headers per environment, non-2xx → `KsaError`, no secret in error messages.
- **T4.2 CSR.** `onboard-egs` workflow step: generate EC keypair + **CSR** embedding VAT number, EGS serial, and ZATCA's cert-template extension.
  **Gate:** CSR contains the required fields (offline test).
- **T4.3 Compliance CSID.** Submit CSR + **OTP** → store **CCSID encrypted**, status `compliance`.
  **Gate:** sandbox step succeeds; test asserts CCSID is encrypted at rest and absent from any response/log.
- **T4.4 Compliance checks.** Submit the required sample **Simplified** documents to pass ZATCA's compliance checks.
  **Gate:** checks pass in sandbox.
- **T4.5 Production CSID.** Obtain **PCSID** → store **encrypted**, status `production`.
  **Gate:** sandbox onboarding reaches `production`; secret-never-leaks test passes.
- **T4.6 Admin API routes.** `api/admin/zatca/**` driving the workflow (accept org details + OTP, return **status only**).
  **Gate:** onboarding completes via the routes headlessly; a test asserts **no secret** in any route response.

## S5 — `report-invoice` + subscriber
- **T5.1 `report-invoice` workflow.** generate (S2/S3) → persist `ZatcaInvoice(pending)` → report to sandbox → `reported`/`rejected`, store `zatca_response`.
  **Gate:** a captured order produces a signed, QR-stamped Simplified invoice **reported in sandbox**.
- **T5.2 Subscriber.** `subscribers/payment-captured.ts` (honor `ZATCA_TRIGGER`) → route order → `report-invoice`; **idempotent** (guard on an existing `ZatcaInvoice` for `order_id`).
  **Gate:** test — re-firing the trigger creates **no second invoice**; the `order_placed` trigger option works.

## S6 — `retry-reporting` job
- **T6.1 Claim.** `jobs/retry-reporting.ts` — `SELECT … FOR UPDATE SKIP LOCKED` to claim pending/failed invoices in the 24h window.
  **Gate:** **exactly-once** under concurrent job runs (test with two simultaneous claims).
- **T6.2 Backoff + terminal.** Exponential backoff, `attempts` tracking, 24h window; success → `reported` (incl. "reported with warnings"), exhausted → `failed`.
  **Gate:** backoff + terminal transitions (test).
- **T6.3 Alert.** Terminal `failed` emits an **admin notification** (notification module); the **order is never mutated**.
  **Gate:** test — failed invoice emits a notification; the order is untouched.

## S7 — Admin wizard (the one sanctioned UI)
- **T7.1 Wizard.** Native admin route **Settings → ZATCA** (skill: `building-admin-dashboard-customizations`): status banner + onboarding wizard (org details → Generate CSR → enter OTP → Get Compliance CSID → Run Compliance Checks → Activate Production) on the S4 routes.
  **Gate:** a merchant completes onboarding via the wizard in sandbox; the wizard shows **status only**, never a secret.
- **T7.2 Dashboard.** Recent invoices + `reported`/`failed` counts + a **retry-failed** action.
  **Gate:** dashboard reflects invoice states; retry-failed re-enqueues a failed invoice.

## S8 — Simulation certification + docs
- **T8.1 Simulation.** Re-run the full pipeline against the **simulation** environment.
  **Gate:** simulation invoices accepted.
- **T8.2 Docs + status.** `packages/zatca/README.md` (follow the moyasar README template): B2C-only scope, **B2B Clearance + multi-EGS = future work**, config, onboarding steps, go-live. Update root README matrix status. Add a `pnpm changeset`.
  **Gate:** README honest (no faked scope/status); status `🚧 Beta` after sandbox, `✅ Stable` only after simulation cert; changeset present.

---

## DELIVER / STOP CONDITIONS
- Commit after every green task (clean message, no AI attribution). Push to `main` when a slice completes (`git push origin main`; remote is SSH).
- **STOP and report to the human** if: a prerequisite is missing, an external API behaves differently than the SPEC/PRD says, a golden sample won't match after 2 attempts, or any gate stays red after 2 attempts. Do **not** invent a workaround.
- **DONE** = all slices' gates green; a captured B2C order yields a signed, QR-stamped Simplified invoice, hash-chained under concurrency, reported in sandbox and certified in simulation; onboarding works via routes + wizard; credentials encrypted and never exposed; reporting engine exactly-once with failure alerting; README honest. Correctness over speed — this signs legal tax documents.
