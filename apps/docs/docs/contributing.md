# Contributing

Use Node `>=22.12.0` and pnpm 11. Run `pnpm install
--frozen-lockfile`, then `pnpm check`. Add behavior tests for rules and adapters.
Run `pnpm changeset` for a public package change.

## Tracked follow-up work

These are useful later expansions, not release blockers. Each ID has a GitHub
issue; close the issue and drop the matching row from
[limitations](./limitations.md) when the work ships.

- `MFDOCTOR-101` → [#10](https://github.com/tonoizer/module-federation-doctor/issues/10): Webpack adapter and compatibility matrix.
- `MFDOCTOR-102` → [#11](https://github.com/tonoizer/module-federation-doctor/issues/11): Rolldown and Vite Plus lifecycle coverage.
- `MFDOCTOR-103` → [#12](https://github.com/tonoizer/module-federation-doctor/issues/12): Modern.js adapter without hiding direct Rspack coverage.
- `MFDOCTOR-104` → [#13](https://github.com/tonoizer/module-federation-doctor/issues/13): HTML analysis UI beyond the portable report.
- `MFDOCTOR-105` → [#14](https://github.com/tonoizer/module-federation-doctor/issues/14): Runtime / dynamic imports beyond static analysis.
- `MFDOCTOR-106` → [#15](https://github.com/tonoizer/module-federation-doctor/issues/15): Broader Node, bundler, framework, and package-manager matrix.

Permanent non-goal (not follow-up work): no undocumented private Module
Federation plugin fields —
[#18](https://github.com/tonoizer/module-federation-doctor/issues/18).
