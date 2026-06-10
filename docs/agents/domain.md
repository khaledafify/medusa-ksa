# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **multi-context monorepo** (pnpm workspaces). Each published package under
`packages/*` is its own bounded context with its own domain language. System-wide,
KSA-commerce-shared vocabulary lives in the root `CONTEXT.md`; package-specific terms
live in that package's `CONTEXT.md`.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`CONTEXT.md`** at the repo root — shared, suite-wide domain glossary (SAR/halalas, EGS, ICV/PIH, clearance vs reporting, provider conventions).
- The relevant package's **`packages/<pkg>/CONTEXT.md`** — the bounded-context glossary for the package you're working in.
- **`docs/adr/`** at the root for system-wide decisions, and **`packages/<pkg>/docs/adr/`** for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

> Authoritative project decisions also live in **`CLAUDE.md`** at the root — treat it as
> settled per its own preamble. `CONTEXT.md` captures *language*; `CLAUDE.md` captures *decisions*.

## File structure

Multi-context monorepo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md                     ← index of every context's CONTEXT.md
├── CONTEXT.md                         ← suite-wide shared glossary
├── docs/adr/                          ← system-wide decisions
└── packages/
    ├── core/
    │   └── CONTEXT.md
    ├── zatca/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions (e.g. hash-chain, clearance)
    └── payment-moyasar/
        └── CONTEXT.md
```

Per-package `CONTEXT.md` and `docs/adr/` directories are created lazily as each package
is built — they do not need to exist upfront for empty/stub packages.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
