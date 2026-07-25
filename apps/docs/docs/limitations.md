# Limitations

MVP supports Vite, direct Rspack, Rsbuild, and Webpack. Gaps below are tracked as
GitHub issues and milestones so each one can be removed from this page when it
ships.

Roadmap: [v1.0](https://github.com/tonoizer/module-federation-doctor/milestone/1)
· [post-v1](https://github.com/tonoizer/module-federation-doctor/milestone/2)
· epic [#30](https://github.com/tonoizer/module-federation-doctor/issues/30).

## v1.0 (governance-ready)

| Gap                                                | Issue                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Dynamic-import completeness beyond static analysis | [#14](https://github.com/tonoizer/module-federation-doctor/issues/14) (`MFDOCTOR-105`) |
| Compatibility matrix for v1 bundlers and runtimes  | [#15](https://github.com/tonoizer/module-federation-doctor/issues/15) (`MFDOCTOR-106`) |
| One-shot workspace federation gate for CI          | [#25](https://github.com/tonoizer/module-federation-doctor/issues/25) (`MFDOCTOR-109`) |
| Shareable policy packs and named presets           | [#26](https://github.com/tonoizer/module-federation-doctor/issues/26) (`MFDOCTOR-110`) |
| Fingerprint baselines and suppressions             | [#27](https://github.com/tonoizer/module-federation-doctor/issues/27) (`MFDOCTOR-111`) |

Static imports cannot see every runtime import until `MFDOCTOR-105` lands its
documented completeness bar (supported dynamic patterns + honest
`doctor/partial-analysis` — not a claim of 100% arbitrary runtime JS).

The Doctor plugin analyzes the **current** app (config + emit). Cross-app
host↔remote shared/integration issues need each app's `.mf/doctor/project.json`
plus `mfdoctor federation` (or the workspace gate in `MFDOCTOR-109`). Opt-in
`mfdoctor probe` inspects a deployed manifest.

Opt-in browser runtime trace import is available through `mfdoctor runtime` when
you supply an Observability Plugin export. Default `check` and `federation`
analysis stay offline.

Doctor does not ship an HTML dashboard today. Use terminal, JSON, and SARIF
reports. Restoring a richer HTML analysis UI is tracked in
[#13](https://github.com/tonoizer/module-federation-doctor/issues/13).

## post-v1

| Gap                                              | Issue                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Rolldown and Vite Plus lifecycle coverage        | [#11](https://github.com/tonoizer/module-federation-doctor/issues/11) (`MFDOCTOR-102`) |
| Modern.js adapter (without hiding direct Rspack) | [#12](https://github.com/tonoizer/module-federation-doctor/issues/12) (`MFDOCTOR-103`) |

## What Doctor covers

| Path                                                                                 | Covered?                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| Bundler MF plugin + Doctor adapter + shared `mfOptions` (including `runtimePlugins`) | Yes — primary                                 |
| CLI `check` with explicit `moduleFederation` / `module-federation.config`            | Partial (config/imports; weaker without emit) |
| On-disk / deployed `mf-manifest.json` (`check` discover / `probe`)                   | Producer/deploy evidence only                 |
| `mfdoctor runtime` + Observability export                                            | Opt-in live correlation, offline              |

MF `runtimePlugins` declared in bundler MF config **are** first-class: Doctor
reads them from the shared `mfOptions` object at build time. That is not the
same as analyzing a runtime-only host.

## Permanent guarantees / non-goals

Doctor does not rely on undocumented private Module Federation plugin fields.
That is a stability guarantee and permanent non-goal, not removable follow-up
work. See [#18](https://github.com/tonoizer/module-federation-doctor/issues/18).

Adapters and rules use **public Module Federation options**, emitted
**manifests**, **stats**, and **recorded capabilities** only. They must not
scrape private plugin instance state, undocumented internals, or other
non-public compiler/plugin fields. Missing optional public input yields
`doctor/partial-analysis` instead of reaching into private MF plugin state.

Adapter authors: see
[architecture notes](./contributing.md#architecture-notes).

Doctor is **build/CI-only**. Install it as a `devDependency`. Adapters run after
emit in Node and must not appear in the client bundle
([#32](https://github.com/tonoizer/module-federation-doctor/issues/32),
`MFDOCTOR-115`). An in-browser Doctor runtime agent is **not planned**
([#33](https://github.com/tonoizer/module-federation-doctor/issues/33),
`MFDOCTOR-116`).

**Runtime-only** Module Federation apps — `@module-federation/runtime` /
`createInstance` / runtime plugins **without** a Vite, Rspack, Rsbuild, or
Webpack Module Federation **build** plugin — are **out of scope** for
first-class support
([#34](https://github.com/tonoizer/module-federation-doctor/issues/34),
`MFDOCTOR-117`).

Without a bundler MF plugin there is usually no Doctor post-emit hook, no
reliable emit/manifest from that app, and Doctor does not parse
`createInstance(...)` from source. Manifest and `probe` coverage apply to
**producer artifacts** that emit `mf-manifest.json`, not to “we inferred the
whole runtime-only host.”

Do **not** ship Doctor into the browser to close that gap. Prefer Observability
exports + `mfdoctor runtime`, or add a bundler MF plugin + Doctor adapter. See
[setup](./setup.md).
