# Every suite package is a self-contained drop-in plugin; the host app's footprint is config + env only

Each published package installs into a consumer's Medusa app as a **self-contained plugin/provider**. The **entire footprint** in the host app is: an **npm dependency**, **one registration block** in `medusa-config.ts` (a `plugins:[]` entry for custom modules, or one `providers:[]` entry for payment/fulfillment/notification), and **env vars**. Everything else — modules, **migrations**, **data seeding**, API routes, subscribers/hooks, scheduled jobs, the one ZATCA admin extension — lives **inside the package** and runs from there. **Nothing is copied into the consumer's app; no app source is edited; no manual seed/setup scripts are added to the app.** Removing a package = delete its config block + `npm uninstall`.

## Why

- The host Medusa app must stay **vanilla and updatable**. The user updates the framework via `npm/pnpm update @medusajs/*`; because our packages declare `@medusajs/*` as **peerDependencies** (ADR-0003) and never pin/vendor the framework, those updates **never conflict** with the suite.
- True plug-in/plug-out is the suite's adoption thesis (CLAUDE.md §6/§7): a merchant adds one block and it works; removes it and it's gone.

## Consequences

- **Self-migrate + self-seed:** a package needing schema or seed data (e.g. `saudi-address` loading its bundled geography) does so via the **plugin's own migration/loader** — installing + `db:migrate` populates it automatically. A package must **never** require the consumer to run a seed/setup script in their app.
- `apps/demo-store` is treated as a stand-in consumer: it registers packages via config + env only. Test/e2e harnesses are the one allowed extra (they exercise the plugins) but they never become part of a package's required install steps.
- Bundled assets (e.g. the GPL geography dataset, ADR-0012) ship **inside the package / its dependency** and load from there — not as files the consumer places.
- Verification: a package's README install section is **dep + config block + env** and nothing more; if it asks the consumer to copy a file or run a script, that's a defect.
