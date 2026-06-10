# Contributing to Medusa KSA

Thanks for helping build the open-source toolkit for running Saudi e-commerce on [Medusa v2](https://medusajs.com). This is a [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build) + [Changesets](https://github.com/changesets/changesets) monorepo, and every package follows one shared pattern. Read this once and you'll know how all of them work.

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## Prerequisites

- **Node.js `>=20`** — the repo pins the version in `.nvmrc`; run `nvm use` if you use nvm.
- **pnpm** — this repo uses pnpm workspaces and a committed lockfile. Install with `corepack enable && corepack prepare pnpm@latest --activate`. Do **not** use npm or yarn; they will produce a conflicting lockfile.

## Repository layout

The workspace globs are `packages/*`, `packages/*/*`, and `apps/*`. Connectors are grouped under category folders that are **not** themselves packages:

```
medusa-ksa/
├── apps/
│   └── demo-store/                 # real Medusa app wiring every package (dev + e2e; never published)
└── packages/
    ├── core/                       # @medusa-ksa/core — the shared safety surface (graph root)
    ├── payments/{moyasar,tap,...}  # medusa-payment-*
    ├── fulfillment/{torod,smsa,...} # medusa-fulfillment-*
    ├── notifications/{unifonic,...} # medusa-notification-*
    ├── zatca/                      # medusa-plugin-zatca (flagship)
    ├── address-saudi/              # medusa-plugin-saudi-address
    └── create-medusa-ksa-app/      # one-command starter
```

The category folders (`payments/`, `fulfillment/`, `notifications/`) have **no `package.json`** — pnpm skips them and picks up the real packages one level deeper via the `packages/*/*` glob.

## Initial setup

```bash
git clone https://github.com/khaledafify/medusa-ksa.git
cd medusa-ksa
pnpm install            # installs the whole workspace from the frozen lockfile
pnpm build              # turbo builds in dependency order — core first
```

`@medusa-ksa/core` is the root of the dependency graph; Turborepo's `^build` ordering guarantees it builds before anything that depends on it.

## Everyday commands

All commands run from the repo root and fan out through Turborepo (cached, dependency-ordered).

| Command | What it does |
|---|---|
| `pnpm build` | `turbo run build` — builds every package (`medusa plugin:build`). |
| `pnpm test` | `turbo run test` — runs [Vitest](https://vitest.dev) across all packages. |
| `pnpm typecheck` | `turbo run typecheck` — `tsc --noEmit`, strict mode. |
| `pnpm lint` | ESLint (flat config) **plus** dependency-cruiser boundary checks **plus** `syncpack` version consistency. |

To work on a single package, scope the task with a filter, e.g. `pnpm --filter medusa-payment-moyasar test` or `turbo run build --filter=@medusa-ksa/core`.

To exercise a connector against a provider sandbox, register it in `apps/demo-store` and run the demo app. Every connector ships at least a happy-path integration test there.

### Tooling you must use (these are fixed decisions)

- **Tests:** Vitest — not Jest.
- **Boundaries:** [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — not `eslint-plugin-boundaries`. It runs in `pnpm lint` and fails the build on a forbidden import.
- **Lint:** ESLint 9 flat config (`eslint.config.js`) with `typescript-eslint`, type-aware, `eslint-config-prettier` last.
- **Formatting:** Prettier; let `lint-staged` fix files on commit rather than hand-formatting.

## Architecture rules (enforced in CI — read before you write code)

These come from [`docs/adr/0002`](./docs/adr/0002-core-safety-surface.md) and [`docs/adr/0003`](./docs/adr/0003-peer-deps-and-package-boundaries.md). They are not style preferences; a violation **fails the build**.

1. **All integration safety lives in `@medusa-ksa/core`.** Outbound HTTP, webhook signature verification, boot-time option validation, secret encryption, money conversion (`sarToHalalas`), error normalization, idempotency, and sandbox detection are implemented **once** in `core` and are the only sanctioned way to do each. A connector that issues its own `fetch`, verifies its own signature, reads a secret directly, or multiplies money by 100 is a defect. The exported surface is specified in [`packages/core/CONTRACT.md`](./packages/core/CONTRACT.md).
2. **`@medusajs/*` are `peerDependencies`, never `dependencies`,** in every published package. The host app provides a single framework instance; bundling a second copy breaks dependency injection. They also belong in `devDependencies` so the package can build and test in isolation.
3. **The only allowed intra-repo import is `@medusa-ksa/core`.** Package → package imports are forbidden. Shared logic that two connectors need goes **into `core`**, never a sideways import.
4. **Strict TypeScript.** `strict` and `noUncheckedIndexedAccess` are on and non-negotiable — they catch the class of bug that breaks money and crypto code.

## Adding a new connector

Use `packages/payments/moyasar` (`medusa-payment-moyasar`) as the reference template — its `package.json`, `README.md`, loader, service, and webhook route are the canonical shape. The DX rules in [`CLAUDE.md`](./CLAUDE.md) §7 apply to every package.

1. **Create the folder** under the right category, e.g. `packages/payments/<name>` for a payment provider (`packages/fulfillment/<name>`, `packages/notifications/<name>`, etc. for the others). No `package.json` goes in the category folder itself.
2. **Copy `package.json` from the canonical template** in [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md) and adjust:
   - `name` is unscoped and follows `medusa-{type}-{name}` (e.g. `medusa-payment-tap`).
   - `engines.node` is `>=20`; `type` is `module`.
   - `keywords` include `"medusa-plugin"`, `"medusa-v2"`, plus provider-specific terms.
   - Subpath `exports` map to the build output exactly as in the template (`./providers/*`, `./modules/*`, `./workflows`, `./*`).
   - `files` ships build output only (`.medusa/server`, `README.md`, `LICENSE`).
   - `dependencies` contains **only** `@medusa-ksa/core` (`workspace:*` in dev) and any non-Medusa runtime libs (e.g. `zod`). `@medusajs/*` go in `peerDependencies` and `devDependencies`.
   - `publishConfig` is `{ "access": "public", "provenance": true }`.
3. **Add a `tsconfig.json`** that extends `../../tsconfig.base.json` (adjust the relative depth) with `outDir: ".medusa/server"`, `rootDir: "src"`.
4. **Build on `core` primitives** — use `createLoader()`, `KsaError`, `verifyWebhook()`, `sarToHalalas()`. Read the CONTRACT first.
5. **Follow the env-first DX rules:** read documented env vars as the fallback, validate at boot via `createLoader()` and fail fast with a human-readable message, ship your own webhook route, default to `currency: "SAR"`, and auto-detect sandbox from the key prefix (no "mode" flag).
6. **Write the README** by following the `medusa-payment-moyasar` README as the template, and add a `.env.example`.
7. **Wire it into `apps/demo-store`** and add at least a happy-path integration test.
8. **List it in the root README package matrix** with an honest status badge (`✅ Stable` / `🚧 Beta` / `📋 Planned` — never claim "stable" prematurely).
9. **Add a changeset** (see below).

## Changesets & versioning

Packages are versioned and published independently with Changesets. **Every change that affects a published package needs a changeset.**

```bash
pnpm changeset
```

This prompts you to pick the affected packages, choose a bump (`patch` / `minor` / `major` per [semver](https://semver.org)), and write a one-line summary that becomes the changelog entry. Commit the generated file in `.changeset/` with your PR.

- Internal `@medusa-ksa/core` dependencies are bumped as `patch` automatically; you don't manage the `workspace:*` range by hand — Changesets rewrites it to a real range at publish time.
- `demo-store` is ignored and never published.
- Releases are automated: merging to `main` opens/updates a **"Version Packages"** PR via the Changesets GitHub Action; merging that PR publishes the changed packages to npm with provenance. You never run `pnpm publish` by hand.
- Docs-only or chore-only changes that touch no published package don't need a changeset — but if CI's changeset check flags you, add an empty one with `pnpm changeset --empty`.

## Pull requests

1. Branch off `main`.
2. Make your change; keep it focused on one concern.
3. Run `pnpm build && pnpm lint && pnpm typecheck && pnpm test` locally — these are exactly what CI runs.
4. Add a changeset if a published package changed.
5. Open the PR and fill out the template. CI must be green before review.

### Commit messages

Write clear, concise commit messages: a short imperative subject line (e.g. `Add Tap webhook signature verification`) and, where it helps, a body explaining the *why*. Keep each commit a single logical change so history stays reviewable.

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/khaledafify/medusa-ksa/issues/new/choose). For anything security-related, do **not** open a public issue — follow [`SECURITY.md`](./SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
