# All integration safety lives in `@medusa-ksa/core`; connectors are thin adapters

Outbound HTTP, webhook signature verification, option validation (boot-time loaders), secret encryption, money conversion, provider-error normalization, idempotency, and sandbox detection are implemented **once** in `@medusa-ksa/core` and are the *only* sanctioned way to do each. A connector that issues its own `fetch`, verifies its own signature, reads a secret directly, or multiplies money by 100 is a defect, not a style choice. The exported surface is specified in `packages/core/CONTRACT.md`.

## Why

- **One audit/patch point** for the entire suite's security and reliability — fix a retry or redaction bug once, every connector inherits it.
- **Identical DX** across all packages (CLAUDE.md §5/§7) and a genuine one-line gateway swap, because every adapter speaks the same core primitives.

## Consequences

- Every published package depends on `@medusa-ksa/core` at runtime; `core` is the root of the dependency graph (see ADR-0003).
- `core` owns the threat surface: secrets handling, signature checks, and outbound timeouts are reviewed there, not in 18 places.
