# Report schemas

Doctor writes:

- `.mf/doctor/project.json`: portable, schema-versioned project facts.
- `.mf/doctor/report.json`: capabilities, summary, and sorted findings.
- `.mf/doctor/results.sarif`: source locations and stable fingerprints.

Comparable content has no timestamps. Paths are workspace relative. Schema
version 1 changes only through an intentional compatibility change. Additive
import-analysis fields (`dynamicPackages`, `remotes`, `unresolvedDynamic`,
`evidenceSources`) document Doctor’s dynamic-import completeness bar without
breaking older `project.json` files that omit them.

## Public v1 schema contracts

These JSON Schema files are **public contracts for schema version 1**. They are
exported from the npm package and enforced in CI via `pnpm schema:check` (also
wired into `pnpm pack:check`) against representative Doctor output. Breaking
changes require a new `schemaVersion` (or an intentional, documented exception).

| Schema export                                                 | Produced by                        | Contract kind           |
| ------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| `@module-federation/doctor/schemas/project.schema.json`       | Build / collect → `project.json`   | Persisted artifact      |
| `@module-federation/doctor/schemas/report.schema.json`        | Analyze → `report.json`            | Persisted artifact      |
| `@module-federation/doctor/schemas/baseline.schema.json`      | Baseline generate / update         | Persisted artifact      |
| `@module-federation/doctor/schemas/probe.schema.json`         | `mfdoctor probe` / `probeManifest` | CLI / API result        |
| `@module-federation/doctor/schemas/runtime-trace.schema.json` | `analyzeRuntime` summary           | Correlation summary     |
| `@module-federation/doctor/schemas/ui.schema.json`            | `buildUiPayload`                   | Programmatic graph only |

`ui.schema.json` is **not** a persisted CLI artifact (Doctor no longer ships an
HTML dashboard). It remains the published shape for programmatic consumers of
`buildUiPayload` / graph payloads. Orphan HTML-UI cleanup is tracked separately
(#59 / #131); do not treat this schema as an HTML report format.

Use the schemas in editors, artifact validators, or deployment gates. They are
strict about the stable outer contract and leave normalized federation
internals open for additive fields within schema version 1.

## Programmatic federation graph (`buildUiPayload`)

Doctor does **not** ship an HTML dashboard. The retired `--ui` / HTML report path
is gone. What remains is a **programmatic** graph contract:

- Export: `buildUiPayload(projects, report)` from `@module-federation/doctor`
- Schema: `@module-federation/doctor/schemas/ui.schema.json`
- Shape: `DoctorUiPayload` with remotes / shared / orchestration node-edge graphs
- Also attached on `FederationAnalysisResult.ui` and `RuntimeAnalysisResult.ui`

Use it when you want to render your own visualization, feed a graph database, or
validate a custom consumer against the published schema. It is not written to
disk by default and is unrelated to terminal / JSON / SARIF report formats.

Findings may include `suppressed` / `suppressionReason` when a
[fingerprint baseline](./baselines.md) matches. Report `summary.suppressed`
counts those findings when present.
