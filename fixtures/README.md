# Fixtures

- `adapters`: clean, warning, and error policy inputs for Vite, Rspack, Rsbuild,
  and Webpack.
- `diagnostics`: rule, redaction, ordering, and failure cases.
- `dynamic-imports`: supported and unresolved dynamic MF import patterns (MFDOCTOR-105).
- `manifests`: valid and malformed Module Federation artifacts.
- `runtime-traces`: Observability-style exports for `mfdoctor runtime` correlation.
- `workspaces`: portable multi-app `.mf/doctor/project.json` trees for the
  workspace federation gate (`clean` exit 0, `conflict` exit 1).

Most fixtures are created in temporary directories by tests so generated output
does not live in source control. The workspace trees are checked in so CLI
discovery can run without a bundler build.
