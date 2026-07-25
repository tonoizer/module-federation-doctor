# Capability matrix

Analysis depth per supported bundler. For supported / partial / pending /
unsupported **product** cells (Node, package managers, report surfaces, Webpack
gate), see the [compatibility matrix](./compatibility.md).

| Capability                             | Vite                                                            | Rspack            | Rsbuild               | Webpack                                                                         |
| -------------------------------------- | --------------------------------------------------------------- | ----------------- | --------------------- | ------------------------------------------------------------------------------- |
| Explicit MF config                     | Yes                                                             | Yes               | Yes                   | Pending ([#10](https://github.com/tonoizer/module-federation-doctor/issues/10)) |
| Static imports                         | Yes                                                             | Yes               | Yes                   | Pending                                                                         |
| Supported dynamic patterns (see below) | Yes                                                             | Yes               | Yes                   | Pending                                                                         |
| Manifest and stats                     | Yes                                                             | Yes               | Yes                   | Pending                                                                         |
| Emitted assets                         | Rollup-compatible hooks                                         | Compilation hooks | Rspack when available | Pending                                                                         |
| Opt-in runtime traces                  | Correlated when `runtimeTrace` / `mfdoctor runtime` is supplied | Same              | Same                  | Pending                                                                         |
| Cross-project checks                   | Yes                                                             | Yes               | Yes                   | Pending                                                                         |

Rules consult recorded capabilities. Missing optional input creates
`doctor/partial-analysis` instead of pretending full analysis happened.
Adapters must not scrape private Module Federation plugin fields to invent
coverage — see
[permanent guarantees / non-goals](./limitations.md#permanent-guarantees--non-goals).
Webpack is listed as Pending until the adapter lands on `main`; do not claim
those cells as Yes without CI evidence.

## Dynamic-import completeness (v1)

Doctor’s import/shared analysis is **not** “static only.” Offline `check` /
adapter runs resolve the patterns below when evidence exists in source, config,
manifest facts, or an opt-in Observability export. Unresolvable dynamics yield
`doctor/partial-analysis` rather than fabricated certainty. Doctor still does
**not** claim 100% of arbitrary runtime JavaScript.

### Supported (resolved when evidence exists)

| Pattern                                                                                   | Evidence                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Static `import` / `export … from`                                                         | Source scan                                                     |
| Dynamic `import("…")` / `import('…')` of local modules, packages, or `remoteAlias/expose` | Source scan + configured remotes                                |
| `require("…")` string literals                                                            | Source scan                                                     |
| `loadRemote("alias/expose")`                                                              | Source scan (recorded under `imports.remotes`)                  |
| `loadShare("pkg")` / `loadShareSync("pkg")`                                               | Source scan (`imports.packages` / `dynamicPackages`)            |
| `registerRemotes([{ name: "…", … }])` with string `name` / `alias`                        | Source scan                                                     |
| Conditional / runtime remotes named in an opt-in Observability trace                      | `runtimeTrace` on Doctor options or `mfdoctor runtime`          |
| Remotes listed on an on-disk `mf-manifest.json`                                           | Manifest facts (`imports.remotes`, `evidenceSources: manifest`) |

Shared usage for `shared/unused` includes static imports, resolved dynamic /
`loadShare*` literals, and packages named in an opt-in runtime trace. Remote
aliases are not treated as shared packages.

### Not resolved (honest partial analysis)

| Pattern                                                                       | Behavior                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `import(expr)`, template literals, or non-literal `loadRemote` / `loadShare*` | Recorded in `imports.unresolvedDynamic`; `doctor/partial-analysis`    |
| `registerRemotes(variable)` or objects without string `name`/`alias`          | Same                                                                  |
| Arbitrary conditional remotes with no config, manifest, or trace evidence     | Not invented; stay silent or partial when unresolved call sites exist |
| Executing remote JS or fetching live remotes during `check` / `federation`    | Out of scope (use `probe` / Observability separately)                 |

When unresolved package-capable dynamics exist, `shared/unused` does **not**
claim a package is unused — prefer `doctor/partial-analysis` over a false pass
or false unused finding.
