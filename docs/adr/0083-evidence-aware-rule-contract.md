# ADR 0083: Evidence-aware rule contract

## Status

Accepted. V1 built-in migration completed in issue #232; default CLI output remains on
the legacy V1 path until #87 promotes rollout scopes.

## Decision

Evidence-aware rules declare stable metadata: a version, owner, remediation, prerequisites,
applicability, confidence ceiling, and default severity. Prerequisites are a small recursive
`allOf`/`anyOf` shape over evidence predicate, layer, subject kind, confidence, and completeness.

Evaluations use one typed outcome: `pass`, `fail`, `unknown`, or `not-applicable`. Their identity is
derived only from rule ID/version, canonical subject ID, and build/compilation/runtime scope. It does
not include messages, timestamps, array order, or absolute paths. Existing v1 finding fingerprints
remain a separate compatibility identity.

The migration inventory records every current built-in as `migrated` with machine-checked
prerequisites, applicability, and confidence ceilings. Compatibility-only exceptions must be
documented explicitly in `RULE_COMPATIBILITY_EXCEPTIONS` with owner, reason, scope, and a
deprecation plan. There are no silent legacy built-ins after the #232 closeout.

## Consequences

- Rule authors have one public contract to target after the evidence protocol lands.
- Confidence can be capped by either required evidence or rule policy.
- Default CLI, JSON, SARIF, fingerprints, and custom-rule behavior stay on the V1 path until
  rollout scopes pass #87 release gates.
- Shadow and `v2-compat` modes run the evidence-aware bridges with golden parity tests.
- Applicability is validated before prerequisites and missing evidence is never treated as a pass.
