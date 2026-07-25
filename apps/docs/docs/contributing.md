# Contributing

Use Node `>=22.12.0` and pnpm 11. Run `pnpm install
--frozen-lockfile`, then `pnpm check`. Add behavior tests for rules and adapters.
Run `pnpm changeset` for a public package change.

## Tracked follow-up work

These are useful later expansions, not release blockers. Convert each ID into a
GitHub issue when ready for issue tracking.

- `MFDOCTOR-101`: Webpack adapter and compatibility matrix.
- `MFDOCTOR-102`: Rolldown and Vite Plus lifecycle coverage.
- `MFDOCTOR-103`: Modern.js adapter without hiding direct Rspack coverage.
- `MFDOCTOR-106`: Broader Node, bundler, framework, and package-manager matrix.
- `MFDOCTOR-107`: User-defined performance budgets from manifest/stats assets.
- `MFDOCTOR-108`: Opt-in browser runtime trace import and correlation.
