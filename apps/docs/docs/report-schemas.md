# Report schemas

Doctor writes:

- `.mf/doctor/project.json`: portable, schema-versioned project facts.
- `.mf/doctor/report.json`: capabilities, summary, and sorted findings.
- `.mf/doctor/results.sarif`: source locations and stable fingerprints.
- `.mf/doctor/evidence.json` will be the v2 evidence graph output in the next
  compatibility slice. Its public contract ships now.

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

## Evidence protocol v2

`@module-federation/doctor/schemas/evidence.schema.json` defines the canonical
v2 evidence graph. It keeps declared, effective, artifact, deployment, and
runtime claims separate. Every assertion names its subject, scope, provenance,
confidence, and completeness. Rule evaluations use exactly one outcome:
`pass`, `fail`, `unknown`, or `not-applicable`.

IDs and collections are deterministic. Paths and secret-like values must be
redacted before persistence. Timestamps are source data only and must not be
used in fingerprints. v2 is additive in this release; v1 files and outputs stay
the supported default until a later migration issue changes that policy.

### Stable IDs and safe persistence

`stableEvidenceId(prefix, value)` first validates finite JSON values and the
default resource limits (64 levels, 10,000 nodes, 1 MiB, 1,000 children per
object or array), redacts secrets and machine paths, sorts object keys, and
counts the exact UTF-8 bytes of JSON escaping. Hard ceilings reject caller
limits above 128 levels, 50,000 nodes, 8 MiB, or 10,000 children. It then
returns `<prefix>:<first 16 lowercase hex characters of SHA-256>`. The prefix
must contain only letters, numbers, `.`, `_`, or `-`. Ordered arrays keep their
order; graph collections, `evidenceIds`, `parentEvidenceIds`, and `missing` are
set-like and are sorted during graph normalization. Stable IDs omit object keys
named `timestamp`, `time`, `createdAt`, `updatedAt`, `sessionId`, or `traceId`
(case-insensitive), including nested occurrences. Other fields are included.

Duplicate IDs and dangling references are rejected. A full-record comparison is
used as a defensive sort tie-breaker, but it cannot hide duplicate IDs. JSON
`null` is distinct from a string such as `"null"`; `NaN` and infinities are
rejected before hashing. Callers may provide lower resource limits and get a
typed `EvidenceResourceError`.

Secret-like keys (`credential`, `token`, `private-key`, `authorization`, and
similar) become `[REDACTED_KEY]` and their values become `[REDACTED]`. Fixed keys
from the v2 schema, including `identity.sessionId`, keep their names while
values are redacted. URL
schemes and paths are parsed before redaction: URL credentials and sensitive
query parameters are removed while the URL remains a URL; POSIX, Windows, and
UNC filesystem paths become `[PATH]`. Stack paths are also redacted after
opening punctuation such as `(`, `[` or `{`. Other strings are left unchanged.

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
`buildUiPayload` / graph payloads — see below. Do not treat it as an HTML report
format.

## Runtime Observability source fixtures

Runtime input is a user-supplied JSON export and stays opt-in. The contract
fixture set lives in `fixtures/runtime-traces/`:

- `current-2.5.3.json` is a sanitized serialized success report replayed from
  the upstream 2.5.3 harness; `snapshot-failure-2.5.3.json` is the matching
  serialized moduleInfo/snapshot failure.
- `partial-devtools.json` is the pinned `readObservabilitySnapshot()` Chrome
  DevTools result; omitted report data is unknown/not collected.
- `fixtures/runtime-traces/provenance.json` records the exact upstream commit,
  replay commands, test names, and raw/sanitized digests.
- The other fixtures are legacy Doctor input and are kept separate for the
  later migration adapter.

The upstream report has no schema-version field. Doctor must track the source
contract separately from `runtimeVersion`, which identifies the MF runtime.

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
