<div align="center">

# medusa-plugin-saudi-address

**Saudi National Address geography and validation for Medusa v2.**

[![Medusa v2](https://img.shields.io/badge/Medusa-v2-purple.svg?style=flat-square)](https://medusajs.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](../../../LICENSE)

</div>

---

## Status

🚧 Beta. The offline dataset module is under active implementation; the optional SPL adapter remains opt-in.

## Data model

The plugin is dataset-first. It seeds Saudi regions, cities, and districts into a Medusa custom module, then serves geography and structural validation without any network dependency or API key.

## GPL data dependency

The geography data is consumed as a separate dependency:

- Source: [`homaily/Saudi-Arabia-Regions-Cities-and-Districts`](https://github.com/homaily/Saudi-Arabia-Regions-Cities-and-Districts)
- License: GPL-2.0
- Attribution: raw Saudi regions, cities, and districts data collected from Saudi National Address map data and maintained by the upstream project.

The data is not copied into this MIT package's `src/` tree. It is loaded from the separate dependency during migration and seeded into the module database.

## Configuration

No key is required for offline geography, search, or structural validation.

```dotenv
NATIONAL_ADDRESS_API_KEY=          # optional, enables SPL adapter
NATIONAL_ADDRESS_BASE_URL=https://api.address.gov.sa
SAUDI_ADDRESS_STRICT=false
```

## License

Plugin code is [MIT](../../../LICENSE). The geography data dependency remains GPL-2.0 under its upstream license.
