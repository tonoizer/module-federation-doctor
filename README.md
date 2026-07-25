# Module Federation Doctor

`@module-federation/doctor` finds config, sharing, runtime, manifest, and output
problems in Module Federation projects built with Vite, Rspack, and Rsbuild.

Install as a **devDependency**. Doctor is **build/CI-only**: adapters run after
emit in Node and are not part of the browser bundle. They add CI time, not
runtime size or performance cost.

## Primary DX: build plugin

Register Doctor next to your Module Federation plugin. It runs after emit, prints
**all** findings in the terminal (and bundler logs), then fails the build when
policy says so — only after every finding is collected.

**Vite**

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@module-federation/doctor/vite";

plugins: [federation(mfOptions), federationDoctor({ moduleFederation: mfOptions })];
```

**Rspack**

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { moduleFederationDoctorPlugin } from "@module-federation/doctor/rspack";

plugins: [
  new ModuleFederationPlugin(mfOptions),
  moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
];
```

**Rsbuild**

```ts
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@module-federation/doctor/rsbuild";

plugins: [
  pluginModuleFederation(mfOptions),
  pluginModuleFederationDoctor({ moduleFederation: mfOptions }),
];
```

CI is auto-detected from the environment (`CI`, `GITHUB_ACTIONS`, and other
common provider signals). In CI, Doctor fails on error findings and includes
SARIF by default — you do **not** need `mode: "ci"` in plugin config. Local
development defaults to `failOn: "never"` so findings print without breaking
the build. Override with `--ci`, `mode: "ci"`, `mode: "development"`, or
`failOn`.

## CLI (complementary)

Use the CLI when you are not running a bundler build, or for cross-project and
deployed checks:

```bash
pnpm add -D @module-federation/doctor
pnpm mfdoctor check --ci
pnpm mfdoctor check --format terminal,json,sarif
pnpm mfdoctor federation ".mf/doctor/**/project.json"
pnpm mfdoctor runtime ./.mf/observability/latest.json
pnpm mfdoctor probe https://cdn.example.com/mf-manifest.json --remote-entry
pnpm mfdoctor rules config/name-required
```

| Command         | When to use it                                              |
| --------------- | ----------------------------------------------------------- |
| Plugin on build | Gate the real emit; strongest artifact evidence             |
| `check`         | Offline config analysis without a full bundler run          |
| `federation`    | Host↔remote integration after each app wrote `project.json` |
| `runtime`       | Correlate an Observability Plugin export with project facts |
| `probe`         | Inspect a deployed manifest / remoteEntry HEAD (network)    |

`check`, `federation`, and `runtime` stay offline. `probe` is the only command
that fetches over the network, and it never executes remote JavaScript.

## Policy packs and presets

Share org governance with built-in presets (`recommended`, `strict`) and
package-level policy packs via `extends`. Packs can ship severity maps plus
custom `defineRule` plugins. See
[policy packs](./apps/docs/docs/policy-packs.md).

## What it checks

- Core config: names, exposes, remotes, scopes, runtime plugins, public paths.
- Shared modules: versions, singleton/eager use, providers, and tree shaking.
- Runtime modes: startup strategy, snapshots, external runtime, and recovery.
- Vite details: CSS bundling, parser timeouts, and Vite-only switches.
- Build output: manifests, remote entries, type archives, assets, and metadata.
- Whole federation: cross-project name, version, scope, and provider conflicts.

MF `runtimePlugins` in bundler config are checked at build time. **Runtime-only**
apps (`createInstance` / runtime plugins without a Vite/Rspack/Rsbuild MF
**build** plugin) are out of scope for first-class support — use Observability +
`mfdoctor runtime` instead of shipping Doctor into the browser. See
[limitations](./apps/docs/docs/limitations.md) and
[#34](https://github.com/tonoizer/module-federation-doctor/issues/34).

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
- `examples/showcase` — themed misconfigs + runtime green/fail demos; run
  `pnpm demo:showcase`
- From `examples/`: `pnpm --dir examples demo` runs showcase + mixed-issues
  (or `pnpm demo:examples` from the repo root)

The repo also includes an original Codex skill at
`.codex/skills/mfdoctor/SKILL.md` for repeatable diagnosis work.

MIT © 2026 tonoizer and contributors.
