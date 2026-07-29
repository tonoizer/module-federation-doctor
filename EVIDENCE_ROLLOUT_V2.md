# Evidence v2 rollout

This file records the first rollout slice for issue #87. It is an internal
control plane. It does not change the Doctor CLI, report files, SARIF, exit
codes, fingerprints, baselines, custom rules, or client bundles.

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
Later integration PRs can pass the controller to stage adapters without
adding unrelated booleans to collectors or commands.

## Rollback law

Set `MFDOCTOR_EVIDENCE_LEGACY=1` (also accepts `true`, `yes`, or `on`) in the
release environment to force every scope to `legacy`. This switch wins over
all configured modes and does not require rebuilding old v1 code.

`v2-compat` promotion is only possible from `shadow` and only when dependency,
schema, parity, matrix, migration, security, performance, stability, rollback,
and docs gates are all explicitly green. Promotion returns a new controller;
the old controller is unchanged.

## What remains

This slice does not wire the controller into collectors, migration/projection,
writers, parity comparison, drift ledgers, matrix jobs, or release workflows.
Those pieces depend on the stage contracts in #80–#86 and should land as
follow-up PRs in this stack.
