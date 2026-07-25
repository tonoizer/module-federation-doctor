# Fixtures

- `adapters`: clean, warning, and error policy inputs for Vite, Rspack, Rsbuild,
  and Webpack.
- `diagnostics`: rule, redaction, ordering, and failure cases.
- `manifests`: valid and malformed Module Federation artifacts.
- `workspaces`: portable project reports used by federation checks.

Most fixtures are created in temporary directories by tests so generated output
does not live in source control.
