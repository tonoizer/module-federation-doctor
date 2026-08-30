<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tonoizer/module-federation-doctor/main/assets/mfdoctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tonoizer/module-federation-doctor/main/assets/mfdoctor-readme-logo-light.svg">
  <img alt="MFDoctor" src="https://raw.githubusercontent.com/tonoizer/module-federation-doctor/main/assets/mfdoctor-readme-logo-light.svg" width="180" height="40">
</picture>

[![version](https://img.shields.io/npm/v/%40tonoizer%2Fmfdoctor?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@tonoizer/mfdoctor)
[![downloads](https://img.shields.io/npm/dt/%40tonoizer%2Fmfdoctor.svg?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@tonoizer/mfdoctor)
[![documentation](https://img.shields.io/badge/docs-mfdoctor.kevinbeier.com-000000?style=flat)](https://mfdoctor.kevinbeier.com)

`@tonoizer/mfdoctor` finds config, sharing, runtime, manifest, and output
problems in Module Federation projects. **Supported** bundlers (first-class
adapter + real build+MFDoctor CI gate): Vite, Rspack, Rsbuild, and Webpack.
**Partial** (adapter present, limited rules/fixtures, not a full CI gate):
Modern.js, Nuxt 3/4, and Rolldown-integrated Vite / Vite Plus. Machine-readable
status:
[`fixtures/compatibility-matrix.json`](https://github.com/tonoizer/module-federation-doctor/blob/main/fixtures/compatibility-matrix.json);
human matrix:
[compatibility](https://mfdoctor.kevinbeier.com/compatibility).

Install as a **devDependency**. MFDoctor is **build/CI-only**: adapters run after
emit in Node and are not part of the browser bundle. They add CI time, not
runtime size or performance cost. The build plugin is the primary integration;
the CLI complements it for config, workspace, runtime, and deployed checks.

**Agents:** follow the [two-tier loop](https://mfdoctor.kevinbeier.com/agent-loop).
`mfdoctor check` is config/static only — **do not claim green from check alone**.
After fixes, require plugin emit (build with a MFDoctor adapter) and, in
monorepos, `mfdoctor workspace`. Treat exit `2` and
[`doctor/partial-analysis`](https://mfdoctor.kevinbeier.com/rules/doctor/partial-analysis)
as incomplete, not a pass. Read findings (or JSON/diagnostics), open the linked
rule docs, apply the fix (or an intentional
[governance](https://mfdoctor.kevinbeier.com/suppressions) mute when asked), and
rebuild until policy exits **0**. Quiet success prints nothing.

## Primary DX: build plugin

Register MFDoctor next to your Module Federation plugin. It runs **after emit**,
prints **all** findings once at the end of the build (severity, rule, message,
fix, docs links), then fails when policy says so — only after every finding is
collected. Clean builds stay quiet by default.

### Bundler matrix

| Bundler                    | Status        | Notes                                                                  |
| -------------------------- | ------------- | ---------------------------------------------------------------------- |
| Vite / Vite 5 CommonJS     | **supported** | Primary CI cells in `fixtures/compatibility-matrix.json`               |
| Rspack / Rsbuild / Webpack | **supported** | First-class adapters; production build+MFDoctor gates                  |
| Rolldown / Vite Plus       | **partial**   | Same `@tonoizer/mfdoctor/vite` entry; no dedicated Rolldown CI smoke   |
| Modern.js                  | **partial**   | Adapter + Rspack-under-the-hood smoke; not full `@modern-js/app-tools` |
| Nuxt 3/4                   | **partial**   | Adapter + unit contract; upstream app build baseline-blocked           |

**Partial** means an adapter exists and some coverage is present, but rule depth,
fixtures, and CI evidence are not on par with the supported cells — a green
`mfdoctor check` / plugin emit on a partial stack is not as trustworthy as on
Vite / Rspack / Rsbuild / Webpack. See the matrix fixture and
[compatibility](https://mfdoctor.kevinbeier.com/compatibility) for the live rows.

**Vite** (**supported**; Rolldown-integrated Vite and Vite Plus are **partial** — same entry)

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";

plugins: [federation(mfOptions), federationDoctor({ moduleFederation: mfOptions })];
```

**Nuxt 3/4** (**partial** — public `vite:extendConfig` adapter; limited CI evidence)

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

**Rspack** (**supported** — direct `@rspack/core`; not replaced by Modern.js)

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/rspack";

plugins: [
  new ModuleFederationPlugin(mfOptions),
  moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
];
```

**Rsbuild** (**supported**)

```ts
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@tonoizer/mfdoctor/rsbuild";

plugins: [
  pluginModuleFederation(mfOptions),
  pluginModuleFederationDoctor({ moduleFederation: mfOptions }),
];
```

**Webpack** (**supported**)

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

See [Governance: suppressions and allowlists](https://mfdoctor.kevinbeier.com/suppressions)
for severity overrides, policy packs, fingerprint baselines, `failOn`, and the
canonical `examples/mixed-federation` host pattern. Full rule catalog:
[Rule reference](https://mfdoctor.kevinbeier.com/rules/).

## CLI (complementary)

Use the CLI when you are not running a bundler build, or for cross-project and
deployed checks.

**Name clash:** `npx mf-doctor` is a different package (tiagocastro070), not this
project. This package is `@tonoizer/mfdoctor` (CLI binary `mfdoctor`). Install as
a dependency and run via package-manager exec (`pnpm exec mfdoctor`,
`npx mfdoctor`, etc.) — not `npx mf-doctor`.

```bash
pnpm add -D @tonoizer/mfdoctor
pnpm exec mfdoctor check --ci
pnpm exec mfdoctor check --format terminal,json,sarif
pnpm exec mfdoctor check --baseline ./mfdoctor.baseline.json
pnpm exec mfdoctor check --verbose
pnpm exec mfdoctor workspace
pnpm exec mfdoctor federation --workspace
pnpm exec mfdoctor federation ".mf/doctor/**/project.json"
pnpm exec mfdoctor baseline generate .mf/doctor/report.json
pnpm exec mfdoctor runtime ./.mf/observability/latest.json
pnpm exec mfdoctor probe https://cdn.example.com/mf-manifest.json --remote-entry
pnpm exec mfdoctor rules config/name-required
```

For a coding-agent or other non-interactive handoff, discover the supported
contract first, then keep machine-readable artifacts and prompts on disk:

```bash
pnpm exec mfdoctor capabilities
pnpm exec mfdoctor check --ci --format terminal,json,sarif \
  --diagnostics-dir .mf/doctor/diagnostics
pnpm exec mfdoctor prompt --finding config/name-required .mf/doctor/report.json
```

The published package ships the same playbook as [`AGENTS.md`](./AGENTS.md) and
the Cursor/agent skill at [`skills/mfdoctor/SKILL.md`](./skills/mfdoctor/SKILL.md)
(capabilities → check JSON → prompt → rebuild). Hard rules: no suppressions and
no `probe` unless the user asked; do not claim green from `check` alone.

`capabilities` is versioned JSON and does not load project configuration or use
the network. A check exits `0` when policy passes, `1` when policy fails, and
`2` when analysis is incomplete. The diagnostics directory contains bounded
`report.json`, `summary.md`, and `prompts/*.md` (default top-3 prompts; pass
`--diagnostics-prompts <n>` up to 25, or set `MFDOCTOR_DIAGNOSTICS_PROMPTS`, to
dump more). JSON and SARIF remain stable machine-readable contracts, so agents
do not need to scrape terminal output.

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
by default — see [baselines](https://mfdoctor.kevinbeier.com/baselines) and
[governance](https://mfdoctor.kevinbeier.com/suppressions).

## Consumer CI (no Vite Plus)

Host teams do not need this repository's Vite Plus / `setup-vp` toolchain.
Install `@tonoizer/mfdoctor`, register a bundler adapter, build, then gate:

```bash
pnpm add -D @tonoizer/mfdoctor
# register @tonoizer/mfdoctor/{vite,webpack,rspack,rsbuild} next to your MF plugin
pnpm run build
pnpm exec mfdoctor workspace --format terminal,json,sarif
```

Copy-paste GitHub Actions (Node + pnpm/npm/yarn + the workspace-federation-gate
Action): [CLI / GitHub Actions](https://mfdoctor.kevinbeier.com/cli#github-actions)
and [`examples/ci/github-actions-mfdoctor.yml`](./examples/ci/github-actions-mfdoctor.yml).

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
`defineRule` plugins. See [policy packs](https://mfdoctor.kevinbeier.com/policy-packs).

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
[limitations](https://mfdoctor.kevinbeier.com/limitations) and
[#34](https://github.com/tonoizer/module-federation-doctor/issues/34).

Every built-in rule has an issue, impact, fix, category, and source link. See
the [rule reference](https://mfdoctor.kevinbeier.com/rules/) and
[Get started](https://mfdoctor.kevinbeier.com/setup) for setup, CI, and the fix-until-exit-0
loop.

## Development

Requires Node `>=22.12.0`. [Vite+](https://viteplus.dev/guide/) manages the
repository's Node.js, package manager, build, test, lint, and format toolchain. The
workspace policy pins pnpm to `11.17.0`, delays new dependency releases by ten days,
and requires explicit approval for dependency build scripts. See the
[compatibility matrix](https://mfdoctor.kevinbeier.com/compatibility) and
[`fixtures/compatibility-matrix.json`](https://github.com/tonoizer/module-federation-doctor/blob/main/fixtures/compatibility-matrix.json)
for supported / partial / unsupported cells (Vite, Rspack, Rsbuild, Webpack
**supported**; Modern.js, Nuxt, Rolldown / Vite Plus **partial**; npm / yarn
consumer notes; terminal / JSON / SARIF on CI).

```bash
vp install
vp pack
vp exec playwright install chromium
vp run check
vp run release:dry-run
```

Examples:

- `examples/mixed-federation` — healthy Vite + Rspack + Rsbuild e2e path
- `examples/nested-federation` — nested Vite host → Vite/Rsbuild → Rspack/Webpack;
  run `vp run demo:nested` or `vp run test:nested`
- `examples/compatibility/webpack` — Webpack build+MFDoctor smoke for the matrix
- `examples/mixed-federation-issues` — same flat topology with intentional MFDoctor
  findings; run `vp run demo:mixed-issues`
- `examples/standalone-findings` — per-bundler Vite/Webpack/Rspack/Rsbuild
  cells that emit visible MFDoctor findings; run `vp run demo:standalone`
- `examples/showcase` — one-rule CLI fixtures + runtime green/fail demos; run
  `vp run demo:showcase`
- `examples/ci/github-actions-mfdoctor.yml` — copy-paste consumer CI (no Vite Plus /
  `setup-vp`); see [CLI / GitHub Actions](https://mfdoctor.kevinbeier.com/cli#github-actions)
- From `examples/`: `vp run demo` runs showcase + standalone + mixed-issues +
  nested (or `vp run demo:examples` from the repo root)
- See [Examples](https://mfdoctor.kevinbeier.com/examples) for the full catalog. The
  one-command full E2E gate is `vp run test:e2e`; it builds the green,
  intentional-finding, nested, and compatibility cells, runs cross-app gates,
  and executes the green and negative Playwright runtime paths. `vp run test:giga`
  remains as a compatibility alias for existing automation.

MFDoctor-specific agent UX prefers CLI/plugin finding output (rule id, fix,
MFDoctor docs URL, official MF sources, exit codes) plus an offline health score
footer (`Score: N/100`) and top-3 copy-paste agent prompts on local runs. CI
hides prompts by default (opt in with `--prompt`, or dump via
`--diagnostics-dir`). Use `--no-score` / `--no-prompt` to hide terminal footers;
JSON reports still include `summary.score`. Offline: `mfdoctor prompt --finding
<id>` and `--diagnostics-dir` for handoff dumps. After install, agents should read
[`AGENTS.md`](./AGENTS.md) or `skills/mfdoctor/SKILL.md` from the package. For
Module Federation concepts, use the upstream `mf` skill (this repository vendors
it under `.agents/skills/mf` for maintainers). Upstream evidence for rule work
lives in the
[contribution guide](https://github.com/tonoizer/module-federation-doctor/blob/main/CONTRIBUTING.md#research-sources).

## Contribution

New contributors are welcome. Please read the [Contributing Guide](https://github.com/tonoizer/module-federation-doctor/blob/main/CONTRIBUTING.md).

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

Please follow the [Code of Conduct](https://github.com/tonoizer/module-federation-doctor/blob/main/CODE_OF_CONDUCT.md).

MIT © 2026 Kevin Beier and contributors.
