# Workspace

`mfdoctor workspace` discovers `.mf/doctor/project.json` trees under one or more roots and runs the cross-project federation gate. Users run it after building federated apps with MFDoctor adapters (or against checked-in workspace fixtures).

## Sub-features

- `workspace-discover` finds `**/.mf/doctor/project.json` under given roots.
- `workspace-conflict` fails CI policy when shared versions conflict.
- `workspace-clean` passes CI policy on compatible shared graphs.

## How to get to it (user POV)

- After building a monorepo: `mfdoctor workspace` or `mfdoctor workspace apps packages`.
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
- **Nested example (optional, heavier).** Build with
  `vp run --filter './examples/nested-federation/**' build`, then
  `node dist/cli.js workspace examples/nested-federation --format terminal,json`.
- **Proof.** Save stdout/stderr/exit under
  `.cursor/skills/verify-mfdoctor/evidence/workspace/`.

## Gotchas

- Discovery looks for emitted (or fixture) `project.json` files — an empty root yields incomplete/empty analysis, not a silent green federation.
- Nested example builds are multi-package and slow; prefer `fixtures/workspaces/*` for a quick offline proof.
- A workspace pass still depends on honest emit facts; do not skip plugin-emit when claiming full green on real apps.
- `--group <name>` filters by `federationGroup`; omitting it analyzes all discovered projects under the roots.
