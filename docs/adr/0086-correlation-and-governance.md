# ADR 0086: Semantic identity, correlation, and governance boundary

## Status

Proposed for owner review. This ADR defines the Stage 7 contract and PR order;
it does not change default reports, fingerprints, baselines, exit codes, or
runtime behavior.

## Context

MFDoctor already has V1 identity and evidence foundations. Stage 7 needs to
correlate build, artifact, deployment, runtime, and ownership evidence without
collapsing unrelated applications or claiming precision that the evidence does
not provide. The broad #86 issue must therefore be implemented as small,
legacy-preserving slices rather than one graph rewrite.

The required evidence seams from #80–#85 are now present on `main`. #84 remains
an optional external capture stage and may provide runtime evidence, but it does
not prove a build or deployment relationship on its own.

## Decision

### Identity hierarchy

Use composable semantic identities with explicit parents:

```text
organization
└─ application
   ├─ container
   │  └─ adapter-target
   │     └─ build-lineage
   │        └─ build
   │           └─ artifact
   └─ environment
      └─ deployment
         └─ runtime-realm
            └─ runtime-instance
```

The current V1 identity contract already names these identity kinds. A semantic
identity describes a stable entity or lineage; an occurrence ID describes one
trusted build, deployment, or runtime occurrence. They must not be conflated.

Every identity carries:

- a versioned kind and deterministic `mfid:v1:<kind>:<digest>` key;
- aliases for safe source-local lookup, never proof of global sameness;
- completeness (`complete`, `partial`, or `unknown`);
- confidence (`exact`, `strong`, `weak`, or `unknown`);
- provenance and evidence IDs;
- an optional parent identity and bounded display name.

Unknown parents are scoped to their source document. They are not global
singletons, and two name-only inputs never become one exact identity.

### Stable-key law

Stable semantic keys may use only normalized identity dimensions. They must not
contain absolute checkout roots, secret URLs, raw process/tab IDs, timestamps,
display labels, owner names, or volatile session values. Target and realm are
identity dimensions, not presentation labels: browser, SSR, worker, mobile,
Node, iframe, top-frame, and unknown evidence must not collapse by container
name alone.

Existing V1 finding fingerprints and baseline matching remain unchanged. New
semantic IDs are additive until parity fixtures and rollout gates prove a safe
promotion path.

### Correlation results

Every attempted relationship returns a typed result:

- `exact` — an explicit shared ID, digest, or documented compound key proves it;
- `strong` — multiple stable dimensions agree under compatible scope;
- `weak` — a bounded locator or source-local alias creates a candidate;
- `ambiguous` — more than one candidate remains possible;
- `unknown` — required evidence is missing, unsupported, or incompatible.

Candidate lists, confidence, missing fields, source evidence, and conflict
diagnostics are retained. A resolver must never choose an alphabetical or
otherwise arbitrary candidate, and a name-only match is never exact.

Cross-target, cross-realm, cross-environment, and incompatible source-version
matches are rejected or remain candidates. Time proximity can explain a
candidate; it cannot prove causality or ownership.

### Capability edges and coverage

The graph represents producer, consumer, shared-provider, runtime, and other
capability edges as scoped facts. A project/container may have multiple edges at
once. Static host/remote labels are derived views for compatibility and UI, not
the source of truth.

Coverage is evaluated per layer, target, environment, and realm. An OR-aggregate
from one layer must not upgrade missing evidence in another layer.

### Ownership and waivers

Ownership is a separate, later slice. A governance file is the portable source;
CODEOWNERS, CI, and external mappings are imported candidates. Resolution keeps
consumer, producer, shared-provider, deployment, and runtime-platform
responsibility distinct and reports equal-priority conflicts deterministically.

Waivers are also separate from baselines. A waiver requires owner, reason,
ticket, approver, expiry, environment, and a bounded selector. An expired or
out-of-scope waiver never suppresses. Owner changes and waivers do not change
semantic identity, finding lineage, or the existing V1 fingerprint.

### Offline history

History is derived from versioned local/CI artifacts. A finding is `resolved`
only when later evidence is comparable and complete. Missing, partial,
unsupported, or unknown evidence yields `unknown/unconfirmed`, not a false fix.
Redeployments preserve semantic lineage while creating new trusted occurrences.
No hosted history, approval server, ticket write, or private organization read
is introduced by this ADR.

## Proposed PR stack

The implementation must follow this order and keep each PR independently
reviewable:

1. **Identity ADR and canonical-key grammar** — this document; no runtime
   behavior.
2. **Identity schemas/types/helpers** — extend only where the existing contract
   has a proven gap; add deterministic and redaction tests.
3. **Capability edges and scoped coverage** — additive graph facts and legacy
   projections.
4. **Correlation candidate engine** — exact/strong/weak/ambiguous/unknown
   results, candidate retention, conflict fixtures; no CLI integration.
5. **Build/artifact/deployment correlation** — consume exact #81 evidence and
   offline deployment metadata; add rollback/redeploy/environment cases.
6. **Runtime/realm correlation** — consume #82/#84 evidence; enforce browser,
   SSR, worker, Node, frame, and partial-snapshot boundaries.
7. **Ownership resolver** — governance file, responsibility edges,
   precedence/conflict behavior; no waivers yet.
8. **Finding lineage and history** — bridge #83 rule identity dimensions and
   comparable-evidence diff states.
9. **Governance waivers** — validation, scope, injected clock, expiry, and
   audit decisions; no baseline schema changes.
10. **V1 compatibility bridge and integration** — preserve fingerprints,
    terminal/JSON/SARIF/UI projections, and exit semantics with parity proof.

Do not merge a later stage before its dependency stage has a stable contract.
Do not combine #84 live capture, #86 correlation, and #87 rollout gates in one
PR.

## Compatibility and security invariants

- Existing V1 report, baseline, SARIF, graph, sorting, fingerprint, and exit
  behavior remains unchanged unless a separately approved rollout gate says
  otherwise.
- Same normalized inputs and injected clock produce byte-stable identity,
  correlation, ownership, waiver, and diff outputs.
- Redaction happens before keys, digests, fingerprints, logs, and persistence.
- No client bundle code, runtime mutation, remote execution, deployment
  mutation, telemetry service, or private organization read is added.
- Public contracts receive schema versions, migration tests, and representative
  ambiguity/conflict fixtures before implementation is promoted.

## Owner decisions required before implementation

1. Confirm the identity hierarchy and stable-key law above.
2. Decide whether ownership belongs after correlation (recommended) or is part
   of the first graph slice.
3. Confirm that waivers remain a separate post-lineage slice and never modify
   `baseline.schema.json`.
4. Confirm additive/opt-in V2 output until parity and rollout gates pass.

Part of [#86](https://github.com/tonoizer/module-federation-doctor/issues/86).
