---
name: verify-mfdoctor
description: Verify @tonoizer/mfdoctor the way a user does — CLI (mfdoctor) and post-emit build plugin. Use when proving check/workspace/capabilities/plugin-emit behavior, not the docs site or an HTML UI.
---

# Verify MFDoctor

Drive `@tonoizer/mfdoctor` the way a user does: short-lived `mfdoctor` CLI
invocations and (when proving emit) a child-process example build that registers
`federationDoctor`. Primary surface is **CLI + post-emit build plugin** — not
the docs site (`docs:dev`), not an HTML dashboard, not an in-browser doctor, and
not a general `--fix`.

Read `features/README.md` before picking a recipe. Prove one mapped feature per
run unless the caller asks for more.

## Launch

Build the local binary once from the repo root (pnpm workspace):

```bash
pnpm install
pnpm build
# equivalent: vp pack
```

Ready when:

```bash
test -f dist/cli.js
node dist/cli.js capabilities
```

exits `0` and prints JSON (versioned CLI contract). After build you may also use
`pnpm exec mfdoctor` — prefer `node dist/cli.js` in this skill so the checkout
binary is explicit.

Teardown for the binary: none (short-lived CLI; no long-lived server).

For **plugin-emit** proofs only: start the example build as a **child process you
own** (record its PID). Example:

```bash
pnpm exec vp run --filter @mfdoctor-standalone/vite build
# or: PATH="$(pwd)/node_modules/.bin:$PATH" vp run --filter @mfdoctor-standalone/vite build
```

Temp fixture copies live under paths listed in Cleanup (typically
`/tmp/mfdoctor-verify-*`). Do not mutate tracked example trees when a disposable
copy works.

## Doctor

Read-only readiness check (no project config, no network):

```bash
node dist/cli.js capabilities
```

Assert:

- exit code `0`
- stdout is JSON with `schemaVersion`, `package.name` = `@tonoizer/mfdoctor`,
  and `commands` containing at least `capabilities`, `check`, `workspace`,
  `federation`, `baseline`, `runtime`, `prompt`, `rules`, `probe`, `compare`
- optional: `test -f dist/cli.js`

If Doctor fails, do **not** Drive. Rebuild (`pnpm build`) and re-run Doctor.

## Drive

Isolation: each CLI run is short-lived. Prefer a disposable cwd:

1. Copy a fixture/example into `/tmp/mfdoctor-verify-$RUN_ID/...`, **or**
2. Pass a path argument and use `--output - --no-write` so the repo tree stays
   clean.

Two instances may run side by side (separate temp dirs / separate processes).

Stable handles (prefer these; never coordinates or HTML selectors):

| Handle         | Notes                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Command names  | `capabilities`, `check`, `workspace`, `federation`, `rules`, …                                      |
| Exit codes     | `0` pass, `1` policy fail, `2` incomplete / usage                                                   |
| JSON keys      | `status`, `status.complete`, `status.incompleteReasons`, `findings`, `findings[].ruleId`, `summary` |
| Artifact paths | `.mf/doctor/report.json`, `.mf/doctor/project.json`, `.mf/doctor/results.sarif`                     |

Real flags from this CLI (see `apps/docs/docs/cli.md`):

```bash
# Tier-1 one-project analysis (do NOT claim green from check alone)
node dist/cli.js check <project> --ci --format terminal,json,sarif \
  --output - --no-write

# Same check writing artifacts under the project (use a temp copy)
node dist/cli.js check <project> --ci --format terminal,json,sarif \
  --diagnostics-dir .mf/doctor/diagnostics

# Cross-project gate after emits (or on fixtures/workspaces/* trees)
node dist/cli.js workspace <root> --ci --format terminal,json

# Versioned contract
node dist/cli.js capabilities

# Rule catalog
node dist/cli.js rules
```

Prefer stdout JSON (`--format json` and/or `--output -`) over scraping ANSI
terminal output. `--diagnostics-dir` must stay inside the project root or the
CLI rejects it.

**Two-tier loop:** offline `check` is config/static analysis. Before claiming
green, require plugin emit evidence (`.mf/doctor/project.json` from a build with
`federationDoctor`) and, in monorepos, the workspace/federation gate. Treat exit
`2` and `doctor/partial-analysis` / `status.incompleteReasons` as incomplete —
not a pass.

Network commands `probe` and `compare` are out of default proof scope. Do not
run them unless proving that mapped network feature.

Helper for the default offline check proof:

```bash
.cursor/skills/verify-mfdoctor/helpers/run-check.sh
```

## Evidence

Named directory that **survives cleanup**:

`.cursor/skills/verify-mfdoctor/evidence/<feature-id>/`

Committed example of one successful proof is OK. Scratch temps are gitignored
under `.cursor/skills/verify-mfdoctor/scratch/` (or use `/tmp/mfdoctor-verify-*`).

Capture at least:

| File                          | Content                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `command.txt`                 | Exact argv                                                                                                   |
| `cwd.txt`                     | Working directory used                                                                                       |
| `stdout.txt` or `stdout.json` | Captured stdout                                                                                              |
| `stderr.txt`                  | Captured stderr                                                                                              |
| `exit-code.txt`               | Numeric exit code                                                                                            |
| For `check`                   | Report JSON body (`--output -`) plus at least one `findings[].ruleId` or `status` field noted in `notes.txt` |

Proof standards:

- Exercise the real user path (`node dist/cli.js …` / example `federationDoctor`
  build), not internal test setters.
- Capture the action **and** resulting state (JSON status/findings; presence or
  absence of `.mf/doctor/` when using `--no-write`).
- Observe side effects — never trust a dry-run _name_; verify `--no-write` by
  confirming `.mf/doctor` was not created.
- Mocks only at production boundaries (do not mock the doctor itself).

## Cleanup

- Delete temp fixture copies (`rm -rf /tmp/mfdoctor-verify-*` and any
  `scratch/` dirs you created).
- Delete any `.mf/doctor` trees you created **inside those temps**.
- For plugin-emit builds: kill only PIDs you started (never kill by process
  name).
- **Never delete** `.cursor/skills/verify-mfdoctor/evidence/`.

After cleanup, confirm evidence still exists at the named path.

## Helpers

| Script                 | Purpose                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `helpers/run-check.sh` | Doctor + disposable showcase `check` with `--output - --no-write`, writes evidence under `evidence/check/` |

Invocation from repo root (script must be executable):

```bash
.cursor/skills/verify-mfdoctor/helpers/run-check.sh
```

Optional env:

- `MFDOCTOR_VERIFY_REPO` — repo root (default: detected from script location)
- `MFDOCTOR_VERIFY_EVIDENCE` — evidence dir (default: skill `evidence/check`)
- `MFDOCTOR_VERIFY_FIXTURE` — source fixture to copy (default:
  `examples/showcase/config/remote-http-insecure`)

## Non-goals

Do not invent or verify:

- HTML UI / `--ui` dashboard
- In-browser doctor / runtime agent injection
- General `--fix` autofix
- MCP servers, VS Code problem matchers, `check --watch`
- New bundler adapters, private MF field scraping, client-bundle doctor
- `docs:dev` as the verification surface
- Unsolicited `probe` / `compare` (network)
