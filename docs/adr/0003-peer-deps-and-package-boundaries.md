# Medusa framework packages are peerDependencies; the only allowed intra-repo import is `@medusa-ksa/core`

`@medusajs/*` framework packages are declared as **peerDependencies** (never `dependencies`) in every published package, so the host Medusa app provides a single framework instance — bundling a second copy breaks dependency injection and module resolution in subtle, hard-to-debug ways. Within the monorepo, a connector may import **only** `@medusa-ksa/core` and Medusa peers; **package → package imports are forbidden** and enforced mechanically in CI, not left to review.

## Considered options

- *Medusa as a normal dependency* — rejected: duplicate framework instances, broken DI, larger installs.
- *Allowing connectors to share code directly* — rejected: it couples independently-versioned packages and defeats standalone install.

## Consequences

- `core` has **zero** dependencies on other suite packages (it is the graph root).
- Shared logic that two connectors need goes **into `core`**, never a sideways import.
- A boundary violation fails the build (dependency-boundary check in CI), so the architecture can't erode silently.
