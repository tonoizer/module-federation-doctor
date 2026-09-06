# Federation glob

`mfdoctor federation` with quoted `project.json` patterns analyzes an explicit
set of project-fact files **without** workspace discovery. Use this when CI (or
a showcase) already selected the files. `federation --workspace` is a different
entry point — prove that path with [Workspace](./workspace.md), not this file.

## Sub-features

- `federation-glob` expands quoted `*.project.json` / `**/.mf/doctor/project.json` patterns via the CLI, not the shell.
- `federation-conflict` fails CI policy on a known red glob (version conflict).
- `federation-unmatched` exits `2` when no project reports match.

## How to get to it (user POV)

- Hand-tuned CI layout: `mfdoctor federation ".mf/doctor/**/project.json"`.
- Showcase facts: `mfdoctor federation "examples/showcase/federation/version-conflict/*.project.json"`.
- From this checkout: `node dist/cli.js federation "<glob>" --ci --format json --output - --no-write`.
- Do **not** pass `--workspace` here; that is the [Workspace](./workspace.md) recipe.

## Driving it with the mfdoctor CLI

Preconditions:

- Doctor passed.
- Offline showcase trees under `examples/showcase/federation/*` with committed
  `*.project.json` files (no bundler emit required for this proof).

- **Conflict glob.** Run
  `node dist/cli.js federation "examples/showcase/federation/version-conflict/*.project.json" --ci --format json --output - --no-write`.
  Exit code `1`. JSON `findings` includes `federation/version-conflict`.
- **Unmatched glob.** Run
  `node dist/cli.js federation "examples/showcase/federation/version-conflict/*.does-not-exist.json" --ci --format json --output - --no-write`.
  Exit code `2` (no project reports matched).
- **Proof.** Save stdout/stderr/exit under
  `.cursor/skills/verify-mfdoctor/evidence/federation/`. Note at least one
  `findings[].ruleId` in `notes.txt`. Confirm `--no-write` did not create
  `.mf/doctor` at the repo root.

## Gotchas

- Quote the glob so the CLI expands it. Unquoted `*` is expanded by the shell
  and can pass a file list the command did not intend.
- Bare `federation` is **not** the same as `workspace` / `federation --workspace`
  (those discover `**/.mf/doctor/project.json` under roots). Do not fold this
  proof into the workspace recipe.
- Showcase `*.project.json` files are static facts, not plugin emit. A glob
  pass here is not a full green claim for a real app — still require emit +
  workspace when claiming green on built hosts/remotes.
- Empty or unmatched patterns are incomplete (`exit 2`), not a silent green
  federation.
