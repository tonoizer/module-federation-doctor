# Runtime

`mfdoctor runtime` correlates a **user-supplied** Module Federation Observability
export with local `project.json` facts. It is offline: it never fetches URLs
found in the trace and never executes remote JavaScript. This is not an
in-browser doctor and not `probe`.

## Sub-features

- `runtime-mismatch` emits `runtime/shared-mismatch` from the shared-mismatch showcase (exit `1`; `runtime/error-correlated` may also appear).
- `runtime-green` correlates a healthy trace with no findings (exit `0`).
- `runtime-offline` redacts secrets / full private URLs and does not open the network.
- `runtime-unmatched` exits `2` when the trace path is missing or no project files match.

## How to get to it (user POV)

- After an Observability export: `mfdoctor runtime ./.mf/observability/latest.json`.
- With explicit project facts: `mfdoctor runtime ./trace.json ".mf/doctor/**/project.json"`.
- Showcase: `mfdoctor runtime examples/showcase/runtime/shared-mismatch/trace.json "examples/showcase/runtime/shared-mismatch/*.project.json"`.
- From this checkout: `node dist/cli.js runtime <trace.json> "<project-glob>" --format json --output - --no-write`.

## Driving it with the mfdoctor CLI

Preconditions:

- Doctor passed.
- Offline showcase trees under `examples/showcase/runtime/{green,shared-mismatch}`
  (committed `trace.json` + `*.project.json`). No live Observability collector
  and no network.

- **Shared mismatch.** Run
  `node dist/cli.js runtime examples/showcase/runtime/shared-mismatch/trace.json "examples/showcase/runtime/shared-mismatch/*.project.json" --format json --output - --no-write`.
  Exit code `1`. JSON `findings` includes `runtime/shared-mismatch`.
- **Healthy trace.** Run the same shape against
  `examples/showcase/runtime/green/trace.json` and
  `"examples/showcase/runtime/green/*.project.json"`. Exit code `0` and no
  runtime findings.
- **Missing trace.** Pass a project glob (otherwise the CLI reports unmatched
  projects first):
  `node dist/cli.js runtime /tmp/mfdoctor-verify-missing-trace.json "examples/showcase/runtime/green/*.project.json"`.
  Exit code `2`. Stderr mentions the unreadable trace.
- **Proof.** Save stdout/stderr/exit under
  `.cursor/skills/verify-mfdoctor/evidence/runtime/`. Note rule IDs (or empty
  findings) in `notes.txt`. Confirm `--no-write` did not create `.mf/doctor`
  at the repo root.

## Gotchas

- Quote project globs so the CLI expands them.
- Default project glob is `.mf/doctor/**/project.json` relative to cwd — a
  repo-root run without an explicit glob will not see showcase `*.project.json`
  files.
- Error-severity runtime findings exit `1` even without `--ci`.
- Do not run `probe` / `compare` for this proof. Do not invent an in-browser
  runtime agent. Bundler `runtimePlugins` are a different surface (plugin-emit /
  check), not this command.
- A green runtime correlation is still not a full health claim without plugin
  emit + workspace on real apps.
