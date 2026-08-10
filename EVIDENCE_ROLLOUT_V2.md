# Evidence v2 rollout

This file records the rollout control plane for issue #87. It is internal documentation.
It does not change the Doctor CLI, report files, SARIF, exit codes, fingerprints, baselines,
custom rules, or client bundles.

## Modes and scope

`createEvidenceRolloutController` keeps all scopes in `legacy` unless a caller
explicitly selects another mode. Scopes are independent:

- `config`
- `build-artifacts`
- `runtime-reports`
- `runtime-capture`
- `rules`
- `federation-workspace`
- `governance`

The supported modes are `legacy`, `shadow`, `v2-compat`, and `v2-preview`.
Integration code passes the controller to stage adapters without adding unrelated
booleans to collectors or commands.

## Rollback law

Set `MFDOCTOR_EVIDENCE_LEGACY=1` (also accepts `true`, `yes`, or `on`) in the
release environment to force every scope to `legacy`. This switch wins over
all configured modes and does not require rebuilding old v1 code.

`v2-compat` promotion is only possible from `shadow` and only when dependency,
schema, parity, matrix, migration, security, performance, stability, rollback,
and docs gates are all explicitly green. Promotion returns a new controller;
the old controller is unchanged.

## V1 rules closeout (#232)

All 108 current built-ins are `migrated` in `src/rule-inventory.ts` and exported
to `fixtures/rule-inventory/v1.json`. There are no undocumented legacy built-ins.

| Scope                  | Bridge                                          | Parity evidence                                    |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `rules`                | `src/evidence-rule-bridge.ts` (+ runtime slice) | `test/integration/evidence-rollout-bridge.test.ts` |
| `federation-workspace` | `src/evidence-federation-bridge.ts`             | `test/integration/evidence-rollout-bridge.test.ts` |

Recorded gate evidence: `fixtures/evidence-rollout/v1-rules-closeout-evidence.json`.
Author guide: `apps/docs/docs/evidence-aware-rules.md`.

Default output remains `legacy` until #87 promotes scopes after the full release gate
stack is green. The legacy custom-rule adapter stays available during the documented
compatibility window.

## What remains

- Promote individual rollout scopes to `v2-compat` by default after #87 records green
  gates for collectors, writers, and remaining scopes (#84, #86).
- Post-v1 architecture work tracked in #84 and #86 is out of scope for the #232 closeout.
