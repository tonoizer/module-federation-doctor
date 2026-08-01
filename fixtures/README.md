# Fixtures

- `adapters`: clean, warning, and error policy inputs for Vite, Rspack, Rsbuild,
  Webpack, and Modern.js.
- `diagnostics`: rule, redaction, ordering, and failure cases.
- `diagnostics/runtime-plugins`: local runtime plugin contract samples (invalid factory/name, createScript CORS asymmetry, valid parity).
- `dynamic-imports`: supported and unresolved dynamic MF import patterns (MFDOCTOR-105).
- `manifests`: valid and malformed Module Federation artifacts.
- `mf-bridge-entry`: in-repo mf-toolkit **mf-bridge** shapes — remote `./entry`
  exporting `register` / `createMFEntry` / `defineMFEntry` stubs; host lazy
  `register={() => import('remote/entry')}` plus golden `.mf/doctor/project.json`
  trees (#145 → unlocks #127).
- `mf-ssr-fragment`: in-repo mf-toolkit **mf-ssr** fragment URL remotes (not
  classic `remoteEntry.js`) with golden project facts (#145 → unlocks #127).
- `policy-packs`: shareable Doctor policy pack example (`@acme/mfdoctor-policy`).
- `runtime-traces`: Observability-style exports for `mfdoctor runtime` correlation.
- `shared-inspector-mf2`: minimal MF2 shared-array / inherited-shared evidence
  JSON shaped like `@mf-toolkit/shared-inspector` stress fixtures (#145).
- `workspaces`: portable multi-app `.mf/doctor/project.json` trees for the
  workspace federation gate (`clean` exit 0, `conflict` exit 1).

Most fixtures are created in temporary directories by tests so generated output
does not live in source control. The workspace and mf-toolkit trees are checked
in so CLI discovery / offline loaders can run without a bundler build or a local
mf-toolkit checkout.

## Negative control for toolkit recognition

Classic component exposes (e.g. `fixtures/workspaces/clean/remote` with
`./Widget`) remain the baseline for normal expose analysis — #127 must not
weaken that path while quieting toolkit shapes.
