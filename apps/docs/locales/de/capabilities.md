<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

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
Agents must not claim green while that finding (or exit code `2`) remains —
see the [agent loop](./agent-loop.md).
The “Manifest and stats” row is **not** a blanket Yes: Vite/Rolldown omit
`mf-manifest.json` / `mf-stats.json` unless `manifest: true`, and missing
webpack compilation stats on those bundlers is expected. See the
[per-bundler matrix](./runtime-manifests.md#per-bundler-expectations).
Adapters must not scrape private Module Federation plugin fields to invent
coverage — see
[permanent guarantees / non-goals](./limitations.md#permanent-guarantees--non-goals).

## Vollständigkeit dynamischer Imports (v1)

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

## Library contracts (1.1.0+)

Die folgenden Abschnitte dokumentieren additive Bibliotheks-APIs für Autorinnen
und Autoren, die Doctor erweitern (Identity, Ownership, Lineage, Waivers und
den semantischen Graphen). Host-Teams, die MFDoctor integrieren, bleiben bei
[Setup](./setup.md), [CI](./production-readiness.md), [Rules](./rules/) und
[Limitations](./limitations.md). Capture steht auf der eigenen Seite
[Runtime capture](./runtime-capture.md); JSON-Schema-Exporte sind unter
[Report schemas](./report-schemas.md) aufgeführt.

## Korrelation semantischer Identitäten

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

## Portable Ownership-Governance

`defineIdentityGovernanceRule` validates a portable ownership rule, while
`resolveIdentityGovernance(identity, rules)` applies deterministic precedence:
an exact identity-key selector wins first, followed by parent/kind and
container/kind selectors, with priority resolving rules within the same
specificity tier. Responsibilities stay distinct for consumers, producers,
shared providers, deployments, and runtime platforms.

Equal-precedence owners are returned as `ambiguous`; the resolver never picks a
team alphabetically. Partial or unknown governance evidence remains `unknown`
and reports the incomplete rule IDs. Scope mismatches and missing target, realm,
or environment dimensions are preserved as diagnostics. Governance is
library-only and additive; it does not suppress findings, modify baselines, or
implement waivers.

## Laufzeit-Identitätsprojektion

`projectRuntimeCaptureIdentity(capture, options)` is the additive bridge from a
sanitized #84 runtime-capture identity into explicit runtime-realm and
runtime-instance identities. It requires an explicit target and realm, keeps
deployment, realm, instance, package, and version dimensions separate, and
returns exact, strong, weak, or unknown confidence with bounded missing-field
diagnostics.

Absent deployment or instance evidence remains a source-scoped unknown identity.
An `instanceName` or other display label is never promoted to semantic proof.
The projection preserves browser, SSR, worker, Node, and frame boundaries and
does not mutate runtime state, execute remote code, inspect client bundles, or
change V1 reports and CLI behavior. Finding lineage, waivers, and the V1
compatibility bridge remain separate additive slices.

## Build-/Artifact-/Deployment-Korrelation

`correlateBuildArtifactDeployment(input)` joins explicit build, artifact,
deployment, and environment identities through parent and artifact-key links.
It returns bounded matched, missing, and conflict dimensions instead of
guessing from manifest names. `correlateDeploymentRelationship(input)` accepts
an explicit offline `redeploy` or `rollback` fact only when the environment and
artifact set agree; it does not infer ordering from timestamps or labels.

These relationships preserve separate build and deployment occurrences while
allowing one artifact set to be redeployed. Incomplete or conflicting #81-style
evidence remains weak or unknown, and no deployment is performed by the
library.

## Finding-Lineage und Offline-Historie

`createFindingLineage` gives a rule evaluation a stable `findingLineageId` and
an independent `findingOccurrenceId`. Lineage is built only from the rule's
declared identity schema, semantic subject, stable violation key, and explicitly
declared scope. Messages, severity, source locations, timestamps, and volatile
evidence are excluded from the lineage ID. The existing V1 fingerprint remains
unchanged and is still the baseline/SARIF compatibility identity.

`createFindingHistorySnapshot` and `diffFindingHistory` compare saved local or CI
snapshots. They report new, persistent, resolved, regressed, improved, and
unknown/unconfirmed changes. A missing or partial later snapshot cannot prove a
finding resolved; only complete comparable evidence can do that. The contract is
offline and library-only: it adds no telemetry service, hosted history store,
default CLI behavior, or rule suppression.

## Governance-Waiver und Audit-Entscheidungen

`defineGovernanceWaiver` validates a portable, owner-approved exception. A waiver
must identify a rule and explicit subject, owner, reason, ticket, approver,
expiration, and one or more named environments. Wildcards, sensitive metadata,
and selectors that cannot identify a concrete subject are rejected.

`evaluateGovernanceWaiver` and `resolveGovernanceWaivers` require the finding to
be a complete failure and require environment, target, realm, and environment
identity evidence whenever a waiver scopes those dimensions. An injected clock
makes expiry tests and audit output reproducible. Expired, not-yet-active,
out-of-scope, incomplete, and ambiguous waivers never suppress a finding.

The result retains every waiver ID, decision reason, expiry, evaluation time,
missing dimension, and conflict. Multiple overlapping approvals with different
owner/reason/ticket metadata remain `ambiguous` instead of selecting a winner.
This contract is additive and library-only: it does not change finding lineage,
the V1 fingerprint, `baseline.schema.json`, report projections, or exit codes.

## V1-Kompatibilitätsbrücke

`projectV1Suppression` is the explicit compatibility seam for consumers that
have both a legacy `DoctorFinding` and additive lineage/waiver evidence. It
delegates baseline matching to the existing V1 matcher, records whether the
baseline, a governed waiver, or both supplied suppression, and exposes the
waiver outcome without changing the finding, baseline file, fingerprint,
terminal/JSON/SARIF projection, or exit policy.

Waiver suppression is accepted only when its resolution is `suppressed` and its
finding lineage ID exactly matches the supplied lineage. Ambiguous, unknown, or
mismatched decisions remain visible but do not suppress. `failOnSuppressed`
preserves the existing policy rule: a suppressed finding is still policy
relevant when that option is enabled.

## Semantische-Graph-Brücke

`buildSemanticGraph` is the opt-in Stage 7 graph/query seam. It accepts explicit
V2 semantic identities and scoped capability edges, computes coverage only in
the requested target/realm/environment scope, and keeps unresolved or weak
edges visible. `querySemanticGraph` filters those nodes, edges, and coverage
records without selecting an arbitrary candidate.

`buildSemanticUiPayload` returns this semantic graph beside the unchanged V1
`buildUiPayload` result. V1 project facts are represented as explicit legacy
nodes; same-named or duplicate legacy projects are never promoted to exact
semantic identities. The semantic graph is additive and does not change the
default report, terminal/JSON/SARIF output, UI payload, fingerprints, baselines,
or exit codes.
