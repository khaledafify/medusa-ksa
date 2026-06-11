# Phase 4 Codex Execution Plan — `medusa-fulfillment-torod`

> For a low-trust, cheap executor (Codex). Maximally explicit. **No design decisions, no invention, no faking.** Every task has an automated gate **and** a self-audit **and** a second read. A human reviews everything after.

---

## GOAL (paste this into Codex's goal/objective)

> Implement `medusa-fulfillment-torod`, a Medusa v2 **Fulfillment provider** for the Torod courier aggregator, in the medusa-ksa monorepo at `/Users/khaledafify/RiderProjects/Medusa`, exactly as specified in `docs/prds/phase-4-torod.md` and `docs/prompts/phase-4-codex.md`. It exposes **one shipping option per Torod courier**, returns **live rates** at checkout, **books shipments at fulfillment time** with on-demand labels, **syncs tracking** back to the Medusa order, and **books returns**. Reuse `@medusa-ksa/core` for all HTTP/config/errors/webhooks/money — never reimplement them. Follow the existing `packages/payments/moyasar` package as the quality bar. Produce **clean, fully-typed code with zero magic strings**, comprehensive tests, and Medusa-correct behavior that integrates with orders and the native admin Shipping settings. Work **one task at a time**; after each task pass its **two verification gates and a second read**; **commit clean** (no AI attribution); and **STOP and report** rather than guess, stub, fake, or deviate. A human reviews every slice.

---

## OPERATING RULES (a low-trust agent must obey)
1. **You are an executor, not a designer.** All decisions are in the PRD + ADRs. Do not choose alternatives or "improve."
2. **Verify Torod's API against docs.torod.co before coding any call.** Never invent an endpoint, field, status value, or auth scheme.
3. **Never trust memory for Medusa types.** Confirm `AbstractFulfillmentProviderService`'s exact method set + input/output types via the `building-with-medusa` skill / MedusaDocs MCP and the installed `@medusajs/*` packages.
4. **STOP and report** (do not work around) if: a prerequisite is missing, the docs contradict the PRD, a gate stays red after 2 attempts, or a task needs a decision.
5. **No fabrication.** No fake data, no stubbed "TODO later" in shipped code paths, no faked test pass, no faked README status.
6. Commits: clean, imperative, **no `Co-Authored-By`, no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret.

## READ FIRST (do not code until done)
- `docs/prds/phase-4-torod.md` (the spec) · `docs/adr/0001,0002,0003,0008,0009`
- `packages/core/CONTRACT.md` + `packages/core/src/*.ts` (primitives to reuse)
- `CLAUDE.md` (§3 scope, §6 UI, §7 DX, §10 conventions, Git & commits) · `CONTEXT.md` (Fulfillment glossary — use these terms)
- `packages/payments/moyasar/**` (structure, dual tsconfig, vitest, core usage, test rigor — your quality bar)

## PREREQUISITES (confirm before S2; if missing → STOP and report)
- `TOROD_API_KEY` (sandbox) in `apps/demo-store/.env` (git-ignored).
- Access to docs.torod.co.

---

## NO MAGIC STRINGS — the constants contract (S1 deliverable, used everywhere)

Create `packages/fulfillment/torod/src/providers/torod/constants.ts` and import from it everywhere. **Every literal below must be a named export — no inline string literals for any of these anywhere in src.** A lint/grep check enforces it (see Gate B).

- `PROVIDER_ID = "torod"` (the provider `identifier`).
- `TOROD_PREFIX = "torod"` (KsaError prefix).
- `ENV` map: `TOROD_API_KEY`, `TOROD_BASE_URL`, `TOROD_DEFAULT_WEIGHT_KG`, `TOROD_WEBHOOK_SECRET`.
- `TOROD_ENDPOINTS` — every API path (rates, couriers, create shipment, label, track, cancel, return, cities) as named fields, filled from `TOROD-API-NOTES.md`. No path string inline in `client.ts`.
- `optionIdForCourier(courierCode)` + `courierCodeFromOptionId(id)` — the **only** way to build/parse a fulfillment-option id; never hand-concatenate.
- `FULFILLMENT_DATA_KEYS` — every key the provider reads/writes on fulfillment/session data (`torodShipmentId`, `torodCourierCode`, `trackingNumber`, `labelUrl`, `cityCode`, …).
- `TOROD_STATUS` enum (Torod's status strings) + `TOROD_STATUS_TO_MEDUSA` map (Torod status → Medusa fulfillment state: shipped/delivered/canceled/…). Mapping is data, not `if`-chains of literals.
- `TOROD_WEBHOOK_EVENTS` (event type strings).
- `DEFAULTS` — `TIMEOUT_MS`, `RETRY`, etc. (numbers, named).
- Error `code`s reuse `KsaErrorCodes` from core; if a Torod-specific code is needed, add it to core, not inline.

---

## STANDARD PER-TASK PROCEDURE — run all three for EVERY task

**GATE A — Automated (must all be exit 0):**
```
pnpm --filter medusa-fulfillment-torod build      # medusa plugin:build
pnpm --filter medusa-fulfillment-torod test
pnpm --filter medusa-fulfillment-torod typecheck
pnpm lint                                          # eslint + dependency-cruiser (0 violations) + syncpack
```

**GATE B — Self-audit checklist (answer YES to every line, or STOP and fix):**
- [ ] **No magic strings** — every courier id, status, env var, endpoint, metadata key, event name is a named constant in `constants.ts` (grep the diff: no inline string literal matches a known constant).
- [ ] **No `any` / `as any` / `@ts-ignore` / `@ts-expect-error`** in non-test code.
- [ ] **All HTTP via core `HttpClient`** — zero `fetch(`/axios in src.
- [ ] **No `process.env`** read outside the `createLoader`/options layer.
- [ ] **No secret in logs or errors** — a test asserts the API key/webhook secret never appears in a thrown message (core redaction).
- [ ] **Medusa shapes are correct** — the method's return value matches the `AbstractFulfillmentProviderService` output type (name the type in a code comment); confirmed against installed `@medusajs/*`.
- [ ] **Clean code** — functions small + single-responsibility; public methods have JSDoc; names match `CONTEXT.md`; no dead code; no commented-out code.
- [ ] **Tests** — success + failure + the exact corner case named in the task; network mocked (inject fetch); no real network in unit tests.
- [ ] **Boundaries** — only `@medusa-ksa/core` imported intra-repo; `@medusajs/*` are peer (dependency-cruiser passed).

**GATE C — Second read (double verification):** re-open the diff and read it as if reviewing someone else's PR. Confirm the task's **Acceptance** literally holds, re-run Gate A, then commit. If anything is off, fix and repeat B+C. **Only commit when A+B+C are all green.**

---

## CLEAN CODE & MEDUSA BEST PRACTICES (apply throughout)
- Provider class `extends AbstractFulfillmentProviderService`, `static identifier = PROVIDER_ID`; implement the **exact** required method set (verify the list — likely `getFulfillmentOptions`, `validateFulfillmentData`, `validateFulfillmentOption`, `canCalculate`, `calculatePrice`, `createFulfillment`, `cancelFulfillment`, `createReturnFulfillment`, `getFulfillmentDocuments`, `getReturnDocuments`, `getShipmentDocuments`, `retrieveDocuments` — implement what the version defines; do not invent).
- **Orders compatibility:** `createFulfillment` builds the Torod shipment from the order's items + shipping address + origin stock location; tracking number + label must surface on the order's fulfillment in admin; `cancelFulfillment` reflects on the order; `createReturnFulfillment` ties into Medusa's return (RMA) flow; amounts via `SarAmount`.
- **Admin settings compatibility:** after registering in the Fulfillment module `providers` array in `apps/demo-store/medusa-config.ts`, the provider must be **selectable when an admin adds a Shipping Option** in Settings → Locations & Shipping, with `getFulfillmentOptions` populating the choices. **No custom UI** (CLAUDE.md §6). Verify it appears.
- Thin methods, pure helpers, `KsaError`/`toMedusaError` at boundaries, deterministic + injectable I/O for tests, no hidden global state.

---

# TASK CHECKLIST (do in order; each task = Procedure A+B+C)

### S0 — Ground the API (before any code)
- [ ] Read docs.torod.co; write `packages/fulfillment/torod/TOROD-API-NOTES.md` with the **real** auth scheme + every endpoint (rates, couriers, create shipment, label, track, cancel, return, cities), request/response field names, the **webhook-vs-polling** answer, and the webhook signature/token scheme. If the docs contradict the PRD → **STOP and report.**

### S1 — Scaffold, constants, loader, client
- [ ] **T1.1** Scaffold the package (package.json `medusa-fulfillment-torod`, `build: medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`), dual tsconfig + vitest (mirror moyasar), `.env.example`. *Accept:* install resolves core; typecheck; syncpack consistent.
- [ ] **T1.2** `constants.ts` — the full constants contract above. *Accept:* every later file imports from it; zero target literals inline.
- [ ] **T1.3** Options schema + `createLoader` (`TOROD_API_KEY` required; `TOROD_BASE_URL`/`TOROD_DEFAULT_WEIGHT_KG`/`TOROD_WEBHOOK_SECRET` optional). *Accept:* boot throws `KsaError` naming the env var on missing key (test); boots otherwise.
- [ ] **T1.4** `TorodClient` over core `HttpClient` (base URL + auth from constants/notes). *Accept:* mocked-fetch tests — auth header correct, non-2xx → `KsaError`, no key in error.

### S2 — Provider skeleton, options, rates
- [ ] **T2.1** Provider class skeleton (`extends AbstractFulfillmentProviderService`, `static identifier = PROVIDER_ID`); register in `apps/demo-store/medusa-config.ts`. *Accept:* demo-store boots; provider appears in Settings → Shipping when adding a Shipping Option (admin compatibility — verify).
- [ ] **T2.2** `getFulfillmentOptions` — one option per courier (ids via `optionIdForCourier`). *Accept:* one stable option per courier.
- [ ] **T2.3** `calculatePrice` — live rate-shop (weight from cart items, origin from stock location, destination from cart address). *Accept:* returns the option's courier rate (mocked Torod); **missing weight ⇒ unavailable**, **unserviceable city ⇒ unavailable** (tests) — never a guessed price; `TOROD_DEFAULT_WEIGHT_KG` only when set.
- [ ] **T2.4** `validateFulfillmentData` — serviceability + city-code mapping. *Accept:* valid passes; unknown/unserviceable city → clear `KsaError`.

### S3 — Book, label, cancel (orders compatibility)
- [ ] **T3.1** `createFulfillment` — book at fulfillment; store `torodShipmentId` + `trackingNumber` (+ cached `labelUrl` if sync) on fulfillment data; build the shipment from the **order** items/address/origin. *Accept:* sandbox booking returns tracking + shipment ref; tracking surfaces on the order fulfillment in admin.
- [ ] **T3.2** Document methods (`getFulfillmentDocuments` etc.) — fetch the **label on demand**. *Accept:* label retrievable whether Torod returns it sync or async.
- [ ] **T3.3** `cancelFulfillment` — cancel if cancellable; terminal = idempotent no-op. *Accept:* cancel works; double-cancel / delivered = no-op (test).

### S4 — Tracking sync
- [ ] **T4.1** Auto-wired webhook route verified via core `verifyWebhook`/`verifySecretToken`; map `TOROD_STATUS_TO_MEDUSA` → mark the order's fulfillment `shipped`/`delivered`; idempotent under redelivery. **If notes show no webhooks → implement a polling job instead** (note it). *Accept:* a tracking event flips fulfillment status on the order; tampered/replayed rejected; redelivery no-op.

### S5 — Returns
- [ ] **T5.1** `createReturnFulfillment` — reverse Torod shipment + on-demand return label, tied to Medusa's return flow. **If Torod's return API is genuinely separate → STOP, defer, README future-work note.** *Accept:* sandbox return booking returns reverse tracking/label, or a documented deferral.

### S6 — Free shipping (Promotion, not provider) + docs
- [ ] **T6.1** Seed a configurable **250 SAR free-shipping Promotion** in `apps/demo-store` setup (note it for `create-medusa-ksa-app`). Provider unchanged (ADR-0009). *Accept:* demo-store has the seeded promotion; **a test/grep asserts the provider source has no hard-coded free-shipping threshold.**
- [ ] **T6.2** `packages/fulfillment/torod/README.md` (moyasar template): couriers, config, **"provider quotes truth; free shipping is a Promotion"**, returns status, individual-courier packages = future work. Update root README matrix. *Accept:* README honest; no faked couriers/scope/status.

### S7 — Sandbox e2e + ship
- [ ] **T7.1** Rate → book → track → (return) end-to-end against Torod sandbox in `apps/demo-store`; `pnpm changeset` (minor). *Accept:* e2e green; status `🚧 Beta` (sandbox) → `✅ Stable` only if full e2e green; changeset present. Push to `main` (SSH remote).

---

## FINAL ACCEPTANCE (human review checklist — must all be true)
- [ ] All four Gate-A commands green on the whole package.
- [ ] `constants.ts` exists; **grep finds no inline magic strings** for couriers/statuses/endpoints/env/keys/events in src.
- [ ] dependency-cruiser: 0 violations (only `@medusa-ksa/core` intra-repo; `@medusajs/*` peer).
- [ ] No `any`/ts-ignore in non-test src; no `fetch(`/`process.env` in non-loader src; no secret-leaking log/error (test proves).
- [ ] Provider appears in admin Settings → Shipping; per-courier options selectable; **no custom UI**.
- [ ] `createFulfillment`/`cancelFulfillment`/`createReturnFulfillment` integrate with the Medusa **order** flow (tracking/label on the order; returns via RMA).
- [ ] `calculatePrice` returns **unavailable, never a guess** on missing weight / unserviceable city (tests).
- [ ] Free shipping is a seeded **Promotion**; provider returns the true rate (ADR-0009).
- [ ] README + status honest; changeset present; commits clean (no AI attribution); no AI-tooling/secret committed.
- [ ] Sandbox e2e passed (rate, book, track, return-or-documented-deferral).
