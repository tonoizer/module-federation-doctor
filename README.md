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

Requires Node `^20.19.0 || >=22.12.0` and pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm release:dry-run
```

Examples:

- `examples/mixed-federation` — healthy Vite + Rspack + Rsbuild e2e path
- `examples/showcase` — intentional misconfigs; run `pnpm demo:showcase` to see
  `config/name-required`, `config/expose-key-invalid`, and
  `shared/eager-without-singleton`

The repo also includes an original Codex skill at
`.codex/skills/mfdoctor/SKILL.md` for repeatable diagnosis work.

MIT © 2026 tonoizer and contributors.
