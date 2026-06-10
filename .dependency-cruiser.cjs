// @ts-check
/**
 * Dependency-boundary enforcement for the medusa-ksa monorepo (ADR-0003).
 *
 * Layout is GROUPED: real packages live either one level deep
 *   (flat:    packages/core, packages/zatca, packages/address-saudi,
 *             packages/create-medusa-ksa-app)
 * or two levels deep under a category folder that has no package.json
 *   (grouped: packages/payments/*, packages/fulfillment/*, packages/notifications/*).
 *
 * The package "owner" segment is therefore one of:
 *   payments/<pkg> | fulfillment/<pkg> | notifications/<pkg> | <pkg>
 * Both shapes are captured by the same group so a sibling import can be
 * distinguished from a same-package (self) import via a back-reference.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      // A package may import ONLY @medusa-ksa/core (packages/core); never a sibling package.
      name: "no-cross-package-imports",
      comment:
        "Connectors are independently versioned and standalone-installable; the only sanctioned " +
        "intra-repo import is @medusa-ksa/core (packages/core). Sideways package -> package imports " +
        "couple the suite and break standalone install (ADR-0003). Shared code goes into core instead.",
      severity: "error",
      from: {
        // Capture the owning package: a grouped "<category>/<pkg>" or a flat "<pkg>", but not core itself.
        path: "^packages/(?!core/)((?:payments|fulfillment|notifications)/[^/]+|[^/]+)/",
      },
      to: {
        // Any other package under packages/, EXCEPT core (allowed) and EXCEPT this same package ($1 back-reference = self).
        path: "^packages/(?!core/)((?:payments|fulfillment|notifications)/[^/]+|[^/]+)/",
        pathNot: "^packages/(?:core/|$1/)",
      },
    },
    {
      // @medusajs/* must resolve as peerDependencies — never bundled as a normal npm dependency.
      name: "medusa-must-be-peer",
      comment:
        "The host Medusa app must provide a single @medusajs/* framework instance; bundling a second " +
        "copy via a normal dependency breaks dependency injection and module resolution (ADR-0003). " +
        "Declare @medusajs/* as peerDependencies (plus devDependencies for isolated build/test).",
      severity: "error",
      from: {},
      to: {
        path: "node_modules/@medusajs/",
        // Resolved as a plain runtime/dev npm dependency rather than satisfying a peer declaration.
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-bundled"],
        dependencyTypesNot: ["npm-peer"],
      },
    },
  ],
  options: {
    // Boundary rules are path/regex based (ADR-0003), so no tsConfig is required to enforce them.
    // It is intentionally omitted: tsconfig.base.json has no `include`, so pointing TypeScript at it
    // throws TS18003 ("No inputs were found") on the empty/early skeleton. Re-add
    // `tsConfig: { fileName: "<a tsconfig that includes sources>" }` later only if alias resolution is needed.
    tsPreCompilationDeps: true,
    // Don't crawl into installed deps; we only assert HOW @medusajs/* is required, not its internals.
    doNotFollow: { path: "node_modules" },
    // Resolve through the pnpm-workspace symlinked node_modules and prefer types where present.
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
