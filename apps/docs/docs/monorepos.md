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

Manual globs remain available when you need an escape hatch:

```bash
mfdoctor federation "packages/*/.mf/doctor/project.json"
```

Share org policy with a workspace package (or path) and `extends` — see
[policy packs and presets](./policy-packs.md). Example fixture:
`fixtures/policy-packs/acme-mfdoctor-policy`.

See [CLI and CI](./cli.md) for the reusable GitHub Action.
