# Module Federation Doctor Contributing Guide

Thanks for your interest in contributing! New contributors are welcome.
Please read the [Code of Conduct](./CODE_OF_CONDUCT.md) first.

## Sending a Pull Request

1. Create a focused branch from `main` (`feat/`, `fix/`, `docs/`, or similar).
2. Make the smallest change that solves the problem.
3. Add or update tests when behavior changes.
4. Run the relevant checks and make sure CI passes.
5. Open a concise PR with a clear summary, related issue, and test results.

## Setup

The repository requires Node `>=22.12.0` and pnpm `11.17.0`.

```bash
npm install --global pnpm@11.17.0
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

## Testing

Run focused checks while working:

```bash
pnpm fmt:check
pnpm lint
pnpm test:unit
pnpm test:integration
```

Before submitting a PR, run the full repository check:

```bash
pnpm check
```

## Changesets

If a change affects the published `@module-federation/doctor` package, add a
changeset with `pnpm changeset` and commit the generated file. Documentation,
test-only, and repository-maintenance changes normally do not need one.

For bugs, use the [bug report template][bug]. For security issues, follow the
[security policy][security] and do not open a public issue. General questions
belong in the [Discord community][discord].

[bug]: https://github.com/tonoizer/module-federation-doctor/issues/new?template=bug_report.yml
[discord]: https://discord.gg/VYtDGFmgVN
[security]: https://github.com/tonoizer/module-federation-doctor/blob/main/.github/SECURITY.md
