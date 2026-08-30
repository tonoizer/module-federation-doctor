<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Evidence-aware rules

Built-in rules in MFDoctor now declare prerequisites, applicability,
confidence ceilings, and typed evaluation outcomes. This guide is for maintainers
and custom-rule authors who need to understand how evidence-aware semantics differ
from the legacy `defineRule` “report or stay silent” model.

The machine-checked migration inventory lives in
[`fixtures/rule-inventory/v1.json`](https://github.com/tonoizer/module-federation-doctor/blob/main/fixtures/rule-inventory/v1.json)
and is validated by `vp run inventory:check`.

## Ergebnisse

Every enabled rule/subject evaluation records exactly one outcome:

| Outcome          | Meaning                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pass`           | Prerequisites are complete, the rule applies, and the checked condition is healthy.                                                            |
| `fail`           | Prerequisites are complete, the rule applies, and the condition is violated. Projects to the existing V1 `DoctorFinding` shape.                |
| `unknown`        | The rule may apply, but required evidence is missing, partial, stale, or below the confidence floor. Never silently converted to pass or fail. |
| `not-applicable` | Known adapter/version/target/build-mode/project-role evidence proves the rule does not apply.                                                  |

Disabled rules and engine errors are execution states, not evaluation outcomes. V2/debug
output keeps them separate from `pass`, `fail`, `unknown`, and `not-applicable`.

## Konfidenz

Each evaluation carries `exact`, `high`, `medium`, `low`, or `unknown` confidence plus
a reason. Result confidence cannot exceed:

1. the weakest required evidence, and
2. the rule's declared `confidenceCeiling`.

Heuristic source scans and package-name checks stay capped at `low` or `medium` even
when the evidence is complete. Severity and confidence are independent: an
error-severity rule can still be `unknown`, and a low-confidence heuristic can remain
useful as `info`.

## Voraussetzungen und Anwendbarkeit

Rules declare `prerequisites` as a small recursive `allOf` / `anyOf` tree over evidence
predicates, layers, subject kinds, minimum confidence, and minimum completeness.
`applicability` is checked first. Missing adapter/version/target data yields `unknown`
when the rule may apply, or `not-applicable` only when known evidence proves it does not.

Built-in inventory entries also record `evidenceReads`: the fact paths the legacy
compatibility oracle still touches. Prerequisites must cover every non-optional read.

## V1-Kompatibilität und Einführung

Default MFDoctor output remains on the legacy V1 path (`legacy` rollout mode). Shadow and
`v2-compat` modes run the evidence-aware bridges beside V1 and compare outputs before
promotion. Set `MFDOCTOR_EVIDENCE_LEGACY=1` to force every scope back to legacy without
rebuilding old artifacts.

All 110 current built-ins are `migrated` in the inventory. There are no undocumented
legacy built-ins. Any future compatibility-only exception must be added to
`RULE_COMPATIBILITY_EXCEPTIONS` with owner, reason, scope, and deprecation plan.

## Custom rules

Custom rules still use `defineRule` and the legacy adapter during the documented
compatibility window. They report findings through `context.report` and do not yet
participate in the evidence prerequisite contract. See [Custom rules](./custom-rules.md).

Evidence-native custom rules will use the same metadata shape as built-ins once the
public v2 author API stabilizes ([#83](https://github.com/tonoizer/module-federation-doctor/issues/83),
[#87](https://github.com/tonoizer/module-federation-doctor/issues/87)).

## Where to look in code

| Area                        | Location                                                    |
| --------------------------- | ----------------------------------------------------------- |
| Inventory and groups        | `src/rule-inventory.ts`                                     |
| Common runner               | `src/rule-contract.ts`                                      |
| Project/build bridge        | `src/evidence-rule-bridge.ts`                               |
| Federation workspace bridge | `src/evidence-federation-bridge.ts`                         |
| Rollout controller          | `src/evidence-rollout.ts`                                   |
| V1 parity comparator        | `src/evidence-parity.ts`                                    |
| Closeout evidence           | `fixtures/evidence-rollout/v1-rules-closeout-evidence.json` |

## Related docs

- [Report schemas](./report-schemas.md) — v1 surfaces vs additive v2 evidence
- [Runtime capture](./runtime-capture.md) — imported runtime evidence and unknown handling
- [Security policy](https://github.com/tonoizer/module-federation-doctor/blob/main/SECURITY.md) — reporting, privacy, and redaction behavior
- [ADR 0083](https://github.com/tonoizer/module-federation-doctor/blob/main/docs/adr/0083-evidence-aware-rule-contract.md) — contract decision record
