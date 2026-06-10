# Connectors are isolated Medusa modules, associated by Module Links — never foreign keys

Medusa v2 modules are hard-isolated: a module cannot import another module's service, and no foreign key may cross a module boundary. We therefore model every cross-module association (notably `ZatcaInvoice` ↔ `Order`) as a **Module Link** in `src/links/` (one link per file) and read across modules via the remote query (`query.graph()`), never via a direct service import. This is what keeps each connector an independently installable, independently publishable package.

## Consequences

- **No package imports another package's service.** The only sanctioned cross-module read path is the remote query.
- Links are synced with `medusa db:migrate`; a missing sync is a silent "link doesn't exist" bug.
- A connector can be installed alone (Path B in CLAUDE.md §7) because it owns its models and links nothing it doesn't ship.
