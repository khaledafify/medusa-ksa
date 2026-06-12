# `saudi-address` is dataset-first (bundled offline geography); SPL is an optional opt-in adapter

`medusa-plugin-saudi-address` serves Saudi geography and address validation from a **bundled offline dataset** — regions → cities → districts, bilingual (ar/en), ~13 / ~4,580 / ~3,730 — loaded into the module's DB at migration. This is the **default, always-available** source: **no required API, no live dependency, works 100% offline.** The Saudi Post (SPL) National Address API is **optional**: when a merchant supplies an API key, an opt-in adapter adds the features only SPL can provide — **short-address (RRRD2929) resolution + official building-level verification** — cache-first (SPL is unreliable). v1's core needs no network at all.

## Why

- The SPL API is **down most of the time**. Gating checkout geography/validation on a flaky upstream would be catastrophic; a bundled dataset is reliable and instant.
- The dataset gives the regions/cities/districts hierarchy + structural validation; **short address and official per-building verification are SPL-only**, so SPL stays available — but as an *enhancement*, never a hard dependency.

## Consequences

- **Default capabilities (offline, no key):** list regions/cities/districts, free-text search, and **structural validation** (the city/district exist and are mutually consistent), all from the seeded dataset.
- **Optional SPL adapter (opt-in via `NATIONAL_ADDRESS_API_KEY`):** short-address resolve + official verify, **cache-first with stale-serve** (since SPL is unreliable), via core `HttpClient`. Off by default; the package boots and fully functions without it.
- The geography dataset is **GPL-2.0** → consumed as a **separate, arms-length dependency** (ADR-0012); the plugin source stays **MIT**.
- It's a **custom module** (owns models + migrations to hold the seeded geography); backend-only, no UI; listing is **Riyadh-first then locale-aware alphabetical**, **ar + en** on every response.
- Independent of every other package (ADR-0003).
