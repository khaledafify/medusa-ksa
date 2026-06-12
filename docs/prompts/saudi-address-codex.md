# Codex Execution Plan — `medusa-plugin-saudi-address`

> For a low-trust executor (Codex). Maximally explicit. **No design decisions, no invention, no faking.** Every task has an automated gate, a self-audit, and a second read. A human reviews everything. Build **after** Torod; this package is **independent** of it (ADR-0003).

---

## GOAL (paste into Codex's goal/objective)

> Implement `medusa-plugin-saudi-address`, a Medusa v2 **custom module** for Saudi **National Address** validation, in the medusa-ksa monorepo at `/Users/khaledafify/RiderProjects/Medusa`, exactly as specified in `docs/prds/saudi-address.md` and `docs/prompts/saudi-address-codex.md`. It resolves short addresses → full National Addresses, validates addresses, free-text searches, and serves bundled bilingual (ar/en) regions/cities — all **cache-first against a persistent DB cache that survives SPL outages** (the SPL API is down most of the time): cache-hit → no call; miss → call + persist; **SPL down → serve last-known-good stale; cold miss → never fabricate**. A cart-completion hook writes `order.metadata.saudi_address_status` (`valid|unvalidated|unchecked`); it **defaults to warn/flag, `strict` is opt-in, and an outage NEVER blocks an order**. Regions/cities are a bilingual seed served **Riyadh-first then locale-aware alphabetical**. Reuse `@medusa-ksa/core` for all HTTP/config/errors/money; never reimplement. Follow `packages/payments/moyasar` as the quality bar. Produce clean, fully-typed code with **zero magic strings** AND comprehensive tests targeting ~100% coverage (every method, branch, and error path, incl. cache-hit/stale/outage/strict). Verify exact SPL endpoints/version against api.address.gov.sa first. Work one task at a time; pass two gates + a second read each; commit clean (no AI attribution); STOP and report rather than guess/stub/fake/deviate. A human reviews every slice.

---

## OPERATING RULES
1. **Executor, not designer.** All decisions are in the PRD + ADRs (0001,0002,0003,0010,0011). Do not choose alternatives or "improve."
2. **Verify SPL against api.address.gov.sa before coding any call.** Never invent an endpoint, field, version, or auth scheme.
3. **Verify Medusa types** (custom module, models, workflow hook, `/store` routes) via the `building-with-medusa` skill / MedusaDocs MCP and installed `@medusajs/*`.
4. **STOP and report** if: the API key is missing, docs contradict the PRD, a gate stays red after 2 attempts, or a task needs a decision.
5. **No fabrication** — no fake addresses/fields/tests/status, no stubbed shipped paths.
6. Commits clean, imperative, **no `Co-Authored-By`, no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret.

## READ FIRST
- `docs/prds/saudi-address.md` · `docs/adr/0001,0002,0003,0010,0011`
- `packages/core/CONTRACT.md` + `packages/core/src/*.ts`
- `CLAUDE.md` (§3 scope, §6 UI, §7 DX, §10 conventions, Git & commits) · `CONTEXT.md` (Addresses glossary)
- `packages/payments/moyasar/**` (quality bar) · `packages/zatca/**` (reference for a custom module with models/migrations)

## PREREQUISITE (confirm before S2; if missing → STOP)
`NATIONAL_ADDRESS_API_KEY` in `apps/demo-store/.env` (git-ignored) + access to api.address.gov.sa.

## NO MAGIC STRINGS — constants contract (`src/modules/saudi-address/constants.ts`)
Every literal a named export; a grep gate enforces it: `MODULE_NAME`/prefix; `ENV` (`NATIONAL_ADDRESS_API_KEY`, `NATIONAL_ADDRESS_BASE_URL`, `SAUDI_ADDRESS_STRICT`); `SPL_ENDPOINTS` (token/auth, freetextsearch, validate, resolve-short, regions, cities, districts — from `SPL-API-NOTES.md`); `QUERY_TYPE` (`resolve|validate|search|district`); `TTL` (resolve=permanent, search=short, district); `ADDRESS_STATUS` (`valid|unvalidated|unchecked`) + `ORDER_METADATA_KEY` (`saudi_address_status`); `RIYADH_REGION_CODE`/`RIYADH_CITY_CODE` (for Riyadh-first ordering); `LOCALE` (`ar|en`). Error codes reuse core `KsaErrorCodes`.

## STANDARD PER-TASK PROCEDURE (every task)
**GATE A — Automated (all exit 0):**
```
pnpm --filter medusa-plugin-saudi-address build
pnpm --filter medusa-plugin-saudi-address test
pnpm --filter medusa-plugin-saudi-address typecheck
pnpm lint
```
**GATE B — Self-audit (YES to every line or STOP):** no magic strings (grep the diff); no `any`/ts-ignore in non-test; all HTTP via core `HttpClient`; no `process.env` outside the loader; **no secret in logs/errors** (test); correct Medusa module/route/hook shapes (name the type); clean code + JSDoc; tests cover success + failure + the named corner case (cache-hit/stale/outage/strict); only `@medusa-ksa/core` intra-repo import (dependency-cruiser passed).
**GATE C — Second read:** re-read the diff as a reviewer; confirm the task's Accept literally holds; re-run Gate A; then commit. Commit only when A+B+C are green.

---

# TASKS (in order; each = Procedure A+B+C)

### S0 — Ground the API ✋ do first
- [ ] Read api.address.gov.sa; write `packages/address-saudi/SPL-API-NOTES.md` — real auth, the **API version** (v3.1/v4), and the freetextsearch/validate/resolve-short/regions/cities/districts endpoints + request/response fields (incl. **ar+en** name fields, short-address format) + rate limits. If docs contradict the PRD → **STOP and report.**

### S1 — Module skeleton + client
- [ ] **T1.1** Scaffold `packages/address-saudi` (package.json `medusa-plugin-saudi-address`, dual tsconfig, vitest, `.env.example`). *Accept:* install resolves core; typecheck; syncpack consistent.
- [ ] **T1.2** `constants.ts` (full contract above). *Accept:* every file imports from it; no target literals inline.
- [ ] **T1.3** Models: `national_address_cache` + bilingual `region`/`city` reference; module wiring + service. *Accept:* `plugin:build` compiles; `db:generate`/`db:migrate` apply; tables exist.
- [ ] **T1.4** `createLoader` (`NATIONAL_ADDRESS_API_KEY` required, fail-fast) + `SplClient` over core `HttpClient`. *Accept:* boot throws `KsaError` naming the var on missing key; client mocked-fetch tests — auth header, errors→`KsaError`, no key leak.

### S2 — Cache-first service
- [ ] **T2.1** `resolve` / `validate` / `search` — **cache-first → SPL on miss → persist → stale-serve on outage**; TTLs per `TTL` constants. *Accept (tests):* **cache hit issues zero SPL calls**; **SPL down + cache ⇒ stale returned**; **SPL down + cold miss ⇒ clear unavailable result, never a fabricated address**; resolve cached permanently, search short-TTL.

### S3 — Bundled geography
- [ ] **T3.1** Seed bilingual **regions + cities** at migration; lazy `districts`. *Accept:* regions/cities present **with no SPL call**; districts lazy-cache + stale-serve.
- [ ] **T3.2** Listing serves **Riyadh-first then locale-aware alphabetical** (Riyadh via `RIYADH_*` constant; Arabic collation for `ar`, Latin for `en`); ar+en on every row. *Accept (tests):* Riyadh first, rest alphabetical per locale; both names present.

### S4 — `/store` endpoints
- [ ] **T4.1** `/store/saudi-address/{resolve,validate,search,regions,cities,districts}` (publishable-key authed) backed by S2/S3; Zod-validated input via Medusa middleware. *Accept:* each returns cached/seeded bilingual data; **no secret in any response**.

### S5 — Checkout hook
- [ ] **T5.1** Cart-completion **workflow hook** → validate the shipping address → write `order.metadata.saudi_address_status`. *Accept (tests):* **warn (default) flags `unvalidated` and ALLOWS**; **`strict` blocks an invalid address only when SPL is up**; **outage (down + no cache) flags-and-allows in BOTH modes — never blocks**.

### S6 — Docs + verify + ship
- [ ] **T6.1** `packages/address-saudi/README.md` (moyasar template): config, resilience + strictness model, deferred items (geocoding, full reference). Update root README matrix. *Accept:* README honest.
- [ ] **T6.2** Verify a live SPL call against sandbox/live (or prove cache-fallback when down); `pnpm changeset` (minor); status `🚧 Beta` until verified. Push to `main` (SSH). *Accept:* live call works or documented-down-with-cache-proven; changeset present.

---

## FINAL ACCEPTANCE (human review — all true)
- [ ] All four Gate-A commands green; `constants.ts` exists; grep finds no inline magic strings; dependency-cruiser 0 violations.
- [ ] Cache-hit ⇒ zero SPL calls; SPL down + cache ⇒ stale; SPL down + cold miss ⇒ no fabricated address (tests).
- [ ] Checkout hook: warn flags+allows; strict blocks (SPL up); **outage never blocks** (tests).
- [ ] Regions/cities seeded (no SPL call), **Riyadh-first then alphabetical**, **ar+en** (tests).
- [ ] Custom **module** with migrations; all SPL I/O via core `HttpClient`; key never logged/returned (test); no storefront code, no custom UI.
- [ ] README + status honest; changeset present; commits clean (no AI attribution); no AI-tooling/secret committed.
