# The Saudi geography dataset (GPL-2.0) is a separate, arms-length dependency; the plugin stays MIT

The bundled regions/cities/districts data originates from a **GPL-2.0** community dataset (`homaily/Saudi-Arabia-Regions-Cities-and-Districts`). To keep `medusa-plugin-saudi-address` **MIT and adoption-friendly**, the data is consumed as a **separate, arms-length dependency** — kept in its own artifact with its **GPL-2.0 license and attribution preserved**, and **loaded into the plugin's DB at migration**. It is **never relicensed, copied into, or merged with the plugin's MIT source.** The plugin's README documents the GPL-2.0 data dependency and the consumer's obligation.

## Why

- GPL-2.0 is **copyleft**; bundling it *inside* MIT source would risk imposing copyleft on the package and its users — unacceptable for an MIT, adoption-focused suite (CLAUDE.md §1).
- Treating the data as a labelled dependency (its own license, loaded at runtime/migration) keeps the plugin code MIT while honoring the data's license and crediting the source.

## Considered and rejected

- **Vendoring the GPL data into the MIT `src/`** — rejected: relicensing risk / copyleft contamination.
- **Sourcing the same data under a permissive license (MIT/CC0/ODbL)** — viable and cleaner, but the user chose to use this specific dataset as a separate dependency; recorded here so a future maintainer knows a permissive swap is the escape hatch if the GPL dependency becomes a problem.

## Consequences

- The data lives in a dedicated GPL-2.0 artifact (a data package/dependency), not in the plugin's MIT source tree; license + attribution retained; consumers are informed in the README.
- This is the chosen pragmatic approach, **not legal advice** — verify the license interaction is acceptable for your distribution before publishing.
