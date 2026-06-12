<div align="center">

# medusa-plugin-saudi-address

**Saudi National Address geography and validation for Medusa v2.**

Serve Saudi regions, cities, districts, search, and structural validation entirely offline, with an optional SPL National Address adapter for short-address resolve and official verification.

[![Medusa v2](https://img.shields.io/badge/Medusa-v2-purple.svg?style=flat-square)](https://medusajs.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](../../../LICENSE)

</div>

---

## Status

🚧 Beta. The dataset-first module, Store API routes, checkout hook, and mocked SPL adapter tests are implemented. Live SPL success verification is still deferred until a National Address subscription key is available.

## Why this plugin

Saudi checkouts need accurate city/district data and a way to flag bad National Address entries, but checkout must not depend on SPL being online. This plugin keeps the default path local and reliable:

- **Offline first** — regions, cities, districts, search, and structural validation work with no network and no API key.
- **Bilingual responses** — geography responses carry Arabic and English names.
- **Riyadh-first ordering** — regions and Riyadh-region cities pin Riyadh first, then sort locale-aware.
- **Advisory checkout validation** — warn/flag by default; strict mode is opt-in.
- **SPL optional** — `NATIONAL_ADDRESS_API_KEY` enables short-address resolve and official verification, cache-first with stale-serve.
- **Backend only** — no storefront package, no custom admin UI.

## Requirements

- Medusa **v2.13** or newer
- Node.js **20+**
- PostgreSQL
- Optional: SPL National Address API subscription key

## Installation

```bash
npm install medusa-plugin-saudi-address
```

## Configuration

Register the plugin as a custom module in `medusa-config.ts`.

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  modules: [
    {
      resolve: "medusa-plugin-saudi-address/modules/saudi-address",
      options: {
        // Optional. Defaults to env vars, and boots without a key.
      },
    },
  ],
})
```

### Environment variables

No key is required for offline geography, search, or structural validation.

```dotenv
NATIONAL_ADDRESS_API_KEY=          # optional, enables SPL adapter
NATIONAL_ADDRESS_BASE_URL=https://apina.address.gov.sa/NationalAddress
SAUDI_ADDRESS_STRICT=false         # optional, default false
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `nationalAddressApiKey` | `string` | `env.NATIONAL_ADDRESS_API_KEY` | Optional. Enables SPL short-address resolve and official verify. |
| `baseUrl` | `string` | `env.NATIONAL_ADDRESS_BASE_URL` or SPL API host | Optional SPL API base URL override. Only used when the key is set. |
| `strict` | `boolean` | `env.SAUDI_ADDRESS_STRICT` or `false` | When `true`, structurally invalid addresses block checkout. SPL outages never block. |
| `timeoutMs` | `number` | `15000` | Optional SPL request timeout. |
| `retry` | `{ retries, baseDelayMs }` | `{ retries: 2, baseDelayMs: 250 }` | Retry policy for idempotent SPL reads. |

## Data model

The module owns four tables:

| Table | Purpose |
|---|---|
| `saudi_address_region` | Seeded Saudi regions from the offline dataset |
| `saudi_address_city` | Seeded Saudi cities with region links |
| `saudi_address_district` | Seeded Saudi districts with city and region links |
| `national_address_cache` | Optional SPL resolve/verify cache rows |

The offline dataset seeds at migration time and is enough for the default product surface.

## Store API

All routes are Store API routes and use Medusa's native publishable-key middleware behavior for `/store`.

| Route | Method | Requires SPL key | Description |
|---|---:|:---:|---|
| `/store/saudi-address/regions` | `GET` | No | List regions, Riyadh first, bilingual names |
| `/store/saudi-address/cities?region_code=RD` | `GET` | No | List cities in a region |
| `/store/saudi-address/districts?city_code=3` | `GET` | No | List districts in a city |
| `/store/saudi-address/search?q=riyadh` | `GET` | No | Search regions, cities, and districts |
| `/store/saudi-address/validate` | `POST` | No | Structural validation; adds official verify when SPL fields and key are present |
| `/store/saudi-address/resolve` | `POST` | Yes | Resolve short address such as `RRRD2929`; returns disabled response without a key |

### Validate body

```json
{
  "city_code": "3",
  "district_code": "10100003001",
  "building_number": "8228",
  "post_code": "12643",
  "additional_number": "2121"
}
```

`building_number`, `post_code`, and `additional_number` are optional. When all three are present and the SPL adapter is enabled, the module attempts official verification after structural validation. If SPL is down, validation falls back to the structural result.

### Resolve body

```json
{
  "short_address": "RRRD2929"
}
```

Without `NATIONAL_ADDRESS_API_KEY`, the route returns a disabled response and the rest of the package continues to work offline.

## Checkout hook

The module registers a complete-cart workflow hook. It reads the shipping address city/district fields and optional metadata codes, then writes:

```txt
order.metadata.saudi_address_status = "valid" | "unvalidated" | "unchecked"
```

Default behavior is warn/flag and allow checkout. Set `SAUDI_ADDRESS_STRICT=true` to block genuinely invalid structural results or fresh official SPL negative results. SPL outages and stale official cache results never block checkout.

Optional shipping-address metadata keys:

| Metadata key | Purpose |
|---|---|
| `saudi_city_code` | Dataset city code |
| `saudi_district_code` | Dataset district code |
| `saudi_building_number` | SPL official verify building number |
| `saudi_post_code` | SPL official verify post code |
| `saudi_additional_number` | SPL official verify additional number |

## Optional SPL adapter

When `NATIONAL_ADDRESS_API_KEY` is set, the module creates an SPL client over `@medusa-ksa/core` `HttpClient`.

- Short-address resolve uses a cache-first path and serves stale cache when SPL is unavailable.
- Official verify uses the documented `addressfound` result and the same cache-first/stale-serve behavior.
- Secrets are sent through the core HTTP boundary and are tested not to appear in errors or responses.
- Public endpoint verification notes live in [`SPL-API-NOTES.md`](./SPL-API-NOTES.md). The current implementation is tested with mocked SPL I/O; live-key verification is intentionally not claimed.

## GPL data dependency

The geography data is consumed as a separate dependency:

- Source: [`homaily/Saudi-Arabia-Regions-Cities-and-Districts`](https://github.com/homaily/Saudi-Arabia-Regions-Cities-and-Districts)
- License: GPL-2.0
- Attribution: raw Saudi regions, cities, and districts data collected from Saudi National Address map data and maintained by the upstream project.

The data is not copied into this MIT package's `src/` tree. It is loaded from the separate dependency during migration and seeded into the module database. This is the arms-length dependency approach from ADR-0012; verify the license interaction before publishing to your own registry.

## Testing

```bash
pnpm --filter medusa-plugin-saudi-address build
pnpm --filter medusa-plugin-saudi-address test
pnpm --filter medusa-plugin-saudi-address typecheck
pnpm lint
```

The package tests cover offline listing/search/validation, the checkout hook, Store API routes, SPL client request construction and redaction, and SPL cache hit/stale behavior with mocked network.

## Deferred items

- Live SPL verification with a real subscription key.
- Geocoding beyond fields SPL returns during short-address resolve.
- Boundary/GIS features.
- Bulk SPL sync.
- Storefront code and custom admin UI.

## License

Plugin code is [MIT](../../../LICENSE). The geography data dependency remains GPL-2.0 under its upstream license.

---

<div align="center">

Part of the **[Medusa KSA](https://github.com/khaledafify/medusa-ksa)** plugin suite.

</div>
