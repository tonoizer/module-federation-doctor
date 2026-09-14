# Prompt

`mfdoctor prompt` reprints offline agent fix prompts from a saved
`.mf/doctor/report.json`. It does **not** re-run analysis. Agents use
`--finding <ruleId|fingerprint>` after `check` (or a plugin emit) so the
documented loop can load structured fix guidance without inventing flags.

## Sub-features

- `prompt-finding` prints one copy-paste prompt for a rule ID present in the report.
- `prompt-fingerprint` prints one prompt when `--finding` is an exact fingerprint.
- `prompt-plan` includes `## Verification plan` and `## Repair context` before `## Finding` (context-faithful; unknown placeholders rather than invented facts).
- `prompt-top` without `--finding` prints up to three highest-priority non-suppressed prompts.
- `prompt-unknown` exits `2` when `--finding` matches no finding.

## How to get to it (user POV)

- After a check or emit that wrote `.mf/doctor/report.json`: `mfdoctor prompt`.
- For one finding: `mfdoctor prompt --finding config/remote-http-insecure`.
- Against an explicit report: `mfdoctor prompt --finding <ruleId|fingerprint> .mf/doctor/report.json`.
- From this checkout: `node dist/cli.js prompt --finding <ruleId> <report.json>`.

## Driving it with the mfdoctor CLI

Preconditions:

- Doctor (`capabilities`) passed.
- A saved report exists. Prefer a disposable copy of
  `examples/showcase/config/remote-http-insecure` under
  `/tmp/mfdoctor-verify-$RUN_ID/`: run
  `node dist/cli.js check "$FIXTURE" --format json` there so
  `$FIXTURE/.mf/doctor/report.json` is written. Do not use `--no-write` or
  `--output -` for this step — both skip writing `report.json`, and `prompt`
  reads that file.
- Or pass a report path produced by a prior plugin-emit / diagnostics dump.

- **Print one finding.** Run
  `node dist/cli.js prompt --finding config/remote-http-insecure "$REPORT"`.
  Exit `0`. Stdout is markdown starting with `# Fix: config/remote-http-insecure`
  then `## Verification plan` and `## Repair context`, then Finding / Impact /
  Fix / Evidence / Docs / Verify. It tells the agent not to suggest suppressions
  or baseline entries unless the user asks. Standalone `prompt` fills plan
  fields such as project directory, report path, and completeness with
  `unknown` rather than inventing analysis context.
- **Print top prompts.** Run `node dist/cli.js prompt "$REPORT"` (no
  `--finding`). Exit `0`. Stdout starts with `Agent prompts (top N)` or
  `No agent prompts (no non-suppressed findings).`
- **Unknown selector.** Run
  `node dist/cli.js prompt --finding definitely/not-a-finding "$REPORT"`.
  Exit `2`. Stderr mentions no matching finding.
- **Proof.** Save command, cwd, stdout, stderr, and exit code under
  `.cursor/skills/verify-mfdoctor/evidence/prompt/`. Note the `ruleId` (and a
  fingerprint if used) in `notes.txt`.

## Gotchas

- `prompt` never analyzes a project. A missing report is exit `2`, not a green
  federation.
- `--finding` accepts a rule ID or an exact fingerprint — do not invent other
  selector flags.
- Extra headings after `# Fix:` are expected: `## Verification plan` and
  `## Repair context` come before `## Finding`. Do not treat them as scrape
  failure. Standalone `mfdoctor prompt` does not thread the CLI report path
  into that plan; `unknown` is the reprint command's contract, not a missing
  file.
- `check --output -` prints the report on stdout and does **not** write
  `report.json`. Capture that JSON to a file if you need `prompt` without a
  disk write from check, or omit `--output -` / `--no-write` on a temp copy.
- This is not `check --prompt` (terminal handoff after analysis) and not a
  general `--fix`. Do not mutate the project from this command.
- Prefer a temp fixture copy so writing `report.json` does not dirty tracked
  `examples/` trees. Delete the copy in Cleanup; keep skill evidence.
