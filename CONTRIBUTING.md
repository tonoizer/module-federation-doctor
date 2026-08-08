# Contributing to Module Federation Doctor

Thanks for helping improve Module Federation Doctor. Contributions are
welcome, including bug fixes, tests, documentation, examples, and rule or
adapter improvements.

Please read the [Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

## Before opening an issue

- Search existing issues and discussions first.
- For bugs, use the [bug report template][bug-report] and include a minimal
  reproduction when possible.
- Include the Doctor, Node, package manager, and bundler versions involved.
- Remove secrets, credentials, private paths, and sensitive report data from
  logs and fixtures.
- Report security vulnerabilities privately as described in the
  [security policy][security]. Do not open a public issue for a vulnerability.

Questions and general discussion belong in the project's
[Discord community][discord].

## Development setup

The repository requires Node `>=22.12.0` and pnpm 11. The pinned package
manager version is `pnpm@11.17.0`.

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

Use the smallest relevant check while iterating:

```bash
corepack pnpm fmt:check
corepack pnpm lint
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm typecheck
corepack pnpm docs:build
```

Before requesting review, run the complete repository check:

```bash
corepack pnpm check
```

The full check includes formatting, linting, build and type validation, unit
and integration tests, examples, end-to-end tests, documentation, and package
validation. If a check cannot run locally, explain that in the pull request.

## Making changes

- Keep changes focused and preserve unrelated work.
- Add or update tests for behavior changes and regression fixes.
- Keep diagnostics deterministic and avoid leaking secrets or private paths in
  reports, fixtures, or documentation.
- Update user-facing documentation and examples when behavior or CLI output
  changes.
- For new or changed rules, document the issue, impact, fix, category, and
  relevant source links alongside the rule documentation.

### Changesets

Changes that affect the published `@module-federation/doctor` package should
include a changeset:

```bash
corepack pnpm changeset
```

Select `@module-federation/doctor`, describe the user-facing change, and commit
the generated file in `.changeset/`. Documentation-only, test-only, and
repository-maintenance changes normally do not need a changeset.

## Pull requests

Use a focused branch with a descriptive conventional prefix such as `feat/`,
`fix/`, `docs/`, `test/`, `refactor/`, or `chore/`.

A good pull request:

- Explains the problem and the approach taken.
- Links the relevant issue or discussion, if one exists.
- Lists the checks that were run and any known limitations.
- Includes tests, documentation, and a changeset when applicable.
- Avoids unrelated formatting or generated-file churn.
- Responds to review feedback and keeps all required checks passing.

Maintainers may ask for a smaller reproduction, additional coverage, or a
follow-up changeset before merging.

## License

By contributing to this repository, you agree that your contributions will be
licensed under the repository's [MIT License](./LICENSE).

[bug-report]: https://github.com/tonoizer/module-federation-doctor/issues/new?template=bug_report.yml
[discord]: https://discord.gg/VYtDGFmgVN
[security]: https://github.com/tonoizer/module-federation-doctor/blob/main/.github/SECURITY.md
