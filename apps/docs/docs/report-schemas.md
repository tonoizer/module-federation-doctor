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

The npm package ships JSON Schema files:

- `@module-federation/doctor/schemas/project.schema.json`
- `@module-federation/doctor/schemas/report.schema.json`
- `@module-federation/doctor/schemas/baseline.schema.json`
- `@module-federation/doctor/schemas/probe.schema.json`
- `@module-federation/doctor/schemas/runtime-trace.schema.json`
- `@module-federation/doctor/schemas/ui.schema.json` — programmatic federation
  graph payload (not an HTML report)

Use them in editors, artifact validators, or deployment gates. They are strict
about the stable outer contract and leave normalized federation internals open
for additive fields within schema version 1.

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
