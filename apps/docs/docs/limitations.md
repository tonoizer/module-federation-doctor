# Limitations

MVP supports Vite, direct Rspack, and Rsbuild. The gaps below are tracked as
GitHub issues so each one can be removed from this page when it ships.

## Follow-up work

| Gap                                                          | Issue                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Webpack adapter and compatibility matrix                     | [#10](https://github.com/tonoizer/module-federation-doctor/issues/10) (`MFDOCTOR-101`) |
| Rolldown and Vite Plus lifecycle coverage                    | [#11](https://github.com/tonoizer/module-federation-doctor/issues/11) (`MFDOCTOR-102`) |
| Modern.js adapter (without hiding direct Rspack)             | [#12](https://github.com/tonoizer/module-federation-doctor/issues/12) (`MFDOCTOR-103`) |
| HTML analysis UI beyond the portable report                  | [#13](https://github.com/tonoizer/module-federation-doctor/issues/13) (`MFDOCTOR-104`) |
| Runtime / dynamic imports beyond static analysis             | [#14](https://github.com/tonoizer/module-federation-doctor/issues/14) (`MFDOCTOR-105`) |
| Broader Node, bundler, framework, and package-manager matrix | [#15](https://github.com/tonoizer/module-federation-doctor/issues/15) (`MFDOCTOR-106`) |

Opt-in browser runtime trace import is available through `mfdoctor runtime` when
you supply an Observability Plugin export. Default `check` and `federation`
analysis stay offline.

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

## Out of scope: runtime-only Module Federation

**Runtime-only** apps — `@module-federation/runtime` / `createInstance` / runtime
plugins **without** a Vite, Rspack, Rsbuild (or future Webpack) Module
Federation **build** plugin — are **not** first-class Doctor targets
([#34](https://github.com/tonoizer/module-federation-doctor/issues/34),
`MFDOCTOR-117`).

Without a bundler MF plugin there is usually no Doctor post-emit hook, no
reliable emit/manifest from that app, and Doctor does not parse
`createInstance(...)` from source. Manifest and `probe` coverage apply to
**producer artifacts** that emit `mf-manifest.json`, not to “we inferred the
whole runtime-only host.”

Do **not** ship Doctor into the browser to close that gap. An in-browser Doctor
runtime agent is **not planned**
([#33](https://github.com/tonoizer/module-federation-doctor/issues/33),
`MFDOCTOR-116`). Prefer Observability exports + `mfdoctor runtime`, or add a
bundler MF plugin + Doctor adapter. Doctor stays build/CI-only
([#32](https://github.com/tonoizer/module-federation-doctor/issues/32),
`MFDOCTOR-115`).

See [setup](./setup.md) for the supported adapter path.

## Permanent guarantee

Doctor does not rely on undocumented private Module Federation plugin fields.
That is a stability non-goal, not removable follow-up work. See
[#18](https://github.com/tonoizer/module-federation-doctor/issues/18).
