<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/mfdoctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/mfdoctor-readme-logo-light.svg">
  <img alt="MFDoctor" src="./assets/mfdoctor-readme-logo-light.svg" width="180" height="40">
</picture>

[![version](https://img.shields.io/npm/v/%40tonoizer%2Fmfdoctor?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@tonoizer/mfdoctor)
[![downloads](https://img.shields.io/npm/dt/%40tonoizer%2Fmfdoctor.svg?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@tonoizer/mfdoctor)
[![documentation](https://img.shields.io/badge/docs-mfdoctor.kevinbeier.com-000000?style=flat)](https://mfdoctor.kevinbeier.com)

`@tonoizer/mfdoctor` finds config, sharing, runtime, manifest, and output
problems in Module Federation projects built with Vite, Rspack, Rsbuild,
Webpack, Modern.js, and Nuxt 3/4.

Install as a **devDependency**. MFDoctor is **build/CI-only**: adapters run after
emit in Node and are not part of the browser bundle. They add CI time, not
runtime size or performance cost. The build plugin is the primary integration;
the CLI complements it for config, workspace, runtime, and deployed checks.

**Agents:** read the terminal findings block, open the linked rule docs, apply
the fix (or an intentional [governance](./apps/docs/docs/suppressions.md)
mute), and rebuild until the process exits **0**. Quiet success prints nothing.

## Primary DX: build plugin

Register MFDoctor next to your Module Federation plugin. It runs **after emit**,
prints **all** findings once at the end of the build (severity, rule, message,
fix, docs links), then fails when policy says so — only after every finding is
collected. Clean builds stay quiet by default.

**Vite** (also Rolldown-integrated Vite and Vite Plus — same entry)

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";

plugins: [federation(mfOptions), federationDoctor({ moduleFederation: mfOptions })];
```

**Nuxt 3/4** (public `vite:extendConfig` adapter)

```ts
import moduleFederationDoctor from "@tonoizer/mfdoctor/nuxt";

export default defineNuxtConfig({
  modules: ["@module-federation/nuxt", [moduleFederationDoctor, { moduleFederation: mfOptions }]],
});
```

The official Nuxt Module Federation module still owns federation. The
MFDoctor module observes both client and SSR Vite builds without owning the
federation plugin or duplicating its configuration.

**Multiple Module Federation instances**

When one compiler/config intentionally contains more than one independently
configured federation graph, pass the instances explicitly when the bundler
does not expose their public options:

```ts
federationDoctor({
  moduleFederationInstances: [
    { pluginName: "ModuleFederationPlugin", config: checkoutMfOptions },
    { pluginName: "ModuleFederationPlugin", config: catalogMfOptions },
  ],
});
```

Webpack, Rspack, and Vite-family adapters also read public plugin configs when
available. MFDoctor derives stable per-instance IDs, keeps manifests/stats/build
outputs and shared-version evidence scoped, and reports identical duplicate
registrations separately. Workspace and UI federation graphs include the
instance scope in every affected edge and node; Nuxt client/SSR outputs are
aggregated deterministically.

**Rspack** (direct `@rspack/core` — first-class; not replaced by Modern.js)

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/rspack";

plugins: [
  new ModuleFederationPlugin(mfOptions),
  moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
];
```

**Rsbuild**

```ts
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@tonoizer/mfdoctor/rsbuild";

plugins: [
  pluginModuleFederation(mfOptions),
  pluginModuleFederationDoctor({ moduleFederation: mfOptions }),
];
```

**Webpack**

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/webpack";
import { ModuleFederationDoctorPlugin } from "@tonoizer/mfdoctor/webpack";

plugins: [
  new ModuleFederationPlugin(mfOptions),
  ModuleFederationDoctorPlugin({ moduleFederation: mfOptions }),
];
```

**Modern.js** (**partial** — adapter + Rspack-under-the-hood smoke; does not hide `/rspack`)

```ts
import { moduleFederationPlugin } from "@module-federation/modern-js";
import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/modern";

plugins: [
  appTools(),
  moduleFederationPlugin(),
  moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
];
```

CI is auto-detected from the environment (`CI`, `GITHUB_ACTIONS`, and other
common provider signals). In CI, MFDoctor fails on error findings and includes
SARIF by default — you do **not** need `mode: "ci"` in plugin config. Local
development defaults to `failOn: "never"` so findings print without breaking
the build. Override with `--ci`, `mode: "ci"`, `mode: "development"`, or
`failOn`.

Quiet success is the default: zero findings print nothing. Use `--verbose`,
`printLog: { success: true }`, `quiet: false`, or `MFDOCTOR_QUIET=0` for the
legacy "no findings" line. `MFDOCTOR_QUIET=1` forces quiet.

### Noisy finding? Mute intentionally

When a rule is known and accepted (for example a host that keeps direct
`remoteEntry` URLs), turn that rule off — do not disable MFDoctor:

```ts
federationDoctor({
  moduleFederation: mfOptions,
  rules: {
    // Intentional: no manifest server in this app yet.
    "config/remote-manifest-recommended": "off",
  },
});
```

See [Governance: suppressions and allowlists](./apps/docs/docs/suppressions.md)
for severity overrides, policy packs, fingerprint baselines, `failOn`, and the
canonical `examples/mixed-federation` host pattern. Full rule catalog:
[Rule reference](./apps/docs/docs/rules/index.md).

## CLI (complementary)

Use the CLI when you are not running a bundler build, or for cross-project and
deployed checks:

```bash
pnpm add -D @tonoizer/mfdoctor
pnpm mfdoctor check --ci
pnpm mfdoctor check --format terminal,json,sarif
pnpm mfdoctor check --baseline ./mfdoctor.baseline.json
pnpm mfdoctor check --verbose
pnpm mfdoctor workspace
pnpm mfdoctor federation --workspace
pnpm mfdoctor federation ".mf/doctor/**/project.json"
pnpm mfdoctor baseline generate .mf/doctor/report.json
pnpm mfdoctor runtime ./.mf/observability/latest.json
pnpm mfdoctor probe https://cdn.example.com/mf-manifest.json --remote-entry
pnpm mfdoctor rules config/name-required
```

Supported report formats are **terminal**, **JSON**, and **SARIF** only — there
is no HTML report or `--ui` dashboard. For a programmatic remotes/shared graph,
use `buildUiPayload` and `schemas/ui.schema.json` (see report schemas in the
docs).

| Command         | When to use it                                              |
| --------------- | ----------------------------------------------------------- |
| Plugin on build | Gate the real emit; strongest artifact evidence             |
| `check`         | Offline config analysis without a full bundler run          |
| `workspace`     | One-shot host↔remote gate; auto-discovers `project.json`    |
| `federation`    | Same gate with `--workspace` or manual globs (escape hatch) |
| `baseline`      | Generate/update fingerprint baselines for incremental CI    |
| `runtime`       | Correlate an Observability Plugin export with project facts |
| `probe`         | Inspect a deployed manifest / remoteEntry HEAD (network)    |

`check`, `workspace`, `federation`, and `runtime` stay offline. `probe` is the
only command that fetches over the network, and it never executes remote
JavaScript. Exit codes: `0` pass, `1` policy fail, `2` analysis incomplete.
Fingerprint baselines keep known debt visible in reports without failing policy
by default — see [baselines](./apps/docs/docs/baselines.md) and
[governance](./apps/docs/docs/suppressions.md).

`runtime` accepts one JSON Observability report, an array of reports, or a
`{"report": ...}` / `{"reports": [...]}` envelope. Current upstream
Observability 2.5.3 reports are supported, along with the legacy MFDoctor v1
shape (`success`, `init`, `factory`, and old diagnosis/module fields). Partial
reports are imported as partial evidence; missing fields never count as a
pass. Missing shared lifecycle data on partial/old/preview runtimes is marked
`sharedCompleteness: unknown`, not healthy. Unknown future shapes and build
reports fail with a typed error. The general evidence reader
(`readEvidenceDocument`) rejects Observability reports and points callers at
`parseRuntimeTraces` / `loadRuntimeTraceFile`.

Runtime imports are opt-in and local only. MFDoctor does not fetch, upload, open
a browser, or execute report contents. Stored/output evidence is bounded and
redacts credentials, secret query values, private paths, and stack traces.
Invalid opt-in `runtimeTrace` paths do not break offline `check`; they simply
omit runtime import hints.

## Policy packs and presets

Share org governance with built-in profiles (`recommended`, `strict`, `demo`,
`production`) and package-level policy packs via `extends`. `recommended`
matches the catalog defaults, `strict` raises most advisory severities for CI,
`demo` quiets selected local-demo nudges, and `production` raises selected
enable-this recommendations. Use `profile: "demo"` or `profile: "production"`
as a top-level shortcut when the overlay should follow `extends`; local
`rules` still win, and a demo profile resolves to the production overlay in CI.
Profiles only adjust recommendation severities and bounded rule options;
correctness findings stay on. Packs can ship severity maps plus custom
`defineRule` plugins. See [policy packs](./apps/docs/docs/policy-packs.md).

## What it checks

- Core config: names, exposes, remotes, scopes, runtime plugins, public paths.
- Shared modules: versions, singleton/eager use, providers, and tree shaking.
- Runtime modes: startup strategy, snapshots, external runtime, and recovery.
- Vite details: CSS bundling, parser timeouts, and Vite-only switches.
- Build output: manifests, remote entries, type archives, assets, and metadata.
- Whole federation: cross-project name, version, scope, and provider conflicts.

MF `runtimePlugins` in bundler config are checked at build time. **Runtime-only**
apps (`createInstance` / runtime plugins without a Vite/Rspack/Rsbuild/Webpack MF
**build** plugin) are out of scope for first-class support — use Observability +
`mfdoctor runtime` instead of shipping MFDoctor into the browser. See
[limitations](./apps/docs/docs/limitations.md) and
[#34](https://github.com/tonoizer/module-federation-doctor/issues/34).

Every built-in rule has an issue, impact, fix, category, and source link. See
the [rule reference](./apps/docs/docs/rules/index.md) and
[Get started](./apps/docs/docs/setup.md) for setup, CI, and the fix-until-exit-0
loop.

## Development

Requires Node `>=22.12.0` and pnpm 11 only. The workspace policy pins the
package manager to `pnpm@11.17.0`, delays new dependency releases by ten days,
and requires explicit approval for dependency build scripts. See the
[compatibility matrix](./apps/docs/docs/compatibility.md) for supported /
partial / unsupported cells (Vite, Rspack, Rsbuild, Webpack, Modern.js; npm / yarn
consumer notes; terminal / JSON / SARIF on CI).

```bash
npm install --global pnpm@11.17.0
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
pnpm release:dry-run
```

Examples:

- `examples/mixed-federation` — healthy Vite + Rspack + Rsbuild e2e path
- `examples/nested-federation` — nested Vite host → Vite/Rsbuild → Rspack/Webpack;
  run `pnpm demo:nested` or `pnpm test:nested`
- `examples/compatibility/webpack` — Webpack build+MFDoctor smoke for the matrix
- `examples/mixed-federation-issues` — same flat topology with intentional MFDoctor
  findings; run `pnpm demo:mixed-issues`
- `examples/standalone-findings` — per-bundler Vite/Webpack/Rspack/Rsbuild
  cells that emit visible MFDoctor findings; run `pnpm demo:standalone`
- `examples/showcase` — one-rule CLI fixtures + runtime green/fail demos; run
  `pnpm demo:showcase`
- From `examples/`: `pnpm --dir examples demo` runs showcase + standalone +
  mixed-issues + nested (or `pnpm demo:examples` from the repo root)
- See [Examples](./apps/docs/docs/examples.md) for the full catalog. The
  one-command full E2E gate is `pnpm test:e2e`; it builds the green,
  intentional-finding, nested, and compatibility cells, runs cross-app gates,
  and executes the green and negative Playwright runtime paths. `pnpm test:giga`
  remains as a compatibility alias for existing automation.

MFDoctor-specific agent UX prefers CLI/plugin finding output (rule id, fix,
MFDoctor docs URL, official MF sources, exit codes) plus an offline health score
footer (`Score: N/100`) and top-3 copy-paste agent prompts. Use `--no-score` /
`--no-prompt` to hide terminal footers; JSON reports still include
`summary.score`. Offline: `mfdoctor prompt --finding <id>` and
`--diagnostics-dir` for handoff dumps. For Module Federation concepts, use
`.agents/skills/mf`. Upstream evidence for rule work lives in
the [contribution guide](./CONTRIBUTING.md#research-sources).

## Contribution

New contributors are welcome. Please read the [Contributing Guide](./CONTRIBUTING.md).

## Inspiration

The initial idea was inspired by [Rsdoctor](https://rsdoctor.rs/):

> “Something like RS Doctor, but just for Module Federation.”

Getting something useful out of Module Federation can be tricky during initial
setup: the important details are spread across configuration, shared
dependencies, runtime behavior, manifests, and build output. The goal here was
to bring that kind of focused diagnostic experience to Module Federation.
Presets and targeted scans make the nitty-gritty visible early, without
requiring users to dive deeply into federation or bundler internals first.

That idea shaped MFDoctor into a diagnostics tool focused on
the configuration, sharing, runtime, manifest, and output problems unique to
Module Federation projects. Thanks to the Rsdoctor team for the inspiration.

## Code of Conduct

Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

MIT © 2026 tonoizer and contributors.
