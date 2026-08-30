---
title: CLI command reference
description: Run MFDoctor locally and in CI, across a workspace, against runtime traces, or against a deployed manifest.
---

# CLI command reference

The **build plugin** is the primary MFDoctor experience. Use the CLI for a local
check, a cross-project federation gate, baseline maintenance, runtime trace
correlation, or a deliberate deployed-manifest probe. MFDoctor is not a CLI-only
source scanner and does not inject an agent into the browser. The build plugin
remains the primary integration; use the CLI for tasks outside a bundler emit.

Agents: `mfdoctor check` is tier 1 (config/static). Do **not** claim green from
check alone — finish plugin emit plus the workspace gate, and never ignore
`doctor/partial-analysis`. See the [agent loop](./agent-loop.md).

After installing `@tonoizer/mfdoctor` as a development dependency, run the
binary through your package manager or a package script:

```bash
pnpm exec mfdoctor check
```

The examples below use the shorter `mfdoctor` form.

## Choose a command

| Command                                      | Use it for                                                                                 | Network access |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------- |
| [`check`](#check-one-project)                | Analyze one project or checkout (tier 1 — not a full green claim alone)                    | No             |
| [`workspace`](#check-a-workspace)            | Discover built MFDoctor project facts below one or more roots and gate the full federation | No             |
| [`federation`](#check-a-federation)          | Analyze explicit `project.json` globs, or use workspace discovery explicitly               | No             |
| [`baseline`](#manage-a-baseline)             | Generate, extend, or prune accepted finding fingerprints                                   | No             |
| [`runtime`](#correlate-a-runtime-trace)      | Correlate an Observability export with local MFDoctor project facts                        | No             |
| [`prompt`](#print-agent-fix-prompts)         | Reprint fix prompts from a saved MFDoctor report                                           | No             |
| [`rules`](#inspect-the-rule-catalog)         | Inspect all built-in rules or one rule's metadata                                          | No             |
| [`capabilities`](#discover-cli-capabilities) | Print the versioned machine-readable CLI contract                                          | No             |
| [`probe`](#probe-a-deployed-manifest)        | Validate a deployed manifest and optionally its remote entry                               | **Yes**        |
| [`compare`](#compare-deployed-manifests)     | Diff two or more deployed manifests (name, exposes, shared, publicPath, remoteEntry)       | **Yes**        |

MFDoctor loads an optional `mfdoctor.config.ts`; command-line flags override its
values. Use `extends` for [named presets and shareable policy packs](./policy-packs.md).

## Discover CLI capabilities

```bash
mfdoctor capabilities
```

This command prints a versioned JSON contract without loading project
configuration or accessing the network. Agents and wrappers can use it to
discover supported commands, output formats, public schema paths, exit-code
meanings, noninteractive handoff commands, explicit non-goals, analysis
completeness boundaries, GitHub Action identity, network policy, and the
bundler matrix derived from
[`fixtures/compatibility-matrix.json`](https://github.com/tonoizer/module-federation-doctor/blob/main/fixtures/compatibility-matrix.json).
Validate the payload with the shipped
[`capabilities.schema.json`](https://github.com/tonoizer/module-federation-doctor/blob/main/schemas/capabilities.schema.json)
when integrating across package versions.

## Check one project

```bash
mfdoctor check
```

Analyzes the current working directory. Use a positional path to analyze a
different project:

```bash
mfdoctor check packages/host --ci
```

`--ci` applies CI policy even when MFDoctor does not detect a CI environment. It
defaults `failOn` to `error` and output to terminal, JSON, and SARIF. Local
development defaults `failOn` to `never`, so findings print without breaking
the build.

### Select report formats

```bash
mfdoctor check --format terminal,json,sarif
```

Accepted formats are `terminal`, `json`, and `sarif`. JSON and SARIF artifacts
are written below `.mf/doctor/`. A format list containing only `json` or `sarif`
does not add human-readable terminal output.

### Apply accepted debt

```bash
mfdoctor check --baseline ./mfdoctor.baseline.json
```

Matching findings remain visible but are marked as suppressed and do not fail
policy by default. Treat the file as tracked debt and shrink it as issues are
fixed. See [Fingerprint baselines](./baselines.md).

### Control terminal output

```bash
mfdoctor check --verbose
mfdoctor check --no-score
mfdoctor check --no-prompt
mfdoctor check --prompt
```

- MFDoctor is quiet when a check has no findings. `--verbose` restores the green
  success line.
- `--no-score` hides the terminal health score. Report JSON still contains
  `summary.score` and `summary.scoreLabel`.
- `--no-prompt` hides the copy-paste fix prompts printed after findings.
- `--prompt` force-enables those prompts, including when config disables them or CI
  would hide them.
- In CI (standard `CI` / provider env vars, or `mode: "ci"`), prompts are hidden by
  default. Local runs still show them. Opt in with `--prompt`, or dump prompts to
  disk with `--diagnostics-dir` without printing them.

You can also set `MFDOCTOR_QUIET=0` to show successful checks or
`MFDOCTOR_QUIET=1` to force quiet success. Environment configuration wins over
the file configuration.

### Write a diagnostic bundle

```bash
mfdoctor check --diagnostics-dir .mf/doctor/diagnostics
mfdoctor check --diagnostics-dir .mf/doctor/diagnostics --diagnostics-prompts 10
```

Writes `report.json`, `summary.md`, and `prompts/*.md` to a directory inside the
project root. MFDoctor rejects a diagnostics path that escapes the project.

By default the dump includes the same top-3 prompts as the terminal. Pass
`--diagnostics-prompts <n>` (integer `1`–`25`) or set
`MFDOCTOR_DIAGNOSTICS_PROMPTS` to dump more for agent/CI handoff. Values above
`25` are rejected so the dump stays bounded. Terminal output stays at top-3
regardless of this flag. You can also set `diagnosticsPromptLimit` in
DoctorOptions / config; CLI and that option win over the env var.

## Print agent fix prompts

```bash
mfdoctor prompt
mfdoctor prompt --finding config/name-required
mfdoctor prompt --finding <fingerprint> .mf/doctor/report.json
```

`prompt` reads `.mf/doctor/report.json` by default. Without `--finding`, it
prints up to three prompts for the highest-priority non-suppressed findings.
Pass a rule ID or exact finding fingerprint to print one prompt. This command
does not re-run analysis.

## Check a workspace

Build each app with its MFDoctor adapter first so it emits
`.mf/doctor/project.json`, then run one cross-project gate:

```bash
mfdoctor workspace
mfdoctor workspace apps packages --format terminal,json,sarif
mfdoctor workspace apps packages --group checkout
```

- With no roots, `workspace` searches below the current directory.
- Positional values such as `apps packages` are discovery roots.
- Discovery looks for `**/.mf/doctor/project.json` beneath each root.
- `--group checkout` includes only projects assigned to that explicit
  `federationGroup`, which keeps independent federation graphs separate.

Override the discovery layout only when the defaults do not fit:

```bash
mfdoctor workspace --glob "packages/*/.mf/doctor/project.json"
```

Quote globs so the CLI—not the shell—expands them consistently.

## Check a federation

Use `federation --workspace` when you want to spell out that workspace
discovery feeds federation analysis. It runs the same discovery and analysis
path as `workspace`:

```bash
mfdoctor federation --workspace
mfdoctor federation --workspace apps packages --format terminal,json,sarif
mfdoctor federation --workspace apps packages --group checkout
```

For a hand-tuned CI layout, pass one or more quoted `project.json` patterns
without `--workspace`:

```bash
mfdoctor federation ".mf/doctor/**/project.json"
mfdoctor federation ".mf/doctor/**/project.json" --baseline ./mfdoctor.baseline.json
```

Use `workspace` for normal monorepo discovery. Use explicit `federation` globs
when the reports live in a custom location or CI has already selected an exact
set of project files.

## Manage a baseline

All three commands read `.mf/doctor/report.json` and write
`mfdoctor.baseline.json` by default. The explicit forms are:

```bash
mfdoctor baseline generate .mf/doctor/report.json --out mfdoctor.baseline.json
mfdoctor baseline update .mf/doctor/report.json --out mfdoctor.baseline.json
mfdoctor baseline prune .mf/doctor/report.json --out mfdoctor.baseline.json
```

| Action     | Effect                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `generate` | Replace the output with the unique current finding fingerprints.                                   |
| `update`   | Add new current fingerprints while retaining existing entries. A missing output file starts empty. |
| `prune`    | Remove entries that no longer match the current report. It requires an existing baseline.          |

Review baseline changes like code. Do not automatically update the baseline on
every CI run, because that would silently accept new debt.

## Correlate a runtime trace

```bash
mfdoctor runtime ./trace.json
mfdoctor runtime ./trace.json ".mf/doctor/**/project.json" --format terminal,json
```

`runtime` reads a user-supplied Module Federation Observability export and
correlates it with local MFDoctor project facts. Project files default to
`.mf/doctor/**/project.json`. You may instead set `runtimeTrace` in
`mfdoctor.config` and omit the trace path.

MFDoctor never fetches URLs found in a trace and never executes remote
JavaScript. It collapses trace URLs to origin plus basename and redacts token,
cookie, authorization, password, and secret fields before emitting findings.

## Inspect the rule catalog

```bash
mfdoctor rules
mfdoctor rules config/name-required
```

With no rule ID, `rules` prints the machine-readable built-in catalog as JSON.
With one ID, it prints that rule's default severity, category, impact, fix,
supported bundlers, docs path, and official sources. An unknown rule exits `2`.

## Probe a deployed manifest

```bash
mfdoctor probe https://cdn.example.com/mf-manifest.json
mfdoctor probe http://localhost:3001/mf-manifest.json --remote-entry
```

`probe` and `compare` are the only commands that make a network request. It downloads the
manifest, validates that it looks like a federation manifest, and prints a
small JSON summary. Query strings are removed from output so signed URLs do not
leak into logs.

`--remote-entry` sends a `HEAD` request to the entry named by the manifest and
reports its status, content type, and size. MFDoctor does not download or execute
that JavaScript.

Safety defaults:

- HTTPS is required, except for an initial localhost or loopback URL.
- The timeout is 10 seconds; override it with `--timeout 5000`.
- The manifest limit is 2 MiB; override it with `--max-bytes 1000000`.
- Redirects are revalidated at every hop and limited to five.
- Private, link-local, loopback, and cloud-metadata targets are blocked by the
  public CLI probe.
- URLs containing user names or passwords are rejected.

An unreachable or invalid target exits `2`. A valid manifest whose requested
remote entry returns an HTTP error exits `1`.

## Compare deployed manifests

```bash
mfdoctor compare https://cdn.example.com/mf-manifest.json https://canary.example.com/mf-manifest.json
mfdoctor compare https://a.example/mf-manifest.json https://b.example/mf-manifest.json --remote-entry --format json,sarif
```

`compare` reuses the same network policy as [`probe`](#probe-a-deployed-manifest):
HTTPS (loopback HTTP only for the initial URL), SSRF blocking, redirect
revalidation, timeout, and size limits. It never downloads or executes remote
JavaScript. `--remote-entry` adds a `HEAD` check so remote entry HTTP status is
part of the diff.

The first URL is the baseline. Each remaining URL is a candidate. Diffs cover
`name`, `exposes`, `shared` (name and version), `publicPath`, `remoteEntry`, and
optional `remoteEntryStatus`.

Exit codes: `0` no material diff, `1` diffs found, `2` usage or fetch error.
With `--format`, JSON lands at `.mf/doctor/compare.json` and SARIF at
`.mf/doctor/compare.sarif`. Without `--format`, a human summary prints to
stdout.

## Exit codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| `0`  | Analysis completed and the active policy passed, or compare found no material diff.              |
| `1`  | Findings failed policy, a requested remote entry returned an HTTP error, or compare found diffs. |
| `2`  | Usage arguments, missing inputs, incomplete analysis, an unknown rule, or another hard failure.  |

## GitHub Actions

Host teams copy this consumer workflow — ordinary Node + your package manager.
It does **not** use Vite Plus, `vp`, or this repository's `setup-vp` action.

Run the workspace gate only after every federated app that registers an
MFDoctor adapter has built (so `.mf/doctor/project.json` facts exist). Pin the
Action to a **release tag** (not `@main`) so CI stays reproducible:

```yaml
name: MFDoctor

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  security-events: write

jobs:
  federation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      # Production build for each host/remote that registers an MFDoctor adapter.
      - run: pnpm run build

      - uses: tonoizer/module-federation-doctor/.github/actions/workspace-federation-gate@1.1.0
        with:
          roots: .
          cli: pnpm exec mfdoctor
          formats: terminal,json,sarif
```

npm or Yarn work the same way: install with `npm ci` / `yarn install --frozen-lockfile`,
build with your usual script, then set `cli: npx mfdoctor` or `cli: yarn mfdoctor`.

The Action **requires** a runnable `mfdoctor` / `@tonoizer/mfdoctor` CLI (via the
`cli` input). Missing CLI is a hard failure. If the job has not installed the
package yet, set `install: true` (optionally with `package-spec:
@tonoizer/mfdoctor@1.1.0`).

`upload-sarif` defaults to `true` and needs `permissions.security-events: write`.
If that permission is missing, the Action fails with an actionable error instead
of a quiet upload miss. Set `upload-sarif: "false"` when you do not want code
scanning upload.

A ready-to-copy file lives at
[`examples/ci/github-actions-mfdoctor.yml`](https://github.com/tonoizer/module-federation-doctor/blob/main/examples/ci/github-actions-mfdoctor.yml).

Optional action inputs are `build-command`, `globs`, `install`, `package-spec`,
`upload-sarif`, and `upload-artifact`. You can also skip the Action and run the
CLI directly:

```bash
pnpm exec mfdoctor workspace --format terminal,json,sarif
```

Upload `.mf/doctor/results.sarif` with `github/codeql-action/upload-sarif` when
code scanning is enabled.
