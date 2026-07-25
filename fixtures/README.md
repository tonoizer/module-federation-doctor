# Fixtures

- `adapters`: clean, warning, and error policy inputs for Vite, Rspack, Rsbuild,
  and Webpack.
- `diagnostics`: rule, redaction, ordering, and failure cases.
- `dynamic-imports`: supported and unresolved dynamic MF import patterns (MFDOCTOR-105).
- `manifests`: valid and malformed Module Federation artifacts.
- `policy-packs`: shareable Doctor policy pack example (`@acme/mfdoctor-policy`).
- `runtime-traces`: Observability-style exports for `mfdoctor runtime` correlation.
- `workspaces`: portable project reports used by federation checks.

Most fixtures are created in temporary directories by tests so generated output
does not live in source control.
