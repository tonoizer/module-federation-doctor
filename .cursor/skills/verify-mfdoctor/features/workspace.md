# Workspace

`mfdoctor workspace` discovers `.mf/doctor/project.json` trees under one or more roots and runs the cross-project federation gate. Users run it after building federated apps with MFDoctor adapters (or against checked-in workspace fixtures).

## Sub-features

- `workspace-discover` finds `**/.mf/doctor/project.json` under given roots.
- `workspace-conflict` fails CI policy when shared versions conflict.
- `workspace-clean` passes CI policy on compatible shared graphs.
- `workspace-require-complete` with `--require-complete` exits `1` when evidence is incomplete (stock clean fixtures have `emittedAssets: false` / `missing-emit`).
- `workspace-stale` surfaces `doctor/partial-analysis` when a listed source file is newer than `project.json` (`details.workspaceDiagnostics[].kind` = `stale`; `incompleteReasons` includes `evidence-unknown`; exit `2`, or `1` with `--require-complete`).

## How to get to it (user POV)

- After building a monorepo: `mfdoctor workspace` or `mfdoctor workspace apps packages`.
- Opt-in incomplete-as-fail: `mfdoctor workspace --require-complete` (same flag on `federation --workspace`).
- `mfdoctor federation --workspace` is the same discovery + gate path (use `workspace` for normal monorepo proofs; use bare `federation` only for explicit `project.json` globs).
- This repo already dogfoods: `pnpm test:nested` builds `examples/nested-federation/**` then runs `node dist/cli.js workspace examples/nested-federation`.
- Offline fixture trees: `fixtures/workspaces/clean` (exit `0`) and `fixtures/workspaces/conflict` (exit `1` under `--ci`).

## Driving it with the mfdoctor CLI

Preconditions:

- Doctor passed.
- Either (a) portable fixtures under `fixtures/workspaces/{clean,conflict}` with checked-in `.mf/doctor/project.json`, or (b) a prior plugin-emit build of `examples/nested-federation` / `examples/mixed-federation-issues`.

- **Conflict fixture.** Run
  `node dist/cli.js workspace fixtures/workspaces/conflict --ci --format json --output - --no-write`.
  Exit code `1`. JSON `findings` includes `federation/version-conflict`.
- **Clean fixture.** Run the same against `fixtures/workspaces/clean`. Exit code `0` and no conflict findings.
- **Require complete.** Same clean fixture plus `--require-complete`. Exit code `1`; `status.incompleteReasons` includes `missing-emit` (stock fixtures do not claim emitted assets).
- **Stale evidence.** Copy `fixtures/workspaces/clean` to a temp tree. Add `host/src/index.ts`, set `host/.mf/doctor/project.json` `imports.sourceFiles` to `["src/index.ts"]`, and make that source file newer than `project.json`. Run
  `node dist/cli.js workspace "$TMP" --format json --output - --no-write`.
  Exit code `2`. Findings include `doctor/partial-analysis` with `details.workspaceDiagnostics` `kind: "stale"` and message `Project evidence is stale: source input "src/index.ts" is newer than project facts.` `status.incompleteReasons` includes `evidence-unknown`. Add `--require-complete` → exit `1`.
- **Glob override (optional).** `node dist/cli.js workspace fixtures/workspaces/conflict --glob "**/.mf/doctor/project.json" --ci --format json --output - --no-write` still finds the conflict (exit `1`). Quote the glob; it is resolved relative to each root and must name `.mf`, a `**/project.json` pattern skips hidden directories.
- **Nested example (optional, heavier).** Build with
  `vp run --filter './examples/nested-federation/**' build`, then
  `node dist/cli.js workspace examples/nested-federation --format terminal,json`.
- **Proof.** Save stdout/stderr/exit under
  `.cursor/skills/verify-mfdoctor/evidence/workspace/`.

## Gotchas

- Discovery looks for emitted (or fixture) `project.json` files, an empty root yields incomplete/empty analysis, not a silent green federation.
- Nested example builds are multi-package and slow; prefer `fixtures/workspaces/*` for a quick offline proof.
- A workspace pass still depends on honest emit facts; do not skip plugin-emit when claiming full green on real apps.
- `--group <name>` filters by `federationGroup`; omitting it analyzes all discovered projects under the roots.
- `--glob` overrides the discovery pattern under the given roots (help example: `**/.mf/doctor/project.json`). It is not a repo-relative file list; prove explicit file lists with [Federation glob](./federation.md).
- Stock `fixtures/workspaces/*` trees have empty `imports.sourceFiles` and `emittedAssets: false`, so they do **not** exercise freshness and they fail `--require-complete`. Use a disposable copy for stale-source proofs.
