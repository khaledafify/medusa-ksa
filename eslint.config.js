// @ts-check
import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import prettier from "eslint-config-prettier"

/**
 * Root ESLint 9 flat config for the medusa-ksa monorepo.
 *
 * - Type-aware linting via typescript-eslint's projectService + tsconfig.base.json.
 * - eslint-config-prettier is applied LAST so formatting is owned solely by Prettier.
 * - Architectural boundaries (no cross-package imports, @medusajs/* must stay peer)
 *   are enforced by dependency-cruiser in `pnpm lint`, NOT here (ADR-0003).
 */
export default tseslint.config(
  // Never lint build output, vendored deps, or generated artifacts.
  {
    ignores: [
      "**/.medusa/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      // create-medusa-ksa-app ships a raw template that is copied, not linted as repo source.
      "packages/create-medusa-ksa-app/template/**",
    ],
  },

  // Baseline JS recommendations.
  eslint.configs.recommended,

  // Type-aware TypeScript recommendations (strictest practical tier).
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Wire the type information for type-aware rules across the workspace.
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project-wide rule tuning for TypeScript sources.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      // Require `import type` for type-only imports so verbatimModuleSyntax stays happy
      // and type imports are erased cleanly from emit.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],

      // Ban `any` — money and crypto paths must not lose their types (ADR-0002).
      // `error` on explicit `any`; the implicit-any leaks below are kept as warnings so
      // they surface without blocking every incremental commit.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",

      // Surface unused code; allow intentional `_`-prefixed throwaways.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Promise hygiene: secrets/HTTP/clearance flows must not float unawaited.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      "@typescript-eslint/require-await": "warn",
    },
  },

  // Public API surface: hold exported declarations to the strictest bar.
  // `any` anywhere on an exported value/type is an error (no escape hatch) so the
  // published `.d.ts` files never leak `any` to consumers (ADR-0002 / CONTRACT.md).
  {
    files: ["packages/*/src/**/*.{ts,tsx}", "packages/*/*/src/**/*.{ts,tsx}"],
    ignores: ["**/*.{test,spec}.{ts,tsx}", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },

  // Tests (vitest) relax the strictest type-safety rules where fixtures need it.
  {
    files: ["**/*.{test,spec}.{ts,tsx,mts,cts}", "**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-floating-promises": "off",
      // Test fakes (e.g. a stub fetch/sleep) legitimately stringify loose inputs
      // and declare async signatures without awaiting — fine in fixtures.
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/require-await": "off",
    },
  },

  // Plain JS/CJS tooling files (configs, scripts) don't get type-aware parsing.
  {
    files: ["**/*.{js,cjs,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // MUST be last: turn off every rule that conflicts with Prettier's formatting.
  prettier
)
