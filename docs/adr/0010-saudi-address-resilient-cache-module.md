# `saudi-address` is a custom module with a resilient cache-first store + bundled geography (the SPL API is unreliable)

`medusa-plugin-saudi-address` validates and resolves Saudi **National Addresses** against the Saudi Post (SPL) API — but the SPL API is **down most of the time**, so the package is **not** a stateless proxy. It is a **custom module** with a persistent `national_address_cache` table that behaves **cache-first with stale-fallback**:

1. Check the DB cache → hit → return immediately (no API call).
2. Miss → call SPL via core `HttpClient` → persist → return.
3. SPL down / timeout / error → **serve the cached value even if stale** (flagged stale). Only a cache miss *during* an outage surfaces the failure.

Caching is **lazy/on-demand**, keyed by the normalized query: **resolve-short-address + validate cached effectively permanently** (a short code maps to a fixed physical address), **free-text search short-TTL** (results evolve), **districts lazy-cached**. The stable **regions + cities** are **bundled as a bilingual (ar/en) seed** loaded at migration so listing endpoints work **100% of the time regardless of SPL**, refreshed opportunistically when SPL is up.

## Why

- An unreliable upstream that gates checkout would be catastrophic; a persistent cache turns "SPL is down" into "serve last-known-good." Once a short code/address is cached it is never re-fetched.
- Bundling the small, slow-changing geography (13 regions + cities) guarantees checkout dropdowns never depend on a live call; districts are too many/volatile to bundle, so they ride the same cache-first path.

## Consequences

- v1 capabilities: **resolve-short-address + validate + free-text search** (+ bundled regions/cities, lazy districts). Geocoding and full reference trees are deferred.
- It owns a schema (model + migrations via `db-generate`/`db-migrate`) — unlike the schema-less payment/fulfillment providers — but stays backend-only with no custom UI.
- All SPL I/O via core `HttpClient`; the API key is env-first via `createLoader`. Listing endpoints serve **Riyadh-first then locale-aware alphabetical**; every response carries **ar + en** per Medusa i18n.
- Independent of every other package (ADR-0003) — it improves the address *data* Torod/couriers ship to, but nothing imports it.
