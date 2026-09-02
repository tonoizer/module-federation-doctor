# Check

`mfdoctor check` runs tier-1 offline analysis on one project (config/static). It can print findings and write `.mf/doctor` artifacts, but a green or quiet check alone is **not** a full health claim — plugin emit and workspace gates still apply.

## Sub-features

- `check-findings` surfaces rule findings from a known red fixture.
- `check-stdout-json` emits report JSON on stdout with `--output -`.
- `check-no-write` skips disk artifacts when `--no-write` is set.
- `check-ci-exit` applies CI policy (`--ci`) so error-severity findings exit `1`.

## How to get to it (user POV)

- From a project directory: `pnpm exec mfdoctor check`.
- Against another path: `mfdoctor check packages/host --ci`.
- From this checkout: `node dist/cli.js check examples/showcase/config/remote-http-insecure --ci`.

## Driving it with the mfdoctor CLI

Preconditions:

- Doctor (`capabilities`) passed.
- Prefer a disposable copy of a showcase fixture (e.g.
  `examples/showcase/config/remote-http-insecure` or
  `examples/showcase/config/expose-key-invalid`) under `/tmp/mfdoctor-verify-$RUN_ID/`.
- Or pass the tracked path with `--output - --no-write` so the git tree stays clean.

- **Run offline check.** From repo root:
  `node dist/cli.js check "$FIXTURE" --ci --format json --output - --no-write`.
- **Observe findings.** Stdout JSON includes `findings` (e.g. `config/remote-http-insecure` or `config/expose-key-invalid`) and `status` (`complete` / `incompleteReasons`).
- **Observe exit.** Warning-only fixtures may exit `0` under default CI `failOn: error`; error-severity fixtures exit `1`. Exit `2` is for analysis-budget incompleteness or usage/hard failure — `status.incompleteReasons` such as `missing-emit` can still appear with exit `0`/`1` and must not be treated as a full green claim.
- **Confirm no-write.** Assert `$FIXTURE/.mf` was **not** created when `--no-write` was used.
- **Optional write path.** On a temp copy only: omit `--no-write`, use `--format terminal,json,sarif` and optionally `--diagnostics-dir .mf/doctor/diagnostics`. Confirm `.mf/doctor/report.json` exists afterward.
- **Proof.** Store command, cwd, stdout JSON, stderr, exit code under
  `.cursor/skills/verify-mfdoctor/evidence/check/`. Note at least one
  `findings[].ruleId` and the `status` object in `notes.txt`.

Helper:

```bash
.cursor/skills/verify-mfdoctor/helpers/run-check.sh
```

## Gotchas

- Do **not** claim the project is green from check alone — showcase/static check often reports `status.incompleteReasons` including `missing-emit` even when the process exits `0` or `1`.
- `--diagnostics-dir` must stay inside the project root.
- Prefer JSON over ANSI; with `--output -`, terminal findings move to stderr.
- Copying fixtures into `/tmp` avoids dirtying tracked `examples/` trees.
- Showcase fixtures often turn `doctor/partial-analysis` **off**; rely on `status.incompleteReasons` / exit `2` (budget) rather than expecting that ruleId on every check.
