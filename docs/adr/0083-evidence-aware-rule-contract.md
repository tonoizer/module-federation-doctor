# ADR 0083: Evidence-aware rule contract

## Status

Accepted as a foundation slice for issue #83. Runtime migration is intentionally deferred.

## Decision

Evidence-aware rules declare stable metadata: a version, owner, remediation, prerequisites,
applicability, confidence ceiling, and default severity. Prerequisites are a small recursive
`allOf`/`anyOf` shape over evidence predicate, layer, subject kind, confidence, and completeness.

Evaluations use one typed outcome: `pass`, `fail`, `unknown`, or `not-applicable`. Their identity is
derived only from rule ID/version, canonical subject ID, and build/compilation/runtime scope. It does
not include messages, timestamps, array order, or absolute paths. Existing v1 finding fingerprints
remain a separate compatibility identity.

The migration inventory records every current built-in rule as `legacy` until a later bounded batch
can supply real prerequisites and applicability. This keeps the contract reviewable without claiming
that the old runner already produces evidence-aware results.

## Consequences

- Rule authors have one public contract to target after the evidence protocol lands.
- Confidence can be capped by either required evidence or rule policy.
- The current CLI, JSON, SARIF, fingerprints, and custom-rule behavior do not change in this slice.
- Later runner work must validate applicability before prerequisites and must never treat missing
  evidence as a pass.
