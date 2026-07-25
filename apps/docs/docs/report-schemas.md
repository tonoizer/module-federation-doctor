# Report schemas

Doctor writes:

- `.mf/doctor/project.json`: portable, schema-versioned project facts.
- `.mf/doctor/report.json`: capabilities, summary, and sorted findings.
- `.mf/doctor/results.sarif`: source locations and stable fingerprints.
- `.mf/doctor/report.html`: a filterable, single-file dashboard with no external
  assets or network requests.

Comparable content has no timestamps. Paths are workspace relative. Schema
version 1 changes only through an intentional compatibility change.

The npm package ships JSON Schema files:

- `@module-federation/doctor/schemas/project.schema.json`
- `@module-federation/doctor/schemas/report.schema.json`
- `@module-federation/doctor/schemas/probe.schema.json`

Use them in editors, artifact validators, or deployment gates. They are strict
about the stable outer contract and leave normalized federation internals open
for additive fields within schema version 1.

The HTML dashboard is inspired by Vitest's compact status-first UI: clear
error/warning/info counts, fast filters, search, and expandable evidence. It is
a report viewer, not a build server, so it stays portable and safe to attach to
CI artifacts.
