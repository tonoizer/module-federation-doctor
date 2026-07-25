# Module Federation Doctor

`@module-federation/doctor` finds config, sharing, runtime, manifest, and output
problems in Module Federation projects built with Vite, Rspack, and Rsbuild.
It can run as a CLI or as a build plugin.

```bash
pnpm add -D @module-federation/doctor
pnpm mfdoctor check --ci
```

`check` is offline. It writes a terminal report plus optional JSON, SARIF, and a
single-file HTML dashboard:

```bash
pnpm mfdoctor check --format terminal,json,sarif,html
pnpm mfdoctor federation ".mf/doctor/**/project.json"
pnpm mfdoctor rules config/name-required
pnpm mfdoctor runtime ./.mf/observability/latest.json
```

Use the matching plugin to check the final build output:

```ts
import doctor from "@module-federation/doctor/vite";

export default {
  plugins: [
    doctor({
      moduleFederation: federationOptions,
      mode: "ci",
    }),
  ],
};
```

`@module-federation/doctor/rspack` and
`@module-federation/doctor/rsbuild` expose the same adapter shape.

`mfdoctor runtime` imports a user-supplied Observability Plugin export and
correlates share, remote, and init events with local `project.json` facts. It
stays offline and never executes remote JavaScript.

The opt-in probe checks a deployed manifest and, when requested, its remote
entry. It fetches data but never runs remote JavaScript:

```bash
pnpm mfdoctor probe https://cdn.example.com/mf-manifest.json --remote-entry
```

## What it checks

- Core config: names, exposes, remotes, scopes, runtime plugins, public paths.
- Shared modules: versions, singleton/eager use, providers, and tree shaking.
- Runtime modes: startup strategy, snapshots, external runtime, and recovery.
- Vite details: CSS bundling, parser timeouts, and Vite-only switches.
- Build output: manifests, remote entries, type archives, assets, and metadata.
- Whole federation: cross-project name, version, scope, and provider conflicts.

Every built-in rule has an issue, impact, fix, category, and source link. See
the [full documentation](./apps/docs/docs/index.md), including report schemas,
privacy notes, current limits, and the upstream research behind the checks.

## Development

Requires Node `>=22.12.0` and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm release:dry-run
```

Examples:

- `examples/mixed-federation` — healthy Vite + Rspack + Rsbuild e2e path
- `examples/mixed-federation-issues` — same topology with intentional Doctor
  findings; run `pnpm demo:mixed-issues`
- `examples/showcase` — themed misconfigs; run `pnpm demo:showcase`
- From `examples/`: `pnpm --dir examples demo` runs showcase + mixed-issues
  (or `pnpm demo:examples` from the repo root)

The repo also includes an original Codex skill at
`.codex/skills/mfdoctor/SKILL.md` for repeatable diagnosis work.

MIT © 2026 tonoizer and contributors.
