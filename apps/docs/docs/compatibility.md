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

| Bundler              | Status                    | Adapter entry                       | CI evidence                                                | Notes                                                                 |
| -------------------- | ------------------------- | ----------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Vite                 | **supported**             | `@module-federation/doctor/vite`    | `compatibility` workflow → `host-vite` build + Doctor      | Primary host path in `examples/mixed-federation`                      |
| Rspack               | **supported**             | `@module-federation/doctor/rspack`  | `compatibility` workflow → `remote-rspack` build + Doctor  | Direct `@module-federation/enhanced/rspack`                           |
| Rsbuild              | **supported**             | `@module-federation/doctor/rsbuild` | `compatibility` workflow → `remote-rsbuild` build + Doctor | `@module-federation/rsbuild-plugin`                                   |
| Webpack              | **supported**             | `@module-federation/doctor/webpack` | `compatibility` workflow → `webpack-smoke` build + Doctor  | `@module-federation/enhanced/webpack` (#10 shipped)                   |
| Rolldown / Vite Plus | **unsupported** (post-v1) | —                                   | —                                                          | [#11](https://github.com/tonoizer/module-federation-doctor/issues/11) |
| Modern.js            | **unsupported** (post-v1) | —                                   | —                                                          | [#12](https://github.com/tonoizer/module-federation-doctor/issues/12) |

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

| Manager                | Status        | Notes                                                                                                                                                                                                            |
| ---------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pnpm** (primary)     | **supported** | `packageManager: "pnpm@11.17.0"`; CI uses `pnpm install --frozen-lockfile`; workspace filters for examples                                                                                                       |
| npm                    | **partial**   | Published package installs with `npm i -D @module-federation/doctor`; CLI via `npx mfdoctor`. This monorepo’s lockfile and filters are pnpm-only — do not expect `npm install` at the repo root to reproduce CI. |
| yarn (classic / Berry) | **partial**   | Same published-package install/CLI story as npm. Yarn workspaces are not the repo’s CI path; use pnpm for contributing and matrix jobs.                                                                          |

Where paths differ: contributors and CI always use **pnpm**. Consumers of the
published tarball may use npm or yarn to install Doctor into their own app; the
CLI binary name remains `mfdoctor`.

## Report surfaces

| Surface  | Local default        | CI / `--ci` / `mode: "ci"` | Artifact                   |
| -------- | -------------------- | -------------------------- | -------------------------- |
| terminal | yes                  | yes                        | stdout / bundler logs      |
| JSON     | yes (`report.json`)  | yes                        | `.mf/doctor/report.json`   |
| SARIF    | off unless requested | yes                        | `.mf/doctor/results.sarif` |

CI auto-detect (`CI`, `GITHUB_ACTIONS`, …) enables `failOn: "error"` and
terminal + JSON + SARIF without setting `mode: "ci"` in plugin config. The
`compatibility` workflow asserts all three surfaces after each supported
bundler build.

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
3. post-v1 adapters (Rolldown, Modern.js) — out of scope for v1 close.

## CI map

| Workflow                      | What it proves                                                  |
| ----------------------------- | --------------------------------------------------------------- |
| `compatibility.yml`           | Per-bundler build+Doctor on Node 22 + 24; report surfaces       |
| `doctor.yml`                  | Full mixed-federation build + federation analyze + SARIF upload |
| `integration.yml` / `e2e.yml` | Adapter tests and Playwright mixed-federation path              |
| `package.yml`                 | Pack/consume smoke on Node 22 + 24 (includes Webpack)           |
| `quality.yml`                 | fmt, lint, types, unit tests, `docs:build`                      |
