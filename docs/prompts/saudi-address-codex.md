# Codex Execution Plan — `medusa-plugin-saudi-address` (dataset-first)

> For a low-trust executor (Codex). Maximally explicit. **No design decisions, no invention, no faking.** Three gates per task; a human reviews each slice. Build **after** Torod; independent of it (ADR-0003).

---

## GOAL (paste into Codex's goal/objective)

> Implement `medusa-plugin-saudi-address`, a Medusa v2 **custom module** for Saudi addresses, in the medusa-ksa monorepo at `/Users/khaledafify/RiderProjects/Medusa`, exactly as specified in `docs/prds/saudi-address.md` and `docs/prompts/saudi-address-codex.md`. It is **dataset-first**: it seeds a **bundled offline regions/cities/districts dataset (bilingual ar/en)** into its DB at migration and serves listing, free-text search, and **structural validation** (city/district exist & consistent) **with zero network and no API key**. Regions/cities/districts list **Riyadh-first then locale-aware alphabetical**, ar+en on every response. A cart-completion hook writes `order.metadata.saudi_address_status` (`valid|unvalidated|unchecked`): **default warn/flag, `strict` opt-in, never blocks on an SPL outage**. An **optional** SPL adapter (behind `NATIONAL_ADDRESS_API_KEY`) adds short-address resolve + official verify, cache-first; **off by default**. The geography data is **GPL-2.0** → consume it as a **separate, arms-length dependency** (its license + attribution preserved); **never copy GPL data into the MIT `src/`** — the plugin stays MIT (ADR-0012). Reuse `@medusa-ksa/core`; never reimplement. Follow `packages/payments/moyasar` as the quality bar. Produce clean, fully-typed, quality code with **zero magic strings** AND comprehensive tests targeting ~100% coverage. Work one task at a time in an autonomous loop; pass two gates + a second read on each; commit clean (no AI attribution); STOP and report only on a real blocker. A human reviews every slice.

---

## OPERATING RULES
1. **Executor, not designer.** Decisions are in the PRD + ADRs (0001,0002,0003,0010,0011,0012,0013). Do not choose alternatives or "improve."
2. **Verify Medusa types** (custom module, models/migrations, workflow hook, `/store` routes) via `building-with-medusa` / MedusaDocs MCP + installed `@medusajs/*`. The **dataset path needs no external API verification** (it ships the data). Only the **optional SPL adapter (S6)** verifies against api.address.gov.sa.
3. **STOP and report** if: a gate stays red after 2 attempts, the GPL dependency can't be added cleanly, the SPL docs (S6) contradict the PRD, or a task needs a decision.
4. **No fabrication** — no fake dataset rows / SPL fields / tests / status; no stubbed shipped paths.
5. **License (ADR-0012):** the GPL-2.0 geography data is a **separate dependency**; **NEVER** copy GPL data files into the plugin's MIT `src/`. Preserve attribution; document it in the README.
5b. **Drop-in (ADR-0013):** everything lives **inside the plugin** — models, migrations, **data seeding**, routes, the hook. The host app's only footprint is the npm dep + one `plugins:[]` block + env. The plugin **self-seeds via its own migration/loader** on `db:migrate`/startup — **NEVER** add a seed/setup script to `apps/demo-store` or the consumer's app, and never edit the app's source beyond its one config block.
6. Commits clean, imperative, **no `Co-Authored-By`, no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret.

## READ FIRST
- `docs/prds/saudi-address.md` · `docs/adr/0001,0002,0003,0010,0011,0012,0013`
- `packages/core/CONTRACT.md` + `packages/core/src/*.ts`
- `CLAUDE.md` · `CONTEXT.md` (Addresses glossary)
- `packages/payments/moyasar/**` (quality bar) · `packages/zatca/**` (module-with-migrations reference)

## PREREQUISITE
None for the core (dataset-only builds + tests with no key). The optional SPL adapter (S6) needs `NATIONAL_ADDRESS_API_KEY` in `apps/demo-store/.env`; if absent, implement the adapter behind the flag (off) and skip its live verification.

## NO MAGIC STRINGS — constants contract (`src/modules/saudi-address/constants.ts`)
Every literal a named export (grep gate enforces): `MODULE_NAME`/prefix; `ENV` (`NATIONAL_ADDRESS_API_KEY?`, `NATIONAL_ADDRESS_BASE_URL?`, `SAUDI_ADDRESS_STRICT?`); `ENTITY` (`region|city|district`); `ADDRESS_STATUS` (`valid|unvalidated|unchecked`) + `ORDER_METADATA_KEY` (`saudi_address_status`); `RIYADH_REGION_CODE`/`RIYADH_CITY_CODE`; `LOCALE` (`ar|en`); (SPL adapter only) `SPL_ENDPOINTS` + `QUERY_TYPE` + `TTL`. Errors reuse core `KsaErrorCodes`.

## EXECUTION LOOP (run until finish — do not wait for human input between tasks)
Repeat for every task S1 → S7 in order (S6 = optional adapter):
1. Implement (tests first) to the Clean-code bar.
2. Run **Gate A + Gate B + Gate C**.
3. All green → commit clean → **immediately start the next task**. Red → fix; after 2 failed attempts → **STOP and report**.
4. After each slice, post a one-line status (what, gate results, coverage %) **and keep going**; push to `main` (SSH) when a slice completes.
Exit only when FINAL ACCEPTANCE is all true, or a hard STOP fires. Never fake a pass to keep the loop moving.

## STANDARD PER-TASK PROCEDURE
**GATE A (all exit 0):** `pnpm --filter medusa-plugin-saudi-address build && test && typecheck` + `pnpm lint`.
**GATE B (self-audit, YES to all or STOP):** no magic strings; no `any`/ts-ignore in non-test; **no GPL data copied into `src/`** (ADR-0012); all SPL I/O (adapter) via core `HttpClient`; no `process.env` outside the loader; no secret in logs/errors (test); correct Medusa module/route/hook types; clean code + JSDoc; tests cover success + failure + the named corner case; dependency-cruiser 0 violations.
**GATE C (second read):** re-read the diff as a reviewer; confirm the task's Accept literally holds; re-run Gate A; commit only when A+B+C green.

## CLEAN-CODE BAR
- Small, single-responsibility functions; thin service methods; pure, **injectable** I/O (inject a clock + the SPL fetch so TTL/stale/outage are deterministically testable); no hidden global state.
- Fully typed (no `any`/ts-ignore in non-test), JSDoc on exported methods, names from `CONTEXT.md`, zero magic strings, errors via `KsaError`/`toMedusaError`, no secret leaks, no dead/commented code, no TODO in shipped paths. Match moyasar's style.

---

# TASKS (in order; each = Procedure A+B+C)

- [ ] **S1 — Module + GPL data dependency + seed.** Scaffold `packages/address-saudi` (package.json `medusa-plugin-saudi-address`, dual tsconfig, vitest, `.env.example`); add the **GPL-2.0 geography data as a separate dependency** (do NOT vendor into `src/`); `region`/`city`/`district` models; a **migration/loader inside the plugin that self-seeds** the dataset on `db:migrate`/startup (NO app-level seed script — ADR-0013); module wiring; `createLoader` (API key **optional**). *Accept:* boots with **no key**; `db:migrate` **auto-seeds** ≈ 13/4,580/3,730 with the demo-store footprint being one config block + env only; README records the GPL license + attribution; constants.ts exists.
- [ ] **S2 — Geography listing.** `regions` / `cities(byRegion)` / `districts(byCity)` from the DB, **Riyadh-first then locale-aware alphabetical**, ar+en. *Accept (tests):* zero network; Riyadh first then alphabetical per locale; both names present.
- [ ] **S3 — Search + structural validation.** `search` (free-text over the dataset) + `validate` (city/district exist & consistent). *Accept (tests):* offline matches; `valid` for a real consistent pair, `unvalidated` for a bad/mismatched one.
- [ ] **S4 — `/store` endpoints.** `regions`, `cities`, `districts`, `search`, `validate` (publishable-key authed, Zod-validated); `resolve` registered but returns "enable SPL adapter" until S6. *Accept:* bilingual dataset data; no secret in responses.
- [ ] **S5 — Checkout hook.** Cart-completion workflow hook → structural-validate → write `order.metadata.saudi_address_status`. *Accept (tests):* warn flags `unvalidated` + ALLOWS; `strict` blocks a genuinely invalid city/district; an enabled-SPL outage falls open to structural-only and **never blocks**.
- [ ] **S6 — Optional SPL adapter (opt-in).** Behind `NATIONAL_ADDRESS_API_KEY`: write `packages/address-saudi/SPL-API-NOTES.md` (verify endpoints/version against api.address.gov.sa; STOP if it contradicts the PRD), then `SplClient` over core `HttpClient` + `resolve` (short address) + official `verify`, **cache-first + stale-serve**. *Accept (tests, mocked):* with a key resolve/verify work cache-first (hit ⇒ no call; down + cache ⇒ stale); **without a key the adapter is cleanly off and the package still works**.
- [ ] **S7 — Docs + ship.** `packages/address-saudi/README.md` (moyasar template): dataset-first model, **GPL data dependency + attribution**, optional SPL adapter, deferred items; update root README matrix; `pnpm changeset`. *Accept:* README honest + GPL attribution; status honest.

---

## FINAL ACCEPTANCE (human review — all true)
- [ ] All four Gate-A commands green; constants.ts exists; grep finds no inline magic strings; dependency-cruiser 0 violations.
- [ ] **Offline-first**: regions/cities/districts/search/validate work with zero network; package boots with **no API key** (tests).
- [ ] **License (ADR-0012)**: GPL data is a separate dependency, **not** in MIT `src/`; README carries GPL-2.0 attribution.
- [ ] Geography: Riyadh-first then alphabetical; ar+en; sane seed counts (tests).
- [ ] Hook: warn flags+allows; strict blocks invalid; **never blocks on SPL outage** (tests).
- [ ] Optional SPL adapter: off without a key (package still works); cache-first + stale-serve when on (tests).
- [ ] Custom module + migrations; SPL I/O via core `HttpClient`; key never logged/returned; no storefront code, no custom UI.
- [ ] README + status honest; changeset present; commits clean (no AI attribution); no AI-tooling/secret committed.
