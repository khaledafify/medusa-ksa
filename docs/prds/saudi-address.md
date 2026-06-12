# PRD — `medusa-plugin-saudi-address` (Saudi National Address)

**Status:** ready for implementation · **Owner:** Codex/Cursor (implements) · **Design:** locked via grill-with-docs (Opus)
**Authority:** `CLAUDE.md` · `docs/adr/0001`,`0002`,`0003`,`0010`,`0011` · `packages/core/CONTRACT.md` · `CONTEXT.md` (Addresses glossary) · `packages/payments/moyasar/**` (quality bar)
**Path:** `packages/address-saudi` → npm `medusa-plugin-saudi-address`. Built **after** Torod; **independent** of it (ADR-0003).

> A **custom module** (it owns a cache table) that validates/resolves Saudi **National Addresses** against the Saudi Post (SPL) API — which is **down most of the time**, so resilience is the whole point. Backend-only, no custom UI. **Verify exact SPL endpoints/version (v3.1 vs v4) + auth against api.address.gov.sa — never assume.**

---

## 1. Locked design decisions (do not re-litigate)

1. **Capabilities (ADR-0010):** v1 = **resolve-short-address + validate + free-text search**, plus **bundled regions/cities** and **lazy districts**. Geocoding / full reference trees deferred.
2. **Resilient cache (ADR-0010):** custom module with a persistent cache; **cache-first → stale-serve on SPL outage → only a cold miss during an outage surfaces failure.** Lazy/on-demand. **Resolve+validate cached ~permanently; search short-TTL; districts lazy.**
3. **Bundled geography (ADR-0010):** **regions + cities shipped as a bilingual (ar/en) seed** loaded at migration so listing endpoints work 100% regardless of SPL; refreshed from SPL opportunistically when up.
4. **Ordering & i18n:** listing endpoints return **Riyadh-first, then locale-aware alphabetical** (Riyadh by a named id/code constant — no magic string; Arabic collation for `ar`, Latin for `en`). **ar + en on every response** per Medusa i18n.
5. **Validation is advisory (ADR-0011):** the checkout hook **defaults to warn/flag** (writes `order.metadata.saudi_address_status` = `valid|unvalidated|unchecked`), **`strict` opt-in**, and **an outage never blocks** an order.
6. **Surface (backend-only):** `/store` endpoints (`resolve`, `validate`, `search`, `regions`, `cities`, `districts`) + a **cart-completion workflow hook** writing the status flag. No module link, no storefront code, no custom UI.

## 2. Config

`NATIONAL_ADDRESS_API_KEY` (required, env-first via core `createLoader`). Optional: `NATIONAL_ADDRESS_BASE_URL`/version, `SAUDI_ADDRESS_STRICT` (default `false` = warn), TTL overrides. No SPL secret is logged or returned from a route.

## 3. Data (Codex picks exact schema)

- A **cache** table (opaque SPL responses for resolve/validate/search/districts): normalized `cache_key`, `query_type`, payload (json), `fetched_at`, stale marker, ttl by type.
- A **bilingual regions/cities reference** (seeded): code, `name_en`, `name_ar`, region link for cities, `sort_weight` (Riyadh pinned). Migrations via `db-generate`/`db-migrate`.
- The order-level flag lives in **order metadata** (no model needed for it).

## 4. Verify against api.address.gov.sa (never assume)

Auth (API key header/scheme); the **API version** to target (v3.1 vs v4); the **FreeTextSearch**, **verify/validate**, **short-address resolve**, **regions**, **cities**, **districts** endpoints + request/response field names (incl. the **ar + en** name fields and the short-address format); rate limits (drives TTLs).

## 5. Slices (each: test-first, small clean commits, gates green before advancing)

- **S1 — Module skeleton + client.** Package (`medusa-plugin-saudi-address`, `medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`), dual tsconfig + vitest (mirror moyasar), `.env.example`. Cache + reference models; module wiring; `createLoader` (`NATIONAL_ADDRESS_API_KEY`, fail-fast); `SplClient` over core `HttpClient`; migrations.
  *Accept:* boots fail-fast on missing key; migrations apply; client unit tests (mocked fetch) — auth header, errors→`KsaError`, no key leak.
- **S2 — Cache-first service.** `resolve` / `validate` / `search` with **cache-first → SPL on miss → persist → stale-serve on outage**.
  *Accept:* **cache hit makes no API call** (test); **SPL down + cache ⇒ returns stale** (test); **SPL down + cold miss ⇒ a clear "unavailable" result, never a fabricated address** (test); TTLs honored (resolve permanent, search short).
- **S3 — Bundled geography.** Seed bilingual **regions + cities** at migration; `regions`/`cities` served **Riyadh-first then locale-aware alphabetical**; `districts` lazy-cached.
  *Accept:* regions/cities return **with no SPL call** (seeded); **Riyadh first, rest alphabetical** per locale (test); ar+en present; districts lazy-cache + stale-serve.
- **S4 — `/store` endpoints.** `resolve`, `validate`, `search`, `regions`, `cities`, `districts` (publishable-key authed), backed by S2/S3.
  *Accept:* each endpoint returns the cached/seeded data; bilingual; no secret in responses.
- **S5 — Checkout hook.** Cart-completion workflow hook → validate the shipping address → write `order.metadata.saudi_address_status`. **`strict` throws only when SPL is reachable and returns invalid; warn flags; outage always flags-and-allows.**
  *Accept:* warn-mode flags `unvalidated` and **allows**; strict-mode **blocks** an invalid address (SPL up); **outage (down + no cache) flags-and-allows in both modes** (test) — never blocks.
- **S6 — Docs + verify + ship.** `packages/address-saudi/README.md` (moyasar template): config, the resilience/strictness model, deferred items (geocoding, full reference). Verify against the SPL **sandbox/live** API; `pnpm changeset`; status honest.
  *Accept:* README honest; a live SPL call works (or is documented as down with cache fallback proven); status `🚧 Beta` until verified, `✅ Stable` only after.

## 6. Guard gates (every slice)

**Green commands (exit 0):**
```
pnpm --filter medusa-plugin-saudi-address build      # medusa plugin:build
pnpm --filter medusa-plugin-saudi-address test
pnpm --filter medusa-plugin-saudi-address typecheck
pnpm lint                                             # eslint + dependency-cruiser (0 violations) + syncpack
```

**Address-specific guards:**
- **Cache-first proven** — a cache hit issues **zero** SPL calls (test).
- **Resilience proven** — SPL down + cache ⇒ **stale served**; SPL down + no cache ⇒ **never a fabricated address** and the checkout hook **never blocks** (tests).
- **Advisory default** — warn flags + allows; strict blocks only when SPL is up and says invalid (ADR-0011; tested).
- **Geography** — regions/cities serve **with no SPL call** (seeded), **Riyadh-first then alphabetical**, **ar + en** present (tests).
- **Architecture** — custom **module** (ADR-0001) with migrations; all SPL I/O via core `HttpClient`; API key env-first, never logged/returned; `@medusajs/*` peer-only; only `@medusa-ksa/core` intra-repo import (dependency-cruiser 0); **no storefront code, no custom UI**.
- **Honesty** — no faked SPL fields/endpoints (verify first); status not faked; clean commits, no AI attribution, AI tooling git-ignored.

## 7. Definition of Done (v1)

A store can resolve a short address → full National Address, validate an address, search, and list bilingual regions/cities — all **cache-first and surviving SPL outages**; the checkout hook flags (`warn` default) or blocks (`strict`) but **never blocks on an outage**; regions/cities are seeded + Riyadh-first; all four gate commands green; README honest. Reuses `@medusa-ksa/core`; respects ADR-0001/0002/0003/0010/0011. Independent of Torod.

## 8. Out of scope (v1)

Geocoding (lat-long ↔ address) · full district/region reference trees beyond what's fetched · bulk dataset import · any storefront code · custom UI · cryptocurrency. Deferred items README'd as future work.
