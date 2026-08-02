# Monorepos

Build each federation app with the Doctor plugin so it writes
`.mf/doctor/project.json`. Then run the one-shot workspace gate from the
monorepo root (or scoped roots):

```bash
mfdoctor workspace
mfdoctor workspace apps packages --format terminal,json,sarif
```

That discovers project facts and checks version ranges, providers, singleton
choices, and share scopes across projects. Exit `0` / `1` / `2` match the rest
of the CLI.

Doctor keeps project display names for v1 reports, but workspace federation uses
a stable application identity based on the workspace-relative app path. This
means two apps with the same package name stay separate. The gate also follows
Node's normal package resolution chain, so pnpm hoists, nested installs, and
workspace links are checked from each app's own context.

If a project report points at a missing root, or duplicate reports share an
identity with different contents, Doctor reports partial analysis and exits `2`.
Keep workspace roots scoped to the monorepo and rely on the default ignores for
`node_modules`, build output, caches, and coverage directories.

Manual globs remain available when you need an escape hatch:

```bash
mfdoctor federation "packages/*/.mf/doctor/project.json"
```

Share org policy with a workspace package (or path) and `extends` — see
[policy packs and presets](./policy-packs.md). Example fixture:
`fixtures/policy-packs/acme-mfdoctor-policy`.

See [CLI and CI](./cli.md) for the reusable GitHub Action.
