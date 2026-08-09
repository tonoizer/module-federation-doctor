# Compatibility matrix

Documented and CI-exercised support for every bundler and runtime Doctor claims
in v1. Status labels are tied to analysis capabilities and real build+Doctor
paths — not fixture-only confidence.

Related: [capabilities](./capabilities.md) ·
[limitations](./limitations.md) ·
[#15](https://github.com/tonoizer/module-federation-doctor/issues/15)
(`MFDOCTOR-106`).

## Status labels

| Status          | Meaning                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------- |
| **supported**   | First-class adapter + real bundler build writes Doctor facts; exercised in CI                   |
| **partial**     | Usable with honest gaps — emits `doctor/partial-analysis` (or weaker evidence) instead of lying |
| **unsupported** | Out of v1 scope (post-v1 or permanent non-goal)                                                 |

## Bundlers

| Bundler              | Status        | Adapter entry                       | CI evidence                                                | Notes                                                                                                                                                                                                                                                |
| -------------------- | ------------- | ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite                 | **supported** | `@module-federation/doctor/vite`    | `compatibility` workflow → `host-vite` build + Doctor      | Primary host path in `examples/mixed-federation`                                                                                                                                                                                                     |
| Vite 5 + CommonJS    | **supported** | `@module-federation/doctor/vite`    | `compatibility` workflow → `vite-cjs-v5` build + Doctor    | Async ESM bridge for the Vite MF plugin; validates Doctor's published CommonJS adapter                                                                                                                                                               |
| Rolldown / Vite Plus | **partial**   | `@module-federation/doctor/vite`    | unit lifecycle hooks + honest `doctor/partial-analysis`    | Same Vite entry; usable with gaps until a real Rolldown/Vite Plus smoke build lands in CI (#11)                                                                                                                                                      |
| Rspack               | **supported** | `@module-federation/doctor/rspack`  | `compatibility` workflow → `remote-rspack` build + Doctor  | Direct `@module-federation/enhanced/rspack` (first-class)                                                                                                                                                                                            |
| Rsbuild              | **supported** | `@module-federation/doctor/rsbuild` | `compatibility` workflow → `remote-rsbuild` build + Doctor | `@module-federation/rsbuild-plugin`                                                                                                                                                                                                                  |
| Webpack              | **supported** | `@module-federation/doctor/webpack` | `compatibility` workflow → `webpack-smoke` build + Doctor  | `@module-federation/enhanced/webpack` (#10 shipped)                                                                                                                                                                                                  |
| Modern.js            | **partial**   | `@module-federation/doctor/modern`  | `compatibility` workflow → `modern-smoke` (Rspack stub)    | Adapter API + Rspack-under-the-hood smoke; the package export is fixed in [#4897](https://github.com/module-federation/core/pull/4897), but the core-demo unblock remains unverified and this is not full `@modern-js/app-tools` evidence yet (#130) |

## Variant coverage

The machine-readable contract lives in
[`fixtures/compatibility-matrix.json`](https://github.com/tonoizer/module-federation-doctor/blob/main/fixtures/compatibility-matrix.json).
It distinguishes reproducible local CI cells from unit contracts and pinned
upstream validation records:

| Surface                                     | Current evidence                                                                     | Matrix status    |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| Vite current ESM + Vite 5 CommonJS          | Production build + project/report/SARIF assertions on Node 22 and 24                 | CI               |
| Rspack, Rsbuild, Webpack, Modern.js adapter | Production build + Doctor report assertions                                          | CI               |
| Svelte and SvelteKit SSR                    | Pinned upstream app reports plus SvelteKit SSR-entry regression test                 | validated        |
| Angular                                     | Pinned upstream validation; the example's existing package baseline blocks the build | baseline-blocked |
| Nuxt 3/4                                    | Adapter contract and pinned upstream validation record                               | baseline-blocked |

The upstream rows are evidence records, not release claims: CI uses pinned
local fixtures so a moving external repository cannot silently change the
release gate. Refresh the pinned ref and rerun the external validation before
changing a row's status.

Nuxt 3 / Nuxt 4 use the first-class adapter `@module-federation/doctor/nuxt`.
It hooks the public `vite:extendConfig` API and is covered by the adapter
contract test plus pinned Nuxt provenance in the Giga Smoke gate. A full Nuxt
application build remains dependent on the upstream package-resolution issue
tracked in [nuxt/nuxt#36009](https://github.com/nuxt/nuxt/issues/36009).

Runtime-only Module Federation (no bundler MF **build** plugin) is
**unsupported** as a first-class path — see
[limitations](./limitations.md#permanent-guarantees--non-goals) and
[#34](https://github.com/tonoizer/module-federation-doctor/issues/34).

## Analysis depth (partial honesty)

| Path                                                                | Status      | Behavior when incomplete                                                       |
| ------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| Bundler MF plugin + Doctor adapter + shared `mfOptions`             | supported   | Full post-emit facts; CI defaults to terminal + JSON + SARIF                   |
| CLI `check` with explicit MF config, no emit                        | partial     | Config/imports only; weaker without artifacts                                  |
| Unresolved dynamic `import(expr)` / non-literal `loadRemote` / etc. | partial     | Records `imports.unresolvedDynamic`; prefers `doctor/partial-analysis`         |
| Opt-in Observability `runtimeTrace` / `mfdoctor runtime`            | supported\* | Offline correlation when a valid export is supplied; invalid/missing → partial |
| On-disk / deployed `mf-manifest.json` (`check` discover / `probe`)  | partial     | Producer/deploy evidence only                                                  |

\*Runtime traces are opt-in and never fetch remote URLs or execute remote JS.

Partial cells must not silently skip gaps. Prefer
[`doctor/partial-analysis`](./rules/doctor/partial-analysis.md) over false
certainty (`shared/unused`, invented remotes, scraped private plugin fields).

## Node.js

| Cell                     | Status          | Exact versions                                                                |
| ------------------------ | --------------- | ----------------------------------------------------------------------------- |
| `package.json` `engines` | **supported**   | `node: ">=22.12.0"`                                                           |
| CI engines floor         | **supported**   | Node **22** (latest 22.x ≥ 22.12.0) via `.github/workflows/compatibility.yml` |
| CI current line          | **supported**   | Node **24** (same workflow + quality/integration/e2e defaults)                |
| Node \< 22.12.0          | **unsupported** | Outside `engines`; not tested                                                 |

## Package managers

| Manager                | Status        | Notes                                                                                                                                                                                                                        |
| ---------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pnpm** (primary)     | **supported** | pnpm 11 only (`packageManager: "pnpm@11.17.0"`; `engines.pnpm: ">=11.0.0 <12.0.0"`); CI uses `pnpm install --frozen-lockfile`; workspace filters for examples; ten-day release-age and explicit build approvals are enforced |
| npm                    | **partial**   | Published package installs with `npm i -D @module-federation/doctor`; CLI via `npx mfdoctor`. This monorepo’s lockfile and filters are pnpm-only — do not expect `npm install` at the repo root to reproduce CI.             |
| yarn (classic / Berry) | **partial**   | Same published-package install/CLI story as npm. Yarn workspaces are not the repo’s CI path; use pnpm for contributing and matrix jobs.                                                                                      |

Where paths differ: contributors and CI always use **pnpm**. Consumers of the
published tarball may use npm or yarn to install Doctor into their own app; the
CLI binary name remains `mfdoctor`.

## Report surfaces

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

## Failure policy (release blockers)

Reds that **block** a release claim for supported cells:

1. Vite, Rspack, Rsbuild, or Webpack real build + Doctor path fails on Node 22
   or 24 in the `compatibility` workflow.
2. Missing Doctor artifacts after a green bundler build (`project.json`,
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

## CI map

| Workflow                      | What it proves                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `compatibility.yml`           | Per-bundler build+Doctor on Node 22 + 24; report surfaces                                      |
| `doctor.yml`                  | Mixed + nested federation builds + workspace gates + SARIF upload                              |
| `integration.yml` / `e2e.yml` | Adapter tests and Playwright mixed-federation path                                             |
| `package.yml`                 | Pack/consume smoke on Node 22 + 24 (includes Webpack)                                          |
| `quality.yml`                 | fmt, lint, types, unit tests, `docs:build`                                                     |
| `giga-smoke.yml`              | Pinned local green/red/nested/compatibility builds + cross-app gate + Playwright runtime smoke |

## mf-toolkit shapes

Doctor soft-recognizes intentional **mf-toolkit** config shapes so agents do not
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
