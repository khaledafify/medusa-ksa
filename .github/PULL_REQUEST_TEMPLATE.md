## Summary

<!-- What does this PR do, and why? Link any related issue, e.g. "Closes #123". -->

## Type of change

<!-- Check all that apply. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature / new connector (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior or public API)
- [ ] Documentation only
- [ ] Tooling / CI / monorepo maintenance

## Checklist

- [ ] My code follows the package template (reference: `medusa-payment-moyasar`) and the conventions in `CONTRIBUTING.md`.
- [ ] `@medusajs/*` stay in `peerDependencies` (+ `devDependencies`); the only intra-repo runtime import is `@medusa-ksa/core` (ADR-0003).
- [ ] Integration concerns (HTTP, webhook verification, secrets, money conversion) go through `@medusa-ksa/core`, not the connector (ADR-0002).
- [ ] `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` all pass locally.
- [ ] Tests pass and I added/updated tests covering the change (Vitest; happy path wired through `apps/demo-store` where applicable).
- [ ] I added a changeset (`pnpm changeset`) if a published package changed.
- [ ] Documentation (package README, `.env.example`, root README package matrix) is updated where relevant, with an honest status badge.
- [ ] I have not committed any secrets, and no secrets are logged.

## Additional notes

<!-- Screenshots, sandbox results, follow-ups, or anything reviewers should know. -->
