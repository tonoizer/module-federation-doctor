# Capabilities

`mfdoctor capabilities` prints the versioned machine-readable CLI contract without loading project configuration or touching the network. Agents use it to discover commands, formats, exit codes, schemas, explicit non-goals, and per-command `operations` contracts before driving other commands.

## Sub-features

- `capabilities-json` prints a JSON document on stdout.
- `capabilities-commands` lists supported commands including `check`, `workspace`, and `probe`.
- `capabilities-operations` lists per-command contracts under `operations.commands` (arguments, options, network, writtenArtifacts, errorCodes).
- `capabilities-bundler-matrix` lists `bundlerMatrix.supported` and `bundlerMatrix.partial` from the public compatibility matrix (Nuxt is `partial`).
- `capabilities-exit` exits `0` when the binary is healthy.

## How to get to it (user POV)

- After installing `@tonoizer/mfdoctor`, run `pnpm exec mfdoctor capabilities`.
- From this checkout after `pnpm build`, run `node dist/cli.js capabilities`.

## Driving it with the mfdoctor CLI

Preconditions:

- `dist/cli.js` exists (`pnpm build` / `vp pack` succeeded).
- No project path or config is required.

- **Print contract.** Run `node dist/cli.js capabilities`. Exit code is `0`. Stdout is JSON with `schemaVersion`, `package.name` = `@tonoizer/mfdoctor`, and a `commands` object.
- **Assert command list.** Confirm `commands` includes `capabilities`, `check`, `workspace`, `federation`, `baseline`, `runtime`, `prompt`, `rules`, `probe`, and `compare`.
- **Assert operations contract.** Confirm `operations.schemaVersion` is `1` and `operations.commands` includes those same names (plus `help`). Each command object has `arguments`, `options`, `network`, `writtenArtifacts`, and `errorCodes`. `operations.commands.check.writtenArtifacts` includes `<diagnostics-dir>/verification-plan.json`.
- **Assert bundler matrix.** Confirm `bundlerMatrix.supported` is `vite`, `rspack`, `rsbuild`, `webpack` and `bundlerMatrix.partial` includes `rolldown`, `modern`, and `nuxt`.
- **Assert exit semantics.** Confirm `exitCodes` maps `0` / `1` / `2` (success / policy-fail / usage-or-incomplete-analysis).
- **Proof.** Save stdout to `.cursor/skills/verify-mfdoctor/evidence/capabilities/stdout.json` with `exit-code.txt` containing `0`.

## Gotchas

- This command does not analyze a project. A green capabilities run does not mean the federation is healthy.
- Do not scrape ANSI — capabilities is JSON-only on stdout.
- `commands` is the short discovery map; `operations` is the detailed per-command contract. Do not treat a missing `operations` key as a complete capabilities payload.
- If the binary is missing, rebuild; do not invent a stub contract.
