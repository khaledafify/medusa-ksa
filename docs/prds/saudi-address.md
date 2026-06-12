# PRD — `medusa-plugin-saudi-address` (Saudi National Address, dataset-first)

**Status:** ready for implementation · **Owner:** Codex/Cursor (implements) · **Design:** locked via grill-with-docs (Opus)
**Authority:** `CLAUDE.md` · `docs/adr/0001`,`0002`,`0003`,`0010`,`0011`,`0012` · `packages/core/CONTRACT.md` · `CONTEXT.md` (Addresses glossary) · `packages/payments/moyasar/**` (quality bar) · `packages/zatca/**` (module-with-migrations reference)
**Path:** `packages/address-saudi` → npm `medusa-plugin-saudi-address`. Built **after** Torod; **independent** of it (ADR-0003).

> A **custom module** that serves Saudi geography + address validation **from a bundled offline dataset** (default, no network) with an **optional SPL adapter** for short-address resolution + official verification. Backend-only, no custom UI.

---

## 1. Locked design decisions (do not re-litigate)

1. **Dataset-first (ADR-0010).** The default source is a **bundled offline dataset** of regions → cities → districts (bilingual ar/en, ~13 / ~4,580 / ~3,730), seeded into the DB at migration. **No required API, works 100% offline.**
2. **Optional SPL adapter (ADR-0010).** When `NATIONAL_ADDRESS_API_KEY` is set, an opt-in adapter adds **short-address (RRRD2929) resolve + official verify** via SPL, **cache-first with stale-serve** (SPL is unreliable). **Off by default**; the package fully functions without it.
3. **GPL data as a separate dependency (ADR-0012).** The dataset is GPL-2.0 → consumed as an **arms-length dependency** (own license + attribution), loaded at migration. The **plugin source stays MIT** — never vendor GPL into `src/`.
4. **Capabilities.** Default (offline): list **regions/cities/districts**, **free-text search**, **structural validation** (city/district exist & consistent). Optional (SPL on): **short-address resolve**, **official verify**.
5. **Ordering & i18n.** Listing endpoints return **Riyadh-first then locale-aware alphabetical** (Riyadh by a named id/code constant — no magic string; Arabic collation for `ar`, Latin for `en`). **ar + en on every response.**
6. **Validation is advisory (ADR-0011).** The cart-completion hook writes `order.metadata.saudi_address_status` (`valid|unvalidated|unchecked`); **default warn/flag, `strict` opt-in**, and it **never blocks on an SPL outage** (falls open to structural-only).
7. **Surface (backend-only).** `/store` endpoints: `regions`, `cities`, `districts`, `search`, `validate` (always); `resolve` (only when SPL adapter enabled). + the cart-completion hook. No module link, no storefront code, no custom UI.

## 2. Config

**No required key** — the dataset default needs none. Optional: `NATIONAL_ADDRESS_API_KEY` (enables the SPL adapter), `NATIONAL_ADDRESS_BASE_URL`/version, `SAUDI_ADDRESS_STRICT` (default `false`). Via core `createLoader` (the API key is optional; everything else boots without it). No SPL secret logged or returned.

## 3. Data (Codex picks exact schema)

- **Geography (seeded from the GPL dependency):** `region` / `city` / `district` tables — code/id, `name_en`, `name_ar`, parent link, `sort_weight` (Riyadh pinned), optional lat/lon. Loaded at migration from the GPL-2.0 data dependency (ADR-0012).
- **SPL cache (only for the optional adapter):** a `national_address_cache` table for short-address/verify responses (cache-first, stale-serve). Not used in dataset-only mode.
- The order-level flag lives in **order metadata** (no model).

## 4. The GPL data dependency (ADR-0012)

Use `homaily/Saudi-Arabia-Regions-Cities-and-Districts` (GPL-2.0) as a **separate dependency** — an existing npm package wrapping it, or a dedicated GPL-2.0 data artifact — **never copied into the MIT `src/`**. Preserve its license + attribution; document it in the README. Load the JSON into the geography tables at migration. (A permissive-licensed equivalent is the escape hatch if the GPL dep ever becomes a problem.)

## 5. Verify before coding the optional SPL adapter (only if/when implemented)

For the SPL adapter (S6): auth/version (v3.1/v4), the short-address-resolve + verify endpoints + fields, rate limits → against api.address.gov.sa. The **dataset path needs no external verification** — it ships the data.

## 6. Slices (each: test-first, small clean commits, gates green before advancing)

- **S1 — Module + data dependency + seed.** Package (`medusa-plugin-saudi-address`, `medusa plugin:build`, exports per §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*` + the GPL data dependency), dual tsconfig + vitest, `.env.example`. Geography models; migration that **seeds regions/cities/districts from the GPL dependency**; module wiring; `createLoader` (API key **optional**).
  *Accept:* boots **without any key**; migration seeds the dataset; counts ≈ 13 / 4,580 / 3,730; README records the GPL data license + attribution.
- **S2 — Geography service + listing.** `regions` / `cities(byRegion)` / `districts(byCity)` from the DB, **Riyadh-first then locale-aware alphabetical**, ar+en.
  *Accept (tests):* regions/cities/districts return **with zero network**; Riyadh first then alphabetical per locale; both names present.
- **S3 — Search + structural validation.** `search` (free-text over the dataset) + `validate` (city/district exist & mutually consistent).
  *Accept (tests):* search returns dataset matches; validate returns `valid` for a real consistent city/district and `unvalidated` for a bad/mismatched one — **all offline**.
- **S4 — `/store` endpoints.** `regions`, `cities`, `districts`, `search`, `validate` (publishable-key authed, Zod-validated). `resolve` registered but returns "enable SPL adapter" until S6.
  *Accept:* each returns bilingual dataset data; no secret in responses.
- **S5 — Checkout hook.** Cart-completion workflow hook → structural-validate the shipping address → write `order.metadata.saudi_address_status`. **warn (default) flags+allows; `strict` blocks a genuinely invalid address; never blocks on an SPL outage.**
  *Accept (tests):* warn flags `unvalidated` + allows; strict blocks an invalid city/district; an enabled-SPL outage falls open to structural-only and never blocks.
- **S6 — Optional SPL adapter (opt-in).** Behind `NATIONAL_ADDRESS_API_KEY`: `SplClient` over core `HttpClient`; `resolve` (short address) + official `verify`, **cache-first + stale-serve**. Verify endpoints against api.address.gov.sa first (write `SPL-API-NOTES.md`); STOP if docs contradict the PRD.
  *Accept (tests, mocked):* with a key, resolve/verify work cache-first; cache hit ⇒ no call; SPL down + cache ⇒ stale; **without a key the adapter is cleanly off** and the package still works.
- **S7 — Docs + ship.** `packages/address-saudi/README.md` (moyasar template): dataset-first model, the **GPL data dependency + attribution**, optional SPL adapter, deferred items. Update root README matrix; `pnpm changeset`.
  *Accept:* README honest + GPL attribution present; status `🚧 Beta` until the SPL adapter is verified live (or `✅ Stable` for the dataset-only core once tested).

## 7. Guard gates (every slice)

**Green commands (exit 0):**
```
pnpm --filter medusa-plugin-saudi-address build
pnpm --filter medusa-plugin-saudi-address test
pnpm --filter medusa-plugin-saudi-address typecheck
pnpm lint
```

**Address-specific guards:**
- **Offline-first proven** — regions/cities/districts/search/validate work with **zero network** (tests); the package **boots with no API key**.
- **License hygiene (ADR-0012)** — the GPL data is a **separate dependency**, NOT copied into MIT `src/`; README carries the GPL-2.0 attribution. (A grep/check: no GPL data files vendored under the plugin's `src/`.)
- **Geography correctness** — Riyadh-first then locale-aware alphabetical; ar+en present; seed counts sane (tests).
- **Optional adapter** — off without a key (package still works); when on, cache-first + stale-serve + **never blocks on outage** (tests).
- **Architecture** — custom **module** (ADR-0001) with migrations; SPL I/O (adapter only) via core `HttpClient`; key optional + never logged/returned; `@medusajs/*` peer-only; only `@medusa-ksa/core` intra-repo import (dependency-cruiser 0); **no storefront code, no custom UI**.
- **Honesty** — no faked dataset rows or SPL fields; status not faked; clean commits, no AI attribution, AI tooling git-ignored.

## 8. Definition of Done (v1)

A store can list bilingual regions/cities/districts (Riyadh-first), search, and structurally validate a shipping address **entirely offline** with no API key; the checkout hook flags (`warn`) or blocks (`strict`) and **never blocks on an SPL outage**; an **optional** SPL adapter adds short-address resolve + official verify when a key is provided. The GPL geography is an arms-length dependency; the plugin is MIT. All four gates green; README honest. Reuses `@medusa-ksa/core`; respects ADR-0001/0002/0003/0010/0011/0012. Independent of Torod.

## 9. Out of scope (v1)

Geocoding (lat-long ↔ address) beyond what the dataset carries · boundary/GIS features · bulk SPL sync · any storefront code · custom UI · cryptocurrency. Deferred items README'd as future work.
