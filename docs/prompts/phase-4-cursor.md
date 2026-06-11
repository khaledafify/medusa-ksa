# Phase 4 Execution Runner — `medusa-fulfillment-torod` — for Cursor

> Paste everything below the line into Cursor. It is a **prescriptive task runner**. Every design decision is made. **Execute, verify, commit — one task at a time.** Do not think, redesign, or improvise.

---

You are implementing Phase 4 of the **medusa-ksa** monorepo: `medusa-fulfillment-torod`, a **Fulfillment provider** for the Torod courier aggregator (Medusa v2). Working dir: `/Users/khaledafify/RiderProjects/Medusa`.

## ROLE — obey exactly
- You are an **executor, not a designer.** All architecture is decided in the PRD + ADRs. Do **not** redesign, choose alternatives, "improve," or deviate.
- **Ambiguous or needs a decision? STOP and ask.** Do not guess, stub, or fake.
- Work tasks **in order, one at a time.** After each: run its **Verification Gate** + the **Global Gate**. Green → commit clean → next. Red → fix; after **2 failed attempts**, **STOP and report** the exact error. Never advance on a red gate; never weaken/delete a test to pass.
- **Never trust memory for Torod's API.** Verify every endpoint/field against **docs.torod.co** before coding the call.

## READ BEFORE STARTING
1. `docs/prds/phase-4-torod.md` — THE spec (decisions, slices, gates, DoD).
2. `docs/adr/0001` (provider/module isolation), `0002` (core safety surface), `0003` (peer deps/boundaries), `0008` (Torod provider model), `0009` (discounts are native, not connector).
3. `packages/core/CONTRACT.md` + `packages/core/src/*.ts` — the primitives to reuse.
4. `CLAUDE.md` (§3 scope, §6 UI, §7 DX, §10 conventions, "Git & commits"), `CONTEXT.md` (Fulfillment glossary).
5. `packages/payments/moyasar/**` — your template for package structure, dual tsconfig, vitest, core usage, test rigor.
6. Medusa v2 `AbstractFulfillmentProviderService` — confirm the exact method set/signatures via the `building-with-medusa` skill / MedusaDocs MCP.

## ABSOLUTE RULES (breaking one = gate failure)
- It's a **Fulfillment provider** (ADR-0001): no schema/models, no custom module. Registers in the Fulfillment module's `providers` array; surfaces in Settings → Shipping with **no custom UI**.
- **Core for everything** (ADR-0002): all HTTP via core `HttpClient`; options via `createLoader` (env-first, fail-fast); errors `KsaError`/`toMedusaError`; webhooks via core `verifyWebhook`/`verifySecretToken`; money as `SarAmount`. No raw `fetch`/axios, no `process.env` in logic, no hand-rolled HMAC, no float money.
- **Boundaries** (ADR-0003): `@medusajs/*` are `peerDependencies` (+dev); only intra-repo import is `@medusa-ksa/core`.
- **Provider quotes truth** (ADR-0009): **no hard-coded free-shipping / discount threshold in the provider.** Free shipping is a native Promotion only.
- **`calculatePrice` never guesses**: missing weight / unserviceable city ⇒ **unavailable**, never a fabricated price (optional `TOROD_DEFAULT_WEIGHT_KG` escape hatch).
- **Book at fulfillment, label on demand**: `calculatePrice` only quotes; `createFulfillment` books; label via the document method.
- **Hygiene:** commits clean + imperative, **no `Co-Authored-By`, no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret. Don't fake capability/status.

## PER-TASK LOOP
1. Write tests first from the acceptance criteria, then the code.
2. Run the task Verification Gate + Global Gate.
3. Green → `git add` task files (+ one `pnpm changeset` at the first publishable change) → commit clean → next.
4. Red → fix; after 2 attempts STOP and report.

## GLOBAL GATE (after every task)
```
pnpm --filter medusa-fulfillment-torod build
pnpm --filter medusa-fulfillment-torod test
pnpm --filter medusa-fulfillment-torod typecheck
pnpm lint
```

## PREREQUISITE (confirm before S2 — if missing, STOP and report)
A **Torod API account + sandbox key** (`TOROD_CLIENT_ID + TOROD_CLIENT_SECRET`) in `apps/demo-store/.env` (git-ignored), and access to docs.torod.co to verify endpoints. **S0:** before S2, read docs.torod.co and write a short `packages/fulfillment/torod/TOROD-API-NOTES.md` capturing the real auth scheme, rate/booking/label/tracking/cancel/returns/cities endpoints + the webhook-vs-polling answer. All later tasks cite it. If the docs contradict the PRD's assumptions, STOP and report before coding.

---

# TASKS (in order)

## S1 — Scaffold + client
- **T1.1 Scaffold** `packages/fulfillment/torod`: package.json (`medusa-fulfillment-torod`, `build: medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`), `tsconfig.json`+`tsconfig.build.json` (mirror moyasar), `vitest.config.ts`, `.env.example` (`TOROD_CLIENT_ID + TOROD_CLIENT_SECRET`, `TOROD_BASE_URL?`, `TOROD_DEFAULT_WEIGHT_KG?`, `TOROD_DEFAULT_PACKAGE_CM?`, `TOROD_WEBHOOK_SECRET?`). **Gate:** `pnpm install` resolves core; typecheck; syncpack consistent.
- **T1.2 Loader + options** (`createLoader`, `TOROD_CLIENT_ID + TOROD_CLIENT_SECRET` required, fail-fast). **Gate:** boot throws `KsaError` naming the var on missing key (test); boots with valid config.
- **T1.3 `TorodClient`** over core `HttpClient` (base URL, auth per TOROD-API-NOTES). **Gate:** mocked-fetch tests — auth header correct, non-2xx → `KsaError`, no key in error messages.

## S2 — Options + rates
- **T2.1 `getFulfillmentOptions`** — one option per Torod courier (from the couriers endpoint or a documented static set per the notes). **Gate:** returns one option per courier with stable ids.
- **T2.2 `calculatePrice`** — live rate-shop: weight from cart items, **package dims from `TOROD_DEFAULT_PACKAGE_CM`**, origin from stock location, destination from cart address → return the option's courier rate. **Gate:** returns the right courier's rate using the default package (mocked Torod); **missing weight ⇒ unavailable; no package ⇒ unavailable; unserviceable city ⇒ unavailable** (tests) — never a guessed price; `TOROD_DEFAULT_WEIGHT_KG` / `TOROD_DEFAULT_PACKAGE_CM` apply only when set.
- **T2.3 `validateFulfillmentData`** — serviceability + city-code mapping (if Torod requires a city code, not free text). **Gate:** valid data passes; unserviceable/unknown city rejected with a clear `KsaError`.

## S3 — Book + label + cancel
- **T3.1 `createFulfillment`** — book the shipment at fulfillment; **package from fulfillment-data override (explicit dims or `torodPackageTemplateId`) else `TOROD_DEFAULT_PACKAGE_CM`** → store tracking number + Torod shipment ref in fulfillment data; cache the label if Torod returns it synchronously. **Gate:** sandbox booking returns a tracking number + shipment ref; the package override is honored.
- **T3.2 `getFulfillmentDocuments`** (and return/shipment document methods as Medusa requires) — fetch the **label on demand** from Torod. **Gate:** label retrievable on demand whether Torod returns it sync or async.
- **T3.3 `cancelFulfillment`** — cancel a booked shipment if cancellable; terminal states are an idempotent no-op. **Gate:** cancel works; double-cancel / already-delivered is a no-op (test).

## S4 — Tracking webhook (or polling fallback)
- **T4.1** Auto-wired webhook route (`src/api/...`) verified via core `verifyWebhook`/`verifySecretToken`; map Torod status → Medusa `shipped`/`delivered`; idempotent under redelivery. **If TOROD-API-NOTES shows no webhooks**, implement a scheduled polling job for active shipments instead (and note it). **Gate:** a tracking event flips fulfillment status; tampered/replayed rejected; redelivery is a no-op.

## S5 — Returns
- **T5.1 `createReturnFulfillment`** — book a reverse Torod shipment + on-demand return label, mirroring outbound. **If** the return API is genuinely separate/complex per the notes → **STOP, defer, and add a README future-work note** instead. **Gate:** sandbox return booking returns reverse tracking/label, OR a documented deferral.

## S6 — Free-shipping default + docs
- **T6.1 Seed promotion** — add a configurable **250 SAR free-shipping Promotion** to `apps/demo-store` setup (and note it for `create-medusa-ksa-app`). The provider is unchanged (ADR-0009). **Gate:** demo-store has the seeded promotion; **a test/grep asserts the provider source contains no hard-coded free-shipping threshold.**
- **T6.2 Docs** — `packages/fulfillment/torod/README.md` (moyasar template): supported couriers, config, **"provider quotes truth; free shipping is a Promotion"**, returns status, individual-courier-packages = future work. Update root README matrix. **Gate:** README honest (no faked couriers/scope/status).

## S7 — Sandbox e2e + status
- **T7.1** Rate → book → track → (return) end-to-end against Torod **sandbox** in `apps/demo-store`; `pnpm changeset`. **Gate:** e2e passes; status `🚧 Beta` (sandbox) → `✅ Stable` only if the full e2e is green; changeset present.

## DELIVER / STOP CONDITIONS
- Commit after every green task (clean, no AI attribution). Push to `main` when a slice completes (`git push origin main`; remote is SSH).
- **STOP and report** if: the Torod sandbox key is missing, docs.torod.co contradicts the PRD, the return API is genuinely separate (defer), Torod has no webhooks (switch to polling per S4), or any gate stays red after 2 attempts. Do not invent a workaround.
- **DONE** = per-courier shipping options with live rates; book-at-fulfillment with real tracking + on-demand label; webhook status sync; returns (or documented deferral); free shipping as a seeded Promotion with the provider quoting truth; all four gate commands green; sandbox e2e passing; README honest.
