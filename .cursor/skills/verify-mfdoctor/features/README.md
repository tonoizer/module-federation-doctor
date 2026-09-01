# MFDoctor verification map

This directory is the maintained source for verifying user-facing
`@tonoizer/mfdoctor` behavior (CLI `mfdoctor` + post-emit `federationDoctor`
plugin). Read this index before driving, then use the matching feature file as
the recipe.

## Baseline preconditions

- Repo root has a built binary: `pnpm install && pnpm build` → `dist/cli.js`.
- Doctor passes: `node dist/cli.js capabilities` exits `0` with JSON.
- Put nothing on a shared long-lived server — the CLI is short-lived.
- Prefer disposable fixture copies under `/tmp/mfdoctor-verify-$RUN_ID/` (or
  `--output - --no-write`) so tracked trees stay clean.
- Never drive a binary you have not Doctor-checked since the last failed Drive
  or rebuild.
- Default proofs stay **offline**. Do not run `probe` / `compare` unless the
  feature file marks network-required.

## Driving conventions

- Start from the built `dist/cli.js` (or `pnpm exec mfdoctor` after the same
  build).
- Prefer stdout JSON over scraping ANSI (`--format json`, `--output -`).
- Treat every command as literal. Keep flags unchanged.
- Stable handles: command names, exit codes (`0`/`1`/`2`), JSON keys
  (`status`, `findings`, `incompleteReasons`), `.mf/doctor/*` paths.
- Do **not** claim green from `check` alone. Incomplete analysis
  (`exit 2`, `doctor/partial-analysis`, non-empty `status.incompleteReasons`)
  is not a pass.
- Restore / delete temp copies after a mutation. Do not remove proof artifacts
  during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state (stdout/stderr/exit + JSON
  fields and/or `.mf/doctor` presence).
- CLI proof includes command, cwd, stdout, stderr, and exit code under
  `.cursor/skills/verify-mfdoctor/evidence/<feature-id>/`.
- Mutation / emit proof includes a second read of `.mf/doctor/project.json` or
  `report.json` after the build.
- Record the feature ID and entry point with every artifact.
- Report an unreachable path with the attempted command and unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the
user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the mfdoctor CLI` (or `Driving it with the post-emit plugin`)
   starts with `Preconditions:` and uses labeled bullets that pair each user
   action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable
handles, required state, commands, and observable proof.

## Features

- [Capabilities](./capabilities.md) — versioned JSON CLI contract (no config, no network).
- [Check](./check.md) — one-project offline analysis on a showcase/example fixture.
- [Workspace](./workspace.md) — cross-project federation gate on nested examples or workspace fixtures.
- [Plugin emit](./plugin-emit.md) — build with `federationDoctor` and observe `.mf/doctor/project.json`.
- [Rules](./rules.md) — built-in rule catalog via `mfdoctor rules`.

## Explicitly not mapped

- HTML dashboard / interactive UI
- In-browser runtime agent
- Docs site (`docs:dev`)
- Network `probe` / `compare` (not default proof; network-required if added later)
