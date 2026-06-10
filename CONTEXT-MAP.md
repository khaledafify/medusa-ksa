# Context Map

This monorepo is **multi-context**: each published package under `packages/*` is its own
bounded context with its own domain language. This file indexes them. Read the relevant
`CONTEXT.md` before working in a context. See `docs/agents/domain.md` for the consumer rules.

Per-package `CONTEXT.md` files are created **lazily** by `/grill-with-docs` as each package is
built — an entry below without a file yet just means that package is still a stub.

## Shared

- **Suite-wide glossary** → `CONTEXT.md` (root) — SAR/halalas, EGS, ICV/PIH, clearance vs
  reporting, the shared provider/loader conventions every package inherits from `@medusa-ksa/core`.

## Contexts

| Context | Package | `CONTEXT.md` |
|---|---|---|
| Core backbone | `packages/core` | lazy — API contract in `packages/core/CONTRACT.md` |
| ZATCA e-invoicing (flagship) | `packages/zatca` | lazy — also see `packages/zatca/SPEC.md` |
| Payments | `packages/payments/*` | lazy |
| Fulfillment | `packages/fulfillment/*` | lazy |
| Notifications | `packages/notifications/*` | lazy |
| Saudi address | `packages/address-saudi` | lazy |
| Scaffolder | `packages/create-medusa-ksa-app` | lazy |

> Authoritative *decisions* (not language) live in `CLAUDE.md` at the root.
