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
- `@module-federation/doctor/schemas/ui.schema.json` (graph payload shape for
  programmatic consumers of `buildUiPayload`)

Use them in editors, artifact validators, or deployment gates. They are strict
about the stable outer contract and leave normalized federation internals open
for additive fields within schema version 1.

Findings may include `suppressed` / `suppressionReason` when a
[fingerprint baseline](./baselines.md) matches. Report `summary.suppressed`
counts those findings when present.
