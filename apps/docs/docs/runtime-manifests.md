# Runtime, manifests, and snapshots

## What each artifact does

Three different “stats/manifest” ideas show up in Module Federation builds.
Do not treat them as interchangeable:

| Artifact                           | What it is                                                      | Who emits it                                                   |
| ---------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `mf-manifest.json`                 | Stable runtime view (remotes, shared, remote entry, type hints) | MF plugins — see matrix below                                  |
| `mf-stats.json`                    | Build-focused MF stats distilled into the manifest              | Same MF plugins as the manifest                                |
| Webpack/Rspack compilation `stats` | Bundler graph / asset graph from the compiler                   | Webpack / Rspack / Rsbuild / Modern — **not** Vite or Rolldown |

`mf-stats.json` is build-focused. It carries detailed assets, exposes, remotes,
shared packages, used exports, plugin/build versions, remote entry metadata,
and type metadata.

`mf-manifest.json` is the stable runtime view distilled from those stats.
Consumers can use it for dynamic type hints, preloading, and DevTools data.

The exact upstream shapes live in
[manifest types](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types/manifest.ts)
and
[stats types](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types/stats.ts).

MFDoctor records:

- container id and name,
- public path,
- plugin and build versions,
- remote entry name/path/type,
- type archive/API metadata,
- expose asset lists,
- shared versions and asset lists,
- remote alias/entry/version/scope metadata.

It then compares these values with config, installed packages, and emitted
assets. This catches stale output that a config-only linter cannot see.

## Per-bundler expectations

MFDoctor’s `capabilities.manifest` / `capabilities.stats` flags mean “on-disk
`mf-manifest.json` / `mf-stats.json` were collected,” not “webpack compilation
stats exist.” Emit defaults differ by MF plugin family:

| Bundler                         | `mf-manifest.json` / `mf-stats.json`                                              | Webpack-style compilation stats          | What MFDoctor expects                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Vite** / Rolldown / Vite Plus | Opt-in: set `manifest: true` on `@module-federation/vite`. Omitted ⇒ **no** emit. | **Not applicable** — missing is expected | With `manifest: true`, both MF artifacts; without them, honest `doctor/partial-analysis` (not “pass MF options”) |
| **Webpack** (Enhanced)          | Default emit when `manifest !== false`                                            | Available via compilation hooks          | Manifest/stats capabilities when emit lands; omit/`undefined` is **enabled**, not disabled                       |
| **Rspack** (Enhanced)           | Same as Webpack (`manifest !== false`)                                            | Available via compilation hooks          | Same Enhanced defaults                                                                                           |
| **Rsbuild**                     | Same Enhanced default via `@module-federation/rsbuild-plugin`                     | Via underlying Rspack when available     | Same Enhanced defaults                                                                                           |
| **Modern.js**                   | Same Enhanced default under the hood                                              | Via Rspack/Webpack `afterEmit`           | Adapter OK; core Modern demos may be blocked upstream (see soak notes)                                           |

**Explicit:** absence of webpack compilation `stats.json` on Vite / Rolldown /
Vite Plus is **expected**. Do not treat it as a MFDoctor or adapter failure.

Related fixes (closed):

- [#116](https://github.com/tonoizer/module-federation-doctor/issues/116) —
  Vite `doctor/partial-analysis` must suggest `manifest: true`, not “pass MF
  options,” when config is present and only artifacts are missing.
- [#119](https://github.com/tonoizer/module-federation-doctor/issues/119) —
  Enhanced omitted `manifest` is default-on; do not fire
  `artifact/manifest-disabled` when emit (or `capabilities.manifest`) proves
  otherwise.
- [#125](https://github.com/tonoizer/module-federation-doctor/issues/125) —
  Vite/Nuxt-shaped manifests (empty `remoteEntry.path`, `publicPath: "./"`)
  are normal; artifact rules must not false-positive.

## Soak conclusions (adapters vs upstream)

From the 2026-08-01 bundler soak (reconstructions; `SOAK_REPORT.md` is not
vendored in-tree):

- **Adapters are healthy** across Vite, Webpack, Rspack, and Rsbuild when MF
  emits the artifacts MFDoctor can read. Failures that looked like “missing
  manifest/stats” were usually Vite opt-in gaps or Enhanced default-emit
  normalization — addressed in #116 / #119 / #125.
- **Modern.js core demos** (`modern-ssr-*`, `modern-data-fetch-*`) failed
  **before** MFDoctor ran in the 2026-08-01 soak because
  `@module-federation/bridge-react/size-limited-cache` was missing on the soaked
  core branch (upstream packaging / dist drift). The package export was added
  by [Core PR #4897](https://github.com/module-federation/core/pull/4897) and is
  present in `@module-federation/bridge-react@2.8.2`, but the corresponding
  core-demo re-soak remains unverified. It was **not** a MFDoctor Modern adapter
  crash. In-repo
  [`examples/compatibility/modern`](https://github.com/tonoizer/module-federation-doctor/tree/main/examples/compatibility/modern)
  smoke stays green; a full `@modern-js/app-tools` core-demo re-soak is still
  external evidence and is not covered by this partial cell. Track the final
  verification in [#130](https://github.com/tonoizer/module-federation-doctor/issues/130).

## Quiet soak / demo config

For local demos and soak hosts, prefer manifest remotes, Vite
`manifest: true`, and either `loaded-first` or a retry / `errorLoadRemote`
recovery plugin so offline remotes do not drown the report:

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";

const mfOptions = {
  name: "host_demo",
  // Required on Vite — Enhanced family emits by default when manifest !== false.
  manifest: true,
  // Prefer delayed failure over version-first hard startup when remotes may be offline.
  shareStrategy: "loaded-first",
  remotes: {
    // Prefer mf-manifest.json URLs when a manifest server is available.
    app1: "app1@http://127.0.0.1:3001/mf-manifest.json",
  },
  // Or: runtimePlugins: [require.resolve("@module-federation/retry-plugin")],
  shared: {
    react: { singleton: true },
    "react-dom": { singleton: true },
  },
};

export default {
  plugins: [federation(mfOptions), federationDoctor({ moduleFederation: mfOptions })],
};
```

See also
[`reliability/version-first-offline-remotes`](./rules/reliability/version-first-offline-remotes.md)
and the [Vite integration](./vite-integration.md) notes.

## Report capabilities block

After a build or `mfdoctor check`, inspect what MFDoctor actually collected:

```bash
jq '.capabilities' .mf/doctor/report.json
# or per-project:
jq '.capabilities' .mf/doctor/project.json
```

Typical keys: `config`, `sourceImports`, `manifest`, `stats`, `emittedAssets`,
`installedVersions`. A Vite host with MF options but without `manifest: true`
often shows `config: true` with `manifest: false` / `stats: false` — that is
artifact opt-in, not missing config. The high-level
[capability matrix](./capabilities.md) summarizes depth per bundler; this page
is the detailed emit contract.

## Deployed probe

When network access is explicitly wanted, compare the build view with a live
manifest:

```bash
mfdoctor probe https://cdn.example.com/mf-manifest.json --remote-entry
```

The probe downloads only the bounded JSON manifest. `--remote-entry` adds a
`HEAD` request for the entry. It reports status and headers but does not
download or execute the remote JavaScript. This is useful for stale-CDN,
wrong-public-path, missing-entry, and bad-content-type checks. It cannot prove
that container initialization or an exposed factory works; use runtime
observability for those stages.

## Snapshot flow

At runtime, a manifest is converted into module snapshot data. The snapshot
contains the resolved remote entry, public path, remote type URLs, dependent
remotes, shared assets, and optional secondary tree-shaken shared artifacts.
The runtime caches manifest fetches and emits `RUNTIME-013` when required
manifest fields are missing.

See the upstream
[snapshot types](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types/snapshot.ts)
and
[snapshot loader](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/runtime-core/src/plugins/snapshot/SnapshotHandler.ts).

## Observability

MFDoctor's default analysis is static and offline. For a live failure, use the
official
[Observability Plugin](https://module-federation.io/plugin/plugins/observability-plugin).
It can identify whether a failure occurred during manifest, remote entry,
container init, expose lookup, factory execution, or shared resolution.

Do not guess from a generic network error:

1. keep the stable `RUNTIME-xxx` code;
2. capture the failed URL/status and original browser exception;
3. export an observability report when available;
4. correlate that export with MFDoctor build facts:

```bash
mfdoctor check --format json
mfdoctor runtime ./.mf/observability/latest.json ".mf/doctor/**/project.json"
```

`mfdoctor runtime` imports the user-supplied report, redacts secrets and full
private URLs, and emits `runtime/*` findings that join remotes, shared packages,
and init phases with `.mf/doctor/project.json` evidence. It does not fetch live
remotes or execute remote JavaScript.

This separates a bad deployment URL from valid JavaScript that downloaded and
then failed during execution.
