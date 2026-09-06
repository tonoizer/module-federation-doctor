# Baseline

`mfdoctor baseline` generate / update / prune writes a fingerprint baseline
from a saved report. Baselines are **checked-in debt**, not a mute and not a
substitute for fixing findings. Agents must not generate or apply a baseline
to “clear” a gate unless the user asked for suppressions / accepted debt.

## Sub-features

- `baseline-generate` replaces the output with unique current finding fingerprints.
- `baseline-update` adds new fingerprints and keeps existing entries.
- `baseline-prune` removes entries that no longer match the current report (existing file required).
- `baseline-missing-prune` exits `2` when prune has no baseline file yet.

## How to get to it (user POV)

- After a report exists: `mfdoctor baseline generate .mf/doctor/report.json`.
- Merge later findings: `mfdoctor baseline update .mf/doctor/report.json --out mfdoctor.baseline.json`.
- Drop paid-down debt: `mfdoctor baseline prune .mf/doctor/report.json --out mfdoctor.baseline.json`.
- From this checkout: `node dist/cli.js baseline generate "$REPORT" --out "$OUT"`.

## Driving it with the mfdoctor CLI

Preconditions:

- Doctor passed.
- A saved report exists on a **disposable** copy (same setup as
  [Prompt](./prompt.md): check a temp showcase fixture so
  `$FIXTURE/.mf/doctor/report.json` is written). Write `--out` under that temp
  tree, never into a tracked example unless the user asked to commit debt.

- **Generate.** Run
  `node dist/cli.js baseline generate "$REPORT" --out "$OUT"`.
  Exit `0`. Stdout says it wrote N entries. `$OUT` is JSON with
  `schemaVersion` and `entries[]` (`fingerprint`, optional `ruleId` / `project`).
- **Update.** Run the same path with `baseline update` against the generated
  file. Exit `0`. Entry count does not drop.
- **Prune without a file.** On a fresh temp path with no `$OUT`, run
  `node dist/cli.js baseline prune "$REPORT" --out "$MISSING"`.
  Exit `2`. Stderr tells you to run `baseline generate` first.
- **Proof.** Save command, cwd, stdout, stderr, exit codes, and a baseline
  excerpt under `.cursor/skills/verify-mfdoctor/evidence/baseline/`. Note
  entry count and at least one `ruleId` in `notes.txt`.

## Gotchas

- Do **not** add a baseline (or severity `off`, or a waiver) to make CI green
  unless the user explicitly requested suppressions or accepted debt.
- `generate` overwrites the output file. `update` retains extra entries.
  `prune` will not create a file from nothing.
- Review baseline diffs like code. Do not auto-update on every CI run.
- This command does not re-analyze the project; a missing or corrupt report
  exits `2`. Applying a baseline on `check` / `federation` is a separate flag
  (`--baseline`) — prove generate/update/prune here, not silent suppression.
