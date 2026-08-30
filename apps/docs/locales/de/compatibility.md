<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Compatibility matrix

Documented and CI-exercised support for every bundler and runtime MFDoctor claims
in v1. Status labels are tied to analysis capabilities and real build+MFDoctor
paths — not fixture-only confidence.

Related: [capabilities](./capabilities.md) ·
[limitations](./limitations.md) ·
[#15](https://github.com/tonoizer/module-federation-doctor/issues/15)
(`MFDOCTOR-106`).

## Statusbezeichnungen

| Status          | Meaning                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------- |
| **supported**   | First-class adapter + real bundler build writes MFDoctor facts; exercised in CI                 |
| **partial**     | Usable with honest gaps — emits `doctor/partial-analysis` (or weaker evidence) instead of lying |
| **unsupported** | Out of v1 scope (post-v1 or permanent non-goal)                                                 |

## Bundler

| Bundler              | Status        | Adapter entry                | CI evidence                                                  | Notes                                                                                                                                                                                                                                                |
| -------------------- | ------------- | ---------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite                 | **supported** | `@tonoizer/mfdoctor/vite`    | `compatibility` workflow → `host-vite` build + MFDoctor      | Primary host path in `examples/mixed-federation`                                                                                                                                                                                                     |
| Vite 5 + CommonJS    | **supported** | `@tonoizer/mfdoctor/vite`    | `compatibility` workflow → `vite-cjs-v5` build + MFDoctor    | Async ESM bridge for the Vite MF plugin; validates MFDoctor's published CommonJS adapter                                                                                                                                                             |
| Rolldown / Vite Plus | **partial**   | `@tonoizer/mfdoctor/vite`    | unit lifecycle hooks + honest `doctor/partial-analysis`      | Same Vite entry; usable with gaps until a real Rolldown/Vite Plus smoke build lands in CI (#11)                                                                                                                                                      |
| Rspack               | **supported** | `@tonoizer/mfdoctor/rspack`  | `compatibility` workflow → `remote-rspack` build + MFDoctor  | Direct `@module-federation/enhanced/rspack` (first-class)                                                                                                                                                                                            |
| Rsbuild              | **supported** | `@tonoizer/mfdoctor/rsbuild` | `compatibility` workflow → `remote-rsbuild` build + MFDoctor | `@module-federation/rsbuild-plugin`                                                                                                                                                                                                                  |
| Webpack              | **supported** | `@tonoizer/mfdoctor/webpack` | `compatibility` workflow → `webpack-smoke` build + MFDoctor  | `@module-federation/enhanced/webpack` (#10 shipped)                                                                                                                                                                                                  |
| Modern.js            | **partial**   | `@tonoizer/mfdoctor/modern`  | `compatibility` workflow → `modern-smoke` (Rspack stub)      | Adapter API + Rspack-under-the-hood smoke; the package export is fixed in [#4897](https://github.com/module-federation/core/pull/4897), but the core-demo unblock remains unverified and this is not full `@modern-js/app-tools` evidence yet (#130) |
| Nuxt 3/4             | **partial**   | `@tonoizer/mfdoctor/nuxt`    | adapter unit contract + pinned upstream record               | Public `vite:extendConfig` adapter; full Nuxt app build remains baseline-blocked upstream ([nuxt/nuxt#36009](https://github.com/nuxt/nuxt/issues/36009))                                                                                             |

## Variantenabdeckung

The machine-readable contract lives in
[`fixtures/compatibility-matrix.json`](https://github.com/tonoizer/module-federation-doctor/blob/main/fixtures/compatibility-matrix.json).
It distinguishes reproducible local CI cells from unit contracts and pinned
upstream validation records:

| Surface                                     | Current evidence                                                                     | Matrix status    |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| Vite current ESM + Vite 5 CommonJS          | Production build + project/report/SARIF assertions on Node 22, 24, and 26            | CI               |
| Rspack, Rsbuild, Webpack, Modern.js adapter | Production build + MFDoctor report assertions                                        | CI               |
| Svelte and SvelteKit SSR                    | Pinned upstream app reports plus SvelteKit SSR-entry regression test                 | validated        |
| Angular                                     | Pinned upstream validation; the example's existing package baseline blocks the build | baseline-blocked |
| Nuxt 3/4                                    | Adapter contract and pinned upstream validation record                               | baseline-blocked |

The upstream rows are evidence records, not release claims: CI uses pinned
local fixtures so a moving external repository cannot silently change the
release gate. Refresh the pinned ref and rerun the external validation before
changing a row's status.

Nuxt 3 / Nuxt 4 use the **partial** adapter `@tonoizer/mfdoctor/nuxt`.
It hooks the public `vite:extendConfig` API and is covered by the adapter
contract test plus pinned Nuxt provenance in the full E2E gate. A full Nuxt
application build remains dependent on the upstream package-resolution issue
tracked in [nuxt/nuxt#36009](https://github.com/nuxt/nuxt/issues/36009) — so Nuxt
is not a first-class **supported** CI gate.

Runtime-only Module Federation (no bundler MF **build** plugin) is
**unsupported** as a first-class path — see
[limitations](./limitations.md#permanent-guarantees--non-goals) and
[#34](https://github.com/tonoizer/module-federation-doctor/issues/34).

## Analysetiefe (ehrliche Teilergebnisse)

| Path                                                                | Status      | Behavior when incomplete                                                       |
| ------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| Bundler MF plugin + MFDoctor adapter + shared `mfOptions`           | supported   | Full post-emit facts; CI defaults to terminal + JSON + SARIF                   |
| CLI `check` with explicit MF config, no emit                        | partial     | Config/imports only; weaker without artifacts                                  |
| Unresolved dynamic `import(expr)` / non-literal `loadRemote` / etc. | partial     | Records `imports.unresolvedDynamic`; prefers `doctor/partial-analysis`         |
| Opt-in Observability `runtimeTrace` / `mfdoctor runtime`            | supported\* | Offline correlation when a valid export is supplied; invalid/missing → partial |
| On-disk / deployed `mf-manifest.json` (`check` discover / `probe`)  | partial     | Producer/deploy evidence only                                                  |

\*Runtime traces are opt-in and never fetch remote URLs or execute remote JS.

Partial cells must not silently skip gaps. Prefer
[`doctor/partial-analysis`](./rules/doctor/partial-analysis.md) over false
certainty (`shared/unused`, invented remotes, scraped private plugin fields).

## Laufzeit-Capture-Kompatibilität

Laufzeit-Capture ist eine separate, optionale Node-/Offline-Grenze. Der
eingecheckte Vertrag unter
[`fixtures/runtime-capture-compatibility.json`](https://github.com/tonoizer/module-federation-doctor/blob/main/fixtures/runtime-capture-compatibility.json)
und `scripts/verify-runtime-capture-compatibility.mjs` prüft nach jedem
Package-Build den öffentlichen Einstiegspunkt `@tonoizer/mfdoctor/capture`:

| Oberfläche                               | Status        | Nachweis                             | Kompatibilitätsgarantie                                                                       |
| ---------------------------------------- | ------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Aktueller Observability-Export           | **supported** | `current-2.5.3.json`                 | Begrenzt Reports/Events und bewahrt den Quellenstatus.                                        |
| Legacy-Observability-Export              | **supported** | `healthy.json`                       | Bewahrt Legacy-Parsing; fehlende Felder bleiben unbekannt.                                    |
| Teilweiser/sensibler Export              | **supported** | `remote-load-failed.json`            | Zugangsdaten/Secrets werden vor der Ausgabe redigiert; rohe Fehler-Interna bleiben außen vor. |
| Offizieller DevTools-Export              | **supported** | `partial-devtools.json`              | Quellen-Metadaten bleiben teilweise und werten fehlende Report-Fakten nicht auf.              |
| Node/SSR-JSON-Export                     | **supported** | Node-Wrapper um `current-2.5.3.json` | Verwendet den Transport `node-file` und einen eigenen SSR-Realm.                              |
| Preview-Runtime / deaktivierter Snapshot | **supported** | Fallback-Vertragsfälle               | Preview-Versionen inferieren keinen Shared-Lifecycle; `disableSnapshot` ist `not-applicable`. |
| Browser-Frame-/Worker-Realm              | **supported** | Browser-Connector-Vertragsfälle      | Navigation, Realm und Quellenbereich bleiben isoliert und freigegeben.                        |

Der Standard-Einstieg `@tonoizer/mfdoctor` und die Bundler-Adapter stellen keine
Capture-Funktionen bereit. Capture ist nur über den expliziten Subpath
`@tonoizer/mfdoctor/capture` verfügbar; ein automatischer Browser-Agent gehört
nicht zum Paket.

## Node.js

| Cell                     | Status          | Exact versions                                                                |
| ------------------------ | --------------- | ----------------------------------------------------------------------------- |
| `package.json` `engines` | **supported**   | `node: ">=22.12.0"`                                                           |
| CI engines floor         | **supported**   | Node **22** (latest 22.x ≥ 22.12.0) via `.github/workflows/compatibility.yml` |
| CI current line          | **supported**   | Node **24** (same workflow + quality/integration/e2e defaults)                |
| Node \< 22.12.0          | **unsupported** | Outside `engines`; not tested                                                 |

## Paketmanager

| Manager                | Status        | Notes                                                                                                                                                                                                                                    |
| ---------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pnpm** (primary)     | **supported** | Vite+ delegates to pnpm 11 (`packageManager: "pnpm@11.17.0"`; `engines.pnpm: ">=11.0.0 <12.0.0"`); CI uses `vp install --frozen-lockfile`; workspace filters for examples; ten-day release-age and explicit build approvals are enforced |
| npm                    | **partial**   | Published package installs with `npm i -D @tonoizer/mfdoctor`; CLI via `npx mfdoctor`. This monorepo’s lockfile and filters are pnpm-only — do not expect `npm install` at the repo root to reproduce CI.                                |
| yarn (classic / Berry) | **partial**   | Same published-package install/CLI story as npm. Yarn workspaces are not the repo’s CI path; use pnpm for contributing and matrix jobs.                                                                                                  |

Where paths differ: contributors and CI always use **pnpm**. Consumers of the
published tarball may use npm or yarn to install MFDoctor into their own app; the
CLI binary name remains `mfdoctor`.

## Report-Oberflächen

| Surface  | Local default        | CI / `--ci` / `mode: "ci"` | Artifact                   |
| -------- | -------------------- | -------------------------- | -------------------------- |
| terminal | yes (quiet on clean) | yes (quiet on clean)       | stdout when findings exist |
| JSON     | yes (`report.json`)  | yes                        | `.mf/doctor/report.json`   |
| SARIF    | off unless requested | yes                        | `.mf/doctor/results.sarif` |

CI auto-detect (`CI`, `GITHUB_ACTIONS`, …) enables `failOn: "error"` and
terminal + JSON + SARIF without setting `mode: "ci"` in plugin config. The
`compatibility` workflow asserts report artifacts after each supported bundler
build. Terminal success lines stay off unless `--verbose` /
`printLog.success` / `MFDOCTOR_QUIET=0` is set.

```bash
pnpm mfdoctor check --format terminal,json,sarif
```

## Fehlerpolitik (Release-Blocker)

Reds that **block** a release claim for supported cells:

1. Vite, Rspack, Rsbuild, or Webpack real build + MFDoctor path fails on Node 22
   or 24 in the `compatibility` workflow.
2. Missing MFDoctor artifacts after a green bundler build (`project.json`,
   `report.json`, or `results.sarif` on the CI path).
3. Quality / package / integration / e2e gates that already guard the adapters.

Reds that **do not** block other cells:

1. npm/yarn consumer-path differences — documented partial; monorepo CI stays
   pnpm.
2. Expected `doctor/partial-analysis` warnings on partial analysis paths —
   honest gaps, not matrix failures.
3. Rolldown / Vite Plus — documented **partial** (unit lifecycle coverage only;
   no release claim until a real smoke build is in `compatibility.yml`).
4. Modern.js — documented **partial** (adapter API + Rspack-under-the-hood
   smoke; no full **supported** claim until a real `@modern-js/app-tools`
   build is in `compatibility.yml`).
5. Nuxt 3/4 — documented **partial** (adapter + unit contract; upstream app
   build remains baseline-blocked; not a **supported** release gate).

## CI-Übersicht

| Workflow                      | What it proves                                                          |
| ----------------------------- | ----------------------------------------------------------------------- |
| `compatibility.yml`           | Per-bundler build+MFDoctor on Node 22, 24 + 26; report surfaces         |
| `doctor.yml`                  | Mixed + nested federation builds + workspace gates + SARIF upload       |
| `integration.yml` / `e2e.yml` | Adapter tests plus the full matrix and Playwright mixed-federation path |
| `package.yml`                 | Pack/consume smoke on Node 22, 24 + 26 (includes Webpack)               |
| `quality.yml`                 | fmt, lint, types, unit tests, `docs:build`                              |

## mf-toolkit shapes

MFDoctor soft-recognizes intentional **mf-toolkit** config shapes so agents do not
get false broken-remote / component-DTS guidance:

| Shape                           | Signal                                                                                                | Soft-exception                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **mf-bridge**                   | expose `./entry` → `entry.*` module (toolkit `register` / `createMFEntry` / `defineMFEntry` contract) | Skip component-style DTS producer guidance (`artifact/dts-disabled`, `artifact/types-missing`, `artifact/types-metadata-missing`) |
| **mf-ssr**                      | fragment URL/path remotes (`/api/fragments/...`, not `remoteEntry.js`)                                | Skip `config/remote-entry-invalid` for those entries                                                                              |
| **shared-inspector** (optional) | MF2 shared-array on manifest-only evidence                                                            | Skip `shared/unused` certainty; prefer `doctor/partial-analysis`                                                                  |

Recognition defaults **on when these signals are present**. Disable with
`recognizeMfToolkit: false` in `mfdoctor.config` / adapter options, or turn the
specific rule `"off"` / use a fingerprint baseline. Soft-exceptions **skip**
findings rather than changing evidence shapes (fingerprint-stable for classic apps).

In-repo fixtures (no toolkit checkout): `fixtures/mf-bridge-entry`,
`fixtures/mf-ssr-fragment`, `fixtures/shared-inspector-mf2`. Full Bridge pack
coverage is [#131](https://github.com/tonoizer/module-federation-doctor/issues/131),
not this compatibility note.
