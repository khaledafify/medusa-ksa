# Medusa KSA — Configuration Reference

The exact, opinionated config for the whole monorepo (Phase 0 of `docs/ROADMAP.md`). Snippets are starting points to verify against current tool versions — the **intent** is binding, the exact keys may drift. Build/publish conventions follow CLAUDE.md §10 and the ADRs.

---

## 1. Workspace — `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"      # core, zatca, address-saudi, create-medusa-ksa-app
  - "packages/*/*"    # payments/*, fulfillment/*, notifications/*
  - "apps/*"
```

- The category folders (`payments/`, `fulfillment/`, `notifications/`) have no `package.json`, so pnpm skips them and only picks up the real packages one level deeper. `packages/*` still catches the standalone ones.
- pnpm only (lockfile committed). Use `workspace:*` for the `@medusa-ksa/core` dependency in connectors during dev; Changesets rewrites it to a real range on publish.

## 2. Turborepo — `turbo.json`

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".medusa/**", "dist/**"] },
    "test":  { "dependsOn": ["^build"], "outputs": [] },
    "lint":  { "outputs": [] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] }
  }
}
```

- `^build` = dependency-ordered, so `core` always builds first (ADR-0002). Caching on by default.
- Root scripts: `"build": "turbo run build"`, `"test": "turbo run test"`, `"lint": "turbo run lint && depcruise packages"`.

## 3. TypeScript

**`tsconfig.base.json`** (root):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

**Per package** `tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": ".medusa/server", "rootDir": "src" },
  "include": ["src"]
}
```

- `strict` + `noUncheckedIndexedAccess` are non-negotiable — they catch the class of bug that breaks money/crypto code.
- Project references between packages so editor + `tsc -b` understand the graph.

## 4. Changesets — `.changeset/config.json`

```jsonc
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["demo-store"]
}
```

- `access: public` is required for the scoped `@medusa-ksa/core`.
- `demo-store` is ignored (never published).

## 5. Lint & format

- **ESLint** flat config (`eslint.config.js`) at root: `@typescript-eslint` (type-aware), `eslint-config-prettier` last. Ban `any` on public exports, require `import type`.
- **Prettier** (`.prettierrc`): 2-space, no semicolons or semicolons — pick one and never debate it again (suggest: semicolons off, double quotes, trailing commas `es5`).
- **`.editorconfig`**: LF, UTF-8, final newline, 2-space.

## 6. Dependency boundaries — `.dependency-cruiser.cjs` (ADR-0003 enforcement)

The machine that stops architecture erosion:

```js
module.exports = {
  forbidden: [
    {
      name: "no-cross-package-imports",
      comment: "Connectors may import only @medusa-ksa/core (ADR-0003).",
      severity: "error",
      from: { path: "^packages/(?!core/)" },
      to: {
        path: "^packages/(?!core/)",
        pathNot: "^packages/[^/]+/(node_modules|src)" // allow self
      }
    },
    {
      name: "medusa-must-be-peer",
      comment: "@medusajs/* must be peerDependencies, never bundled.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm"], path: "^@medusajs/" , dependencyTypesNot: ["npm-peer"] }
    }
  ],
  options: { tsConfig: { fileName: "tsconfig.base.json" }, doNotFollow: { path: "node_modules" } }
}
```

- Run in CI and in `pnpm lint`. A stray sibling import or a Medusa package in `dependencies` **fails the build**.
- (Alternative: `eslint-plugin-boundaries`. Pick one — this is one of the two open tooling choices.)

## 7. Version consistency — `syncpack`

- `syncpack lint` in CI to keep shared dep versions (TypeScript, Medusa peers, test libs) identical across all packages. Prevents "works in core, breaks in tap" version skew.

## 8. Git & runtime

- **`.gitignore`**: `node_modules`, `.medusa`, `dist`, `.env`, `.turbo`, `*.log`, coverage.
- **`.gitattributes`**: `* text=auto eol=lf`.
- **`.nvmrc`**: `20`.
- **`engines`** in every `package.json`: `"node": ">=20"`.

## 9. Commit hooks — Husky + lint-staged

`.lintstagedrc`:

```jsonc
{
  "*.{ts,tsx}": ["prettier --write", "eslint --fix"],
  "*": ["prettier --ignore-unknown --write"]
}
```

- Husky `pre-commit`: `lint-staged`; `pre-push`: `turbo run typecheck test`. *(Skill: `setup-pre-commit`.)*

## 10. CI — `.github/workflows/`

**`ci.yml`** (every PR):

```yaml
on: { pull_request: {}, push: { branches: [main] } }
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm lint            # eslint + dependency-cruiser + syncpack
      - run: pnpm typecheck
      - run: pnpm test
```

**`release.yml`** (push to main): the Changesets action opens/updates the "Version Packages" PR; merging it publishes changed packages to npm. Set `NPM_TOKEN`, enable **provenance** (`NPM_CONFIG_PROVENANCE=true`, `id-token: write`).

## 11. Community health files

`CONTRIBUTING.md`, `SECURITY.md` (disclosure path), `CODE_OF_CONDUCT.md`, `CODEOWNERS`, `.github/ISSUE_TEMPLATE/{bug,feature}.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `LICENSE` (MIT). These directly affect the adoption/stars goal.

---

## Canonical `package.json` (every published connector)

Annotated template — copy per package and adjust names:

```jsonc
{
  "name": "medusa-payment-moyasar",        // unscoped, medusa-{type}-{name} (CLAUDE.md §4)
  "version": "0.1.0",
  "description": "Moyasar payment provider for Medusa v2 (Saudi Arabia).",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/khaledafify/medusa-ksa.git",
    "directory": "packages/payments/moyasar"
  },
  "keywords": ["medusa-plugin", "medusa-v2", "payment", "moyasar", "saudi", "ksa", "mada"],
  "engines": { "node": ">=20" },
  "type": "module",

  // Subpath exports → build output (CLAUDE.md §10)
  "exports": {
    "./providers/*": "./.medusa/server/src/providers/*/index.js",
    "./modules/*":   "./.medusa/server/src/modules/*/index.js",
    "./workflows":   "./.medusa/server/src/workflows/index.js",
    "./*":           "./.medusa/server/src/*.js"
  },
  "files": [".medusa/server", "README.md", "LICENSE"],  // ship build output only

  "scripts": {
    "build": "medusa plugin:build",
    "dev": "medusa plugin:develop",
    "test": "vitest run",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },

  // Runtime: ONLY core. Everything Medusa is peer (ADR-0003).
  "dependencies": {
    "@medusa-ksa/core": "workspace:*",     // Changesets rewrites on publish
    "zod": "^3"
  },
  "peerDependencies": {
    "@medusajs/framework": "^2.13.0",
    "@medusajs/medusa": "^2.13.0"
  },
  "devDependencies": {
    "@medusajs/framework": "^2.13.0",
    "@medusajs/test-utils": "^2.13.0",
    "vitest": "^2",
    "typescript": "^5"
  },
  "publishConfig": { "access": "public", "provenance": true }
}
```

**`@medusa-ksa/core` differs:** name is scoped (`@medusa-ksa/core`), it has **no** `@medusa-ksa/*` dependency, and it carries the shared types/runtime helpers. Still publishes `public` with provenance.

### Why each choice
- **`peerDependencies` for `@medusajs/*`** → host app provides one framework instance; bundling a second breaks DI (ADR-0003). They're also in `devDependencies` so the package builds/tests in isolation.
- **`files` = build output only** → never ship `src`/tests; smaller installs, no source ambiguity.
- **Subpath `exports`** → consumers `resolve` `medusa-payment-moyasar/providers/moyasar` exactly as CLAUDE.md §7 shows.
- **`provenance: true`** → npm supply-chain attestation; a trust signal for an adoption-driven OSS project.
- **`workspace:*`** for core in dev → always the local build; Changesets pins a real range at publish so external installs resolve from npm.

---

## Open tooling decisions (pick before Phase 0 ends)
1. **Boundary enforcer:** `dependency-cruiser` (shown) vs `eslint-plugin-boundaries`. Recommendation: dependency-cruiser — it also enforces the peer-dep rule in one place.
2. **Test runner:** `vitest` (fast, ESM-native, shown) vs `jest`. Recommendation: vitest, with `@medusajs/test-utils` for integration runners.
