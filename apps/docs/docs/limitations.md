# Limitations

MVP supports Vite (including Rolldown-integrated Vite and Vite Plus as a
**partial** matrix cell — lifecycle coverage without a dedicated CI smoke
build yet), direct Rspack, Rsbuild, Webpack, and Modern.js as a **partial**
matrix cell — adapter API plus an Rspack-under-the-hood smoke (not a full
`@modern-js/app-tools` build yet). Gaps below are tracked as GitHub issues and
milestones so each one can be removed from this page when it ships.

Roadmap: [v1.0](https://github.com/tonoizer/module-federation-doctor/milestone/1)
· [post-v1](https://github.com/tonoizer/module-federation-doctor/milestone/2)
· epic [#30](https://github.com/tonoizer/module-federation-doctor/issues/30).

## v1.0 (governance-ready)

The v1 [compatibility matrix](./compatibility.md) for Vite / Rolldown /
Vite Plus / Rspack / Rsbuild / Webpack / Modern.js (partial), Node engines,
package managers, and report surfaces has shipped
([#15](https://github.com/tonoizer/module-federation-doctor/issues/15),
`MFDOCTOR-106`).

Dynamic Module Federation import patterns are covered at the documented
[completeness bar](./capabilities.md#dynamic-import-completeness-v1): supported
literals and runtime/manifest hints when evidence exists, with honest
`doctor/partial-analysis` for unresolved dynamics — not a claim of 100%
arbitrary runtime JS
([#14](https://github.com/tonoizer/module-federation-doctor/issues/14),
`MFDOCTOR-105`).

The MFDoctor plugin analyzes the **current** app (config + emit). Cross-app
host↔remote shared/integration issues need each app's `.mf/doctor/project.json`
plus the one-shot workspace gate (`mfdoctor workspace` /
`mfdoctor federation --workspace`) or manual `mfdoctor federation` globs
([#25](https://github.com/tonoizer/module-federation-doctor/issues/25),
`MFDOCTOR-109`). Opt-in `mfdoctor probe` inspects a deployed manifest.

Opt-in browser runtime trace import is available through `mfdoctor runtime` when
you supply an Observability Plugin export. Default `check` and `federation`
analysis stay offline. When `runtimeTrace` is set on MFDoctor options, `check`
also merges shared/remote hints from that export into import facts without
fetching URLs or executing remote JavaScript.

MFDoctor does not ship an HTML dashboard or `--ui` server. Use terminal, JSON, and
SARIF reports. `buildUiPayload` / `schemas/ui.schema.json` remain as a
programmatic federation graph contract for custom tooling — see
[report schemas](./report-schemas.md). An HTML analysis UI
([#13](https://github.com/tonoizer/module-federation-doctor/issues/13)) was
closed as not planned.

## post-v1

No open post-v1 adapter gaps right now. Rolldown / Vite Plus (#11) and Modern.js
(#12) shipped as **partial** matrix cells — see
[compatibility](./compatibility.md).

## What MFDoctor covers

| Path                                                                                   | Covered?                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Bundler MF plugin + MFDoctor adapter + shared `mfOptions` (including `runtimePlugins`) | Yes — primary                                 |
| CLI `check` with explicit `moduleFederation` / `module-federation.config`              | Partial (config/imports; weaker without emit) |
| On-disk / deployed `mf-manifest.json` (`check` discover / `probe`)                     | Producer/deploy evidence only                 |
| `mfdoctor runtime` + Observability export                                              | Opt-in live correlation, offline              |

MF `runtimePlugins` declared in bundler MF config **are** first-class: MFDoctor
reads them from the shared `mfOptions` object at build time. That is not the
same as analyzing a runtime-only host.

## Permanent guarantees / non-goals

MFDoctor does not rely on undocumented private Module Federation plugin fields.
That is a stability guarantee and permanent non-goal, not removable follow-up
work. See [#18](https://github.com/tonoizer/module-federation-doctor/issues/18).

Adapters and rules use **public Module Federation options**, emitted
**manifests**, **stats**, and **recorded capabilities** only. They must not
scrape private plugin instance state, undocumented internals, or other
non-public compiler/plugin fields. Missing optional public input yields
`doctor/partial-analysis` instead of reaching into private MF plugin state.

Adapter authors should use public Module Federation options and emitted build
artifacts. Contribution guidance lives in the repository
[contribution guide](https://github.com/tonoizer/module-federation-doctor/blob/main/CONTRIBUTING.md#adapter-contract).

### Topology / production governance evidence notes (MFDOCTOR-123)

These rules are implemented; a few need compiler-observed facts that CLI-only
`check` cannot invent:

| Rule                                       | Evidence                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/duplicate-plugin-registration`     | Webpack/Rspack adapters count MF plugins via public `.name` (`ModuleFederationPlugin`, `RspackModuleFederationPlugin`) or `constructor.name` when `.name` is missing |
| `artifact/public-path-non-string-manifest` | Webpack/Rspack adapters classify `output.publicPath`; Vite/Rsbuild do not surface this today                                                                         |
| Remaining topology rules                   | Config / `project.json` / remotes graph (`mfdoctor federation`)                                                                                                      |

MFDoctor does **not** scrape private Module Federation plugin fields for these
checks — only public plugin `name` / `constructor.name` and public bundler
`output.publicPath`. Vite/Rsbuild have no plugin-count or `publicPath` surface
today (intentional deferral).

MFDoctor is **build/CI-only**. Install it as a `devDependency`. Adapters run after
emit in Node and must not appear in the client bundle
([#32](https://github.com/tonoizer/module-federation-doctor/issues/32),
`MFDOCTOR-115`). An in-browser MFDoctor runtime agent is **not planned**
([#33](https://github.com/tonoizer/module-federation-doctor/issues/33),
`MFDOCTOR-116`). MFDoctor stays plugin-primary, with a complementary CLI, and is
never injected as an in-browser agent.

**Runtime-only** Module Federation apps — `@module-federation/runtime` /
`createInstance` / runtime plugins **without** a Vite, Rspack, Rsbuild,
Webpack, or Modern.js Module Federation **build** plugin — are **out of scope**
for first-class support
([#34](https://github.com/tonoizer/module-federation-doctor/issues/34),
`MFDOCTOR-117`).

Without a bundler MF plugin there is usually no MFDoctor post-emit hook, no
reliable emit/manifest from that app, and MFDoctor does not parse
`createInstance(...)` from source. Manifest and `probe` coverage apply to
**producer artifacts** that emit `mf-manifest.json`, not to “we inferred the
whole runtime-only host.”

MFDoctor analysis and the terminal findings showcase run **only post-emit /
after-build** (`writeBundle` / `closeBundle` / `afterEmit` / `onAfterBuild` /
Modern.js `modifyBundlerChain` → `afterEmit`). Adapters never register
`transform` / `load` / client-injection hooks
([#54](https://github.com/tonoizer/module-federation-doctor/issues/54)).

Do **not** ship MFDoctor into the browser to close that gap. Prefer Observability
exports + `mfdoctor runtime`, or add a bundler MF plugin + MFDoctor adapter. See
[Observability latest.json → mfdoctor runtime](./observability-runtime.md) and
[setup](./setup.md).

## Shared-usage governance (non-goals)

MFDoctor closes high-value `shared` config gaps inspired by
`@mf-toolkit/shared-inspector` (deep-import bypass, local-graph import depth,
federation host gaps / ghost shares, expandable singleton/candidate lists via
policy packs). MFDoctor does **not** duplicate RS Doctor duplicate-package
treemaps, chunk graphs, or general bundle-size visualization — use RS Doctor or
a bundler analyzer for those questions.
