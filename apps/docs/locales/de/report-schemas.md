<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Report schemas

MFDoctor writes:

- `.mf/doctor/project.json`: portable, schema-versioned project facts.
- `.mf/doctor/report.json`: capabilities, summary, and sorted findings.
- `.mf/doctor/results.sarif`: source locations and stable fingerprints.
- `.mf/doctor/evidence.json` will be the v2 evidence graph output in the next
  compatibility slice. Its public contract ships now.

Comparable content has no timestamps. Paths are workspace relative. Schema
version 1 changes only through an intentional compatibility change. Additive
import-analysis fields (`dynamicPackages`, `remotes`, `unresolvedDynamic`,
`evidenceSources`) document MFDoctor’s dynamic-import completeness bar without
breaking older `project.json` files that omit them.

## Öffentliche v1-Schema-Verträge

These JSON Schema files are **public contracts for schema version 1**. They are
exported from the npm package and enforced in CI via `vp run schema:check` (also
wired into `vp run pack:check`) against representative MFDoctor output. Breaking
changes require a new `schemaVersion` (or an intentional, documented exception).

## Evidenzprotokoll v2

The public `readEvidenceDocument` reader accepts an unknown in-memory JSON
value, validates its exact shipped schema, and returns a normalized v2 graph.
Valid v1 project facts and reports are migrated in memory; the input object is
not changed. Reader errors include the file label (when supplied), document
kind, source version, failure code, and JSON pointer. Current CLI command paths
still read and write v1 documents until a later dual-read compatibility slice.

`@tonoizer/mfdoctor/schemas/evidence.schema.json` defines the canonical
v2 evidence graph. It keeps declared, effective, artifact, deployment, and
runtime claims separate. Every assertion names its subject, scope, provenance,
confidence, and completeness. Rule evaluations use exactly one outcome:
`pass`, `fail`, `unknown`, or `not-applicable`.

IDs and collections are deterministic. Paths and secret-like values must be
redacted before persistence. Timestamps are source data only and must not be
used in fingerprints. v2 is additive in this release; v1 files and outputs stay
the supported default until a later migration issue changes that policy.

### Stabile IDs und sichere Persistenz

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

| Schema export                                                         | Produced by                                      | Contract kind                 |
| --------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| `@tonoizer/mfdoctor/schemas/project.schema.json`                      | Build / collect → `project.json`                 | Persisted artifact            |
| `@tonoizer/mfdoctor/schemas/report.schema.json`                       | Analyze → `report.json`                          | Persisted artifact            |
| `@tonoizer/mfdoctor/schemas/baseline.schema.json`                     | Baseline generate / update                       | Persisted artifact            |
| `@tonoizer/mfdoctor/schemas/probe.schema.json`                        | `mfdoctor probe` / `probeManifest`               | CLI / API result              |
| `@tonoizer/mfdoctor/schemas/runtime-trace.schema.json`                | `analyzeRuntime` summary                         | Correlation summary           |
| `@tonoizer/mfdoctor/schemas/identity-correlation.schema.json`         | `correlateSemanticIdentity` / capability helpers | Additive correlation contract |
| `@tonoizer/mfdoctor/schemas/identity-governance.schema.json`          | `resolveIdentityGovernance`                      | Additive governance contract  |
| `@tonoizer/mfdoctor/schemas/runtime-capture.schema.json`              | `@tonoizer/mfdoctor/capture`                     | External capture contract     |
| `@tonoizer/mfdoctor/schemas/runtime-identity-correlation.schema.json` | `projectRuntimeCaptureIdentity`                  | Runtime identity projection   |
| `@tonoizer/mfdoctor/schemas/build-artifact-deployment.schema.json`    | `correlateBuildArtifactDeployment`               | Build/deployment correlation  |
| `@tonoizer/mfdoctor/schemas/finding-lineage.schema.json`              | `createFindingLineage` / history helpers         | Finding lineage and history   |
| `@tonoizer/mfdoctor/schemas/ui.schema.json`                           | `buildUiPayload`                                 | Programmatic graph only       |

`ui.schema.json` is **not** a persisted CLI artifact (MFDoctor no longer ships an
HTML dashboard). It remains the published shape for programmatic consumers of
`buildUiPayload` / graph payloads — see below. Do not treat it as an HTML report
format.

## Laufzeit-Observability-Quell-Fixtures

Runtime input is a user-supplied JSON export and stays opt-in. The contract
fixture set lives in `fixtures/runtime-traces/`:

- `current-2.5.3.json` is a sanitized serialized success report replayed from
  the upstream 2.5.3 harness; `snapshot-failure-2.5.3.json` is the matching
  serialized moduleInfo/snapshot failure.
- `partial-devtools.json` is the pinned `readObservabilitySnapshot()` Chrome
  DevTools result; omitted report data is unknown/not collected.
- `fixtures/runtime-traces/provenance.json` records the exact upstream commit,
  replay commands, test names, and raw/sanitized digests.
- The other fixtures are legacy MFDoctor input and are kept separate for the
  later migration adapter.

The upstream report has no schema-version field. MFDoctor must track the source
contract separately from `runtimeVersion`, which identifies the MF runtime.

Use the schemas in editors, artifact validators, or deployment gates. They are
strict about the stable outer contract and leave normalized federation
internals open for additive fields within schema version 1.

## Programmatischer Federation-Graph (`buildUiPayload`)

MFDoctor does **not** ship an HTML dashboard. The retired `--ui` / HTML report path
is gone. What remains is a **programmatic** graph contract:

- Export: `buildUiPayload(projects, report)` from `@tonoizer/mfdoctor`
- Schema: `@tonoizer/mfdoctor/schemas/ui.schema.json`
- Shape: `DoctorUiPayload` with remotes / shared / orchestration node-edge graphs
- Also attached on `FederationAnalysisResult.ui` and `RuntimeAnalysisResult.ui`

Use it when you want to render your own visualization, feed a graph database, or
validate a custom consumer against the published schema. It is not written to
disk by default and is unrelated to terminal / JSON / SARIF report formats.

Findings may include `suppressed` / `suppressionReason` when a
[fingerprint baseline](./baselines.md) matches. Report `summary.suppressed`
counts those findings when present.

## Gesundheitswert (`summary.score`)

Report summaries include an offline federation health score:

- `summary.score`: integer `0–100`, or `null` when analysis is too partial
  (non-suppressed `doctor/partial-analysis`)
- `summary.scoreLabel`: `"Great"` | `"OK"` | `"Needs work"` | `null`

Formula (unique rule ids, not raw finding count):

```text
score = clamp(0, round(100 − 1.5×|unique error rules| − 0.75×|unique warning rules|))
```

Excluded from the score surface by default: `info` findings, tooling-category
rules, `doctor/*` advisories, and baseline-suppressed findings. Bands: **≥75
Great**, **≥50 OK**, else **Needs work**. The score does not change `failOn`
semantics. Terminal printing can be disabled with `--no-score` / `score: false`
while JSON still includes the fields. After the score footer, MFDoctor prints
[top-3 agent fix prompts](./cli.md) (`--no-prompt` to hide; `mfdoctor prompt`
and `--diagnostics-dir` for offline handoff).

## Versionierte Befunddetails (`detailsSchema` + `details`)

Findings may include optional top-level fields:

| Field           | Type   | Purpose                                       |
| --------------- | ------ | --------------------------------------------- |
| `detailsSchema` | string | Versioned schema id (e.g. `shared.unused.v1`) |
| `details`       | object | Machine-readable payload for that schema      |

These fields are **additive and optional**. Old reports without them still validate.
Unknown `detailsSchema` values must be ignored by readers (do not fail the pipeline).

### Fingerprint / baseline / SARIF stability

`fingerprint()` hashes only `ruleId`, `project`, `location`, and `evidence`
(`src/utils.ts`). **`detailsSchema` and `details` are never fingerprint inputs.**
Never put a schema version into `evidence` — that would churn baselines and SARIF
`partialFingerprints`. Adding typed details does not change fingerprints for
existing findings.

### First-batch schema inventory

| `detailsSchema`              | Rule ids                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared.unused.v1`           | `shared/unused`                                                                                                                                                                                                          |
| `shared.singleton.v1`        | `shared/singleton-risk`, `shared/eager-without-singleton`, `shared/singleton-mismatch`                                                                                                                                   |
| `shared.version-mismatch.v1` | `shared/version-unsatisfied`, `artifact/manifest-shared-version-mismatch`                                                                                                                                                |
| `remotes.config.v1`          | `config/remote-entry-invalid`, `config/remote-http-insecure`, `config/remote-localhost-in-production`, `config/remote-alias-prefix-collision`, `config/remote-manifest-recommended`, `config/remote-capability-disabled` |
| `artifact.v1`                | other first-batch `artifact/*` rules                                                                                                                                                                                     |
| `doctor.partial-analysis.v1` | `doctor/partial-analysis`                                                                                                                                                                                                |

TypeScript exports: `FINDING_DETAILS_SCHEMAS`, `TYPED_DETAILS_RULE_IDS`,
`readFindingDetails`, and per-family `*DetailsV1` types from
`@tonoizer/mfdoctor`.

### Agent-/CI-Beispiel (`details` statt Message-Regex bevorzugen)

```ts
import {
  readFindingDetails,
  FINDING_DETAILS_SCHEMAS,
  type SharedUnusedDetailsV1,
} from "@tonoizer/mfdoctor";

for (const finding of report.findings) {
  const typed = readFindingDetails(finding);
  if (!typed) continue; // old report or unknown schema — skip

  if (typed.detailsSchema === FINDING_DETAILS_SCHEMAS.SHARED_UNUSED) {
    const details = typed.details as SharedUnusedDetailsV1;
    // Gate on structured fields instead of scraping finding.message
    if (details.package === "react") {
      console.error("unused shared react", details);
    }
  }
}
```

Custom rules may attach the same top-level fields via `context.report({ ..., detailsSchema, details })`.
Prefer a namespaced id such as `custom.<team>.<topic>.v1`.

## Schema der semantischen Identität

`@tonoizer/mfdoctor/schemas/identity.schema.json` is the additive
identity contract for correlation work. Identity keys use
`mfid:v1:<kind>:<digest>` and use semantic dimensions only. Checkout paths,
timestamps, display labels, runtime session values, and occurrence IDs never
change a semantic key. Unknown values are explicit and scoped to their source;
they are not one global unknown node.
