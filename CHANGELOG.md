# @tonoizer/mfdoctor

## 1.0.0-rc.0

### Major Changes

- b9e2fa4: Publish the first independently maintained MFDoctor v1 package,
  with staged OIDC releases and public GitHub Pages rule documentation.

### Minor Changes

- b187624: Add copyable agent fix prompts (top-3 terminal handoff, `mfdoctor prompt`,
  and root-contained `--diagnostics-dir` dumps).
- 2ddabab: Add `performance/asset-budget` with overrideable remote entry, shared, and expose size defaults.
- 5a54b5b: Add production diagnostics for Module Federation config, runtime modes,
  manifests, shared modules, and Vite-specific behavior. Add cross-project checks,
  terminal/JSON/SARIF reports, a guarded deployed-manifest probe, richer docs, and
  full Vite, Rspack, and Rsbuild integration coverage.
- d582448: Add a public canonical Module Federation config boundary that preserves collection order, fallback arrays, tuples, false values, extensions, and opaque dynamic values without applying adapter defaults.
- f8c22e6: Add public version-aware capability-pack definitions and queries for the Module Federation core contract.
- ed0a859: Add explicit `demo` and `production` policy overlays for selected recommendation
  nudges. Existing defaults and correctness severities stay unchanged.
- c19b199: Complete v1 dynamic-import analysis: resolve string-literal `import()` /
  `loadRemote` / `loadShare*` / `registerRemotes` patterns, merge opt-in runtime
  trace and manifest remote hints into import facts, prefer
  `doctor/partial-analysis` over false `shared/unused` certainty, and document the
  supported completeness bar.
- 4a69d30: Add the pinned Enhanced Webpack browser capability pack for the reviewed Module Federation core contract.
- b1b7d17: Add the public evidence-aware rule contract, typed evaluation outcomes,
  confidence helpers, and the built-in rule migration inventory.
- 7da740e: Add the smallest evidence-aware rule runner bridge with immutable evidence views, honest unknown/not-applicable states, stable evaluation IDs, and engine-error isolation.
- 8ef3d13: Add deterministic, redacted v1 parity comparison and drift-ledger validation helpers for evidence v2 rollout work.
- e8f5b49: Add the public Evidence Protocol v2 types, schema, deterministic ID helpers,
  redaction rules, and four-outcome evaluation vocabulary. Existing v1 output
  formats remain unchanged.
- 482c44c: Add the internal scoped evidence v2 rollout controller. It defaults to the legacy v1 path, requires all release gates for `v2-compat`, and supports an emergency legacy rollback switch.
- 2b46c52: Keep all discovered manifest and stats files as deterministic artifact records, while preserving the legacy first-artifact compatibility view. MFDoctor options can provide custom artifact names to bound discovery.
- fda3e88: Add fingerprint baselines and suppressions for incremental CI adoption
  (`mfdoctor baseline` generate/update/prune, `DoctorOptions.baseline`,
  suppressed findings in reports without failing policy by default).
- 92a17fd: Record exact Vite-family output assets and bounded artifact evidence from public build hooks.

  Uses an adapter-agnostic build-output seam so later collectors can reuse the same
  normalization path, and recovers Rolldown empty writeBundle cases with a bounded
  output-root scan marked partial.

- e4cdba0: Add the first-class Nuxt 3/4 adapter at `@tonoizer/mfdoctor/nuxt`,
  correct false-positive handling for framework and post-build evidence, and add
  the pinned green/red/nested compatibility matrix with Playwright smoke coverage
  for continuous integration.
- f256b7c: Add offline federation health score (`summary.score` / `scoreLabel`) with
  terminal footer and `--no-score` opt-out.
- 90d14e4: Add opt-in semantic identity types, deterministic identity keys, explicit unknown nodes, and a published identity schema for the v2 correlation contract.
- 0c68db4: Add top-level `demo` / `production` profile resolution plus bounded
  Observability and React prefix-share enablement recommendations. The default
  recommendations remain non-blocking for CI `failOn: "error"`.
- c74ec32: Add a Modern.js-oriented adapter (`@tonoizer/mfdoctor/modern`) that
  composes the same post-emit analysis as the public Rspack/Webpack adapters via
  `modifyBundlerChain`, with docs that keep direct Rspack and Rsbuild first-class.
  Matrix status is **partial** until a real `@modern-js/app-tools` CI smoke lands.
  The Modern.js entry exposes the `moduleFederationDoctorPlugin` factory.
- cd1f35d: Model multiple Module Federation plugin instances as stable, independently analyzed federation scopes across compiler diagnostics, emitted artifacts, build records, workspace findings, and UI graphs. Identical duplicate registrations remain actionable.
- ee9db71: Make the bundler plugins the primary MFDoctor DX with ecosystem-named exports
  (`federationDoctor`, `moduleFederationDoctorPlugin`,
  `pluginModuleFederationDoctor`), collect every finding before failing the
  build, drop the HTML UI, and auto-detect CI mode from common provider env vars
  so plugin configs do not need `mode: "ci"` by default.
- 667d7f1: Add shareable policy packs and built-in `recommended` / `strict` presets via `extends`.
- b06463c: Add the public, pure `readEvidenceDocument` reader plus v1 project/report to v2 evidence graph migration helpers. This is an additive API foundation; CLI output and command paths remain v1.
- a281bbd: Import bounded, validated runtime-capture files through the existing offline runtime analysis path.
- 27637a5: Add the public, pure `readEvidenceDocument` reader plus v1 project/report to v2 evidence graph migration helpers. This is an additive API foundation; CLI output and command paths remain v1.
- 50cdbbf: Extend the Vite adapter for Rolldown and Vite Plus emit lifecycles: detect
  flavor/engine with strong signals only, prefer on-disk assets with
  `closeBundle` fallback, and record honest `doctor/partial-analysis` when emit
  facts are missing. Matrix status stays **partial** until a real smoke build
  lands in CI.
- 8638ec9: Add opt-in `mfdoctor runtime` to import Observability Plugin browser traces,
  redact secrets and private URLs, and correlate remotes, shared packages, and
  init failures with offline project facts.
- 85c2487: Add the versioned, bounded external runtime-capture contract and schema. This is
  the offline handoff boundary for future Observability, DevTools, and safe
  fallback adapters; it does not capture pages or change existing commands.
- e2e669d: Add explicit federation groups for workspace analysis and a `--group` CLI
  scope, so independent fixtures and deliberately separate graphs do not have to
  share federation-wide comparisons. Improve workspace documentation and add a
  machine-readable compatibility matrix for local production cells and pinned
  upstream validation.

  Reduce noisy diagnostics by emitting one actionable manifest warning for
  disabled Vite manifests, making Vite server-origin and manual-chunk guidance
  advisory by default, and deduplicating overlapping shared assets in performance
  budget findings.

- e60f5d1: Bound discovered artifact parsing with the new `analysisBudgets.maxArtifacts`
  option and report partial analysis when the limit is reached.
- 06da119: Add topology and production governance rules for nested remotes, DTS, manifests, and shareStrategy alignment (MFDOCTOR-123).
- a943fa5: Add a public Webpack adapter (`@tonoizer/mfdoctor/webpack`) with the same
  plugin options shape as Vite, Rspack, and Rsbuild, including emit-hook capability
  recording and docs/setup coverage.
- 52d18eb: Add a one-shot workspace federation gate (`mfdoctor workspace` /
  `mfdoctor federation --workspace`) with auto-discovery of
  `.mf/doctor/project.json`, clear 0/1/2 exit codes, fixture coverage, and a
  reusable GitHub Action for CI.

### Patch Changes

- 959eb55: Bound independent source, artifact, asset-size, and workspace validation reads
  with deterministic reduction order, and add an opt-in bounded process-local
  parsed-input cache plus a legacy/shadow/v2-compat analysis benchmark matrix.
- ff32bc0: Bound imported project evidence analysis to eight concurrent workers while preserving deterministic results and existing errors.
- 499d796: Bound source and workspace analysis with deterministic budgets and explicit
  partial or unknown results when collection limits are reached.
- f1aed3e: Adopt the MFDoctor product identity and expose `moduleFederationDoctor` as the canonical Nuxt module name while preserving the prerelease aliases.
- 29f3829: Keep Rsbuild parent and child compiler stats as separate deterministic build records while preserving legacy emitted-asset views.
- fa5f83a: Document and CI-exercise the v1 compatibility matrix (Vite / Rspack / Rsbuild /
  Webpack supported; Node 22+24; pnpm primary; terminal / JSON / SARIF on the CI
  path).
- 836efa3: Bound imported evidence processing before copying, normalization, and hashing
  with shared analysis node and raw UTF-8 serialized-byte budgets. Throw a typed
  reader error with a budget report on overflow, preserve partial/unknown
  semantics in the rule runner, report all exceeded limits, and make optional
  legacy projections atomic without silently truncating v1 output.
- 06667f2: Correct federation topology and DTS findings: valid loaded-first cycles are allowed, federation rule settings are honored, and default remote type inference no longer produces false warnings.
- 90983e7: Normalize current Module Federation Observability runtime reports while keeping legacy v1 trace imports readable.
- ea5cf20: Reduce false-positive noise from soft heuristic rules: default
  `shared/candidate` and `config/implementation-suspicious` to `info`, keep them
  advisory under `strict`, document the suppress path, and add showcase fixtures
  for intentional `"off"` mutes plus unresolved-dynamic `doctor/partial-analysis`
  instead of confident `shared/unused`.
- 7a4a726: Avoid reporting Vite Module Federation's internal `manualChunks` hook as a
  user-authored chunking conflict.
- 0681d84: Close the V1 evidence-aware built-in migration inventory with machine-checked fixtures, author documentation, and recorded release-gate evidence for issue #232.
- 9ea54b8: Improve manifest and DTS enablement guidance when Module Federation config
  explicitly disables those producer capabilities, including profile and
  suppression behavior.
- 3f6f1d2: Use stable workspace application identities, detect stale or conflicting project
  facts, and resolve installed dependency versions through each app's real Node
  package lookup context.
- ed8d6d7: Avoid recommending Module Federation Observability for unconstrained dependency ranges such as `x` and `workspace:x`, prerelease-only ranges, or unsupported exact prerelease versions.
- 9f3cb48: Make the `demo` policy pack hide only local development noise from bare remote
  entries and version-first offline-remotes while keeping external and CI
  findings visible.
- 53665ee: Support Nitro's split Vite output by pairing the generated client assets in `.output/public` with the server build and by recognizing complete Nitro output-root scans as exact artifact evidence.
- 208793e: Record public Webpack and Rspack compiler, compilation, output, mode, target, and hash evidence in lossless per-build records.
- 233229b: Route offline report and baseline imports through the validated evidence reader while keeping the existing v1 report projection and command behavior.
- 9af8a8f: Rename the Webpack adapter export to `ModuleFederationDoctorPlugin` so it
  matches `ModuleFederationPlugin` naming. Keep `moduleFederationDoctorPlugin` as
  a deprecated alias.

## Unreleased

### Added

- Optional versioned finding `detailsSchema` + `details` payloads for first-batch
  rule families (`shared/*`, `config/remote-*`, `artifact/*`,
  `doctor/partial-analysis`). Fingerprints/baselines/SARIF stay stable — schema
  version is never written into `evidence`.

## 0.1.0

Initial production foundation with Vite, Rspack, and Rsbuild adapters; local and
federation-wide diagnostics; stable terminal, JSON, and SARIF reports; published
JSON Schemas (including the programmatic federation graph payload); guarded
manifest probes; mixed federation proof; and release validation.
