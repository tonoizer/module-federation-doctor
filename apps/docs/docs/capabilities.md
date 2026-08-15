# Capability matrix

Analysis depth per supported bundler. For supported / partial / unsupported
**product** cells (Node, package managers, report surfaces), see the
[compatibility matrix](./compatibility.md).

| Capability                             | Vite / Rolldown / Vite Plus                                     | Rspack                | Rsbuild               | Webpack               | Modern.js                                                |
| -------------------------------------- | --------------------------------------------------------------- | --------------------- | --------------------- | --------------------- | -------------------------------------------------------- |
| Explicit MF config                     | Yes                                                             | Yes                   | Yes                   | Yes                   | Yes                                                      |
| Static imports                         | Yes                                                             | Yes                   | Yes                   | Yes                   | Yes                                                      |
| Supported dynamic patterns (see below) | Yes                                                             | Yes                   | Yes                   | Yes                   | Yes                                                      |
| Manifest and stats                     | Opt-in (`manifest: true`); no webpack stats                     | Default (`!== false`) | Default (`!== false`) | Default (`!== false`) | Default under hood; see [matrix](./runtime-manifests.md) |
| Emitted assets                         | On-disk `writeBundle` / `closeBundle` (Rolldown-safe)           | Compilation hooks     | Rspack when available | Compilation hooks     | Via Rspack/Webpack `afterEmit`                           |
| Opt-in runtime traces                  | Correlated when `runtimeTrace` / `mfdoctor runtime` is supplied | Same                  | Same                  | Same                  | Same                                                     |
| Cross-project checks                   | Yes                                                             | Yes                   | Yes                   | Yes                   | Yes                                                      |
| Lifecycle recording                    | `bundler.lifecycle` (`vite` / `rolldown-vite` / `vite-plus`)    | —                     | —                     | —                     | —                                                        |

Rules consult recorded capabilities. Missing optional input creates
`doctor/partial-analysis` instead of pretending full analysis happened.
The “Manifest and stats” row is **not** a blanket Yes: Vite/Rolldown omit
`mf-manifest.json` / `mf-stats.json` unless `manifest: true`, and missing
webpack compilation stats on those bundlers is expected. See the
[per-bundler matrix](./runtime-manifests.md#per-bundler-expectations).
Adapters must not scrape private Module Federation plugin fields to invent
coverage — see
[permanent guarantees / non-goals](./limitations.md#permanent-guarantees--non-goals).

## Dynamic-import completeness (v1)

MFDoctor’s import/shared analysis is **not** “static only.” Offline `check` /
adapter runs resolve the patterns below when evidence exists in source, config,
manifest facts, or an opt-in Observability export. Unresolvable dynamics yield
`doctor/partial-analysis` rather than fabricated certainty. MFDoctor still does
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
| Conditional / runtime remotes named in an opt-in Observability trace                      | `runtimeTrace` on MFDoctor options or `mfdoctor runtime`        |
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

## Semantic identity correlation

The additive identity contract provides deterministic offline correlation without
changing V1 reports, fingerprints, baselines, terminal output, SARIF, or exit
codes. `correlateSemanticIdentity(subject, candidates)` returns exact, strong,
weak, ambiguous, or unknown outcomes together with bounded candidate keys,
matched dimension names, missing evidence, and conflicts. It never chooses an
arbitrary candidate when the strongest evidence ties.

Correlation is scope-aware. Target, realm, and environment boundaries are kept
separate; a browser candidate cannot satisfy an SSR scope, and an unknown or
unbounded scope cannot be promoted to complete evidence. Values used to explain
correlation are not copied into the result, which keeps paths, URLs, credentials,
and other raw source data outside the additive contract.

`createIdentityCapabilityEdge` records producer, consumer, shared-provider, and
runtime relationships as deterministic digest IDs. `assessIdentityCapabilityCoverage`
evaluates those edges within one requested scope and reports complete, partial,
or unknown coverage. These graph facts are opt-in library data; existing legacy
host/remote projections remain unchanged.
