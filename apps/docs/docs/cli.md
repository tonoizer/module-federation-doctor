# CLI and CI

The **build plugin** is the primary DX. Use the CLI for offline checks,
cross-project federation analysis, runtime trace correlation, and deployed
manifest probes. Architecture lock:
[plugin primary / CLI complementary](./adr/hybrid-plugin-cli.md)
(not CLI-only, not an in-browser agent).

```bash
mfdoctor check
mfdoctor check packages/host --ci
mfdoctor check --format terminal,json,sarif
mfdoctor check --baseline ./mfdoctor.baseline.json
mfdoctor check --verbose
mfdoctor check --no-score
mfdoctor check --no-prompt
mfdoctor check --prompt
mfdoctor check --diagnostics-dir .mf/doctor/diagnostics
mfdoctor prompt --finding config/name-required
mfdoctor workspace
mfdoctor workspace apps packages --format terminal,json,sarif
mfdoctor federation --workspace
mfdoctor federation --workspace apps packages --format terminal,json,sarif
mfdoctor federation ".mf/doctor/**/project.json"
mfdoctor federation ".mf/doctor/**/project.json" --baseline ./mfdoctor.baseline.json
mfdoctor baseline generate .mf/doctor/report.json --out mfdoctor.baseline.json
mfdoctor baseline update .mf/doctor/report.json --out mfdoctor.baseline.json
mfdoctor baseline prune .mf/doctor/report.json --out mfdoctor.baseline.json
mfdoctor runtime ./trace.json
mfdoctor runtime ./trace.json ".mf/doctor/**/project.json" --format terminal,json
mfdoctor rules
mfdoctor rules config/name-required
mfdoctor probe https://cdn.example.com/mf-manifest.json
mfdoctor probe http://localhost:3001/mf-manifest.json --remote-entry
```

Doctor loads optional `mfdoctor.config.ts`; flags win over config. Use
`extends` for [named presets and shareable policy packs](./policy-packs.md).
`check`, `workspace`, and `federation` exit `0` when policy passes, `1` for
policy findings, and `2` when analysis cannot finish (invalid args, no matching
`project.json`, or a hard failure). `check`, `workspace`, and `federation` make
no network requests. `runtime` also stays offline: it only reads a
user-supplied Observability export and local `project.json` files.

## Quiet success and terminal format

By default Doctor prints **nothing** when there are zero findings (agent-friendly
quiet success). Restore the green success line with any of:

- CLI `--verbose`
- `printLog: { success: true }` / `quiet: false` in config or plugin options
- `MFDOCTOR_QUIET=0` (env wins over config; `MFDOCTOR_QUIET=1` forces quiet)

When findings exist, the terminal block includes severity, rule id, message, a
short fix, the Doctor rule docs URL, and official `module-federation.io` sources
when available. After the counts line, Doctor prints a colorized health score
footer (`Score: N/100 (Great|OK|Needs work)`), then up to three copy-paste agent
fix prompts (highest severity/impact first; suppressed findings skipped). Hide
the score with `--no-score` / `score: false`, or the prompts with `--no-prompt` /
`prompt: false`. Report JSON still includes `summary.score` /
`summary.scoreLabel`. Pure JSON/SARIF output (no `terminal` format) skips both
footers. See [Report schemas](./report-schemas.md) for the score formula.

### Offline prompts and diagnostics dump

```bash
mfdoctor prompt --finding <fingerprint|ruleId> [.mf/doctor/report.json]
mfdoctor prompt [.mf/doctor/report.json]
mfdoctor check --diagnostics-dir .mf/doctor/diagnostics
```

`mfdoctor prompt` reads a saved report offline and prints one finding prompt
(`--finding`) or the top three. `--diagnostics-dir` writes a root-contained
folder with `report.json`, `prompts/*.md`, and `summary.md` (score + top
findings). Paths outside the project root are rejected. Adapters share this
single print path — they do not also push per-finding bundler warnings.

## Workspace federation gate

After each app builds with the Doctor plugin, run the one-shot workspace gate:

```bash
mfdoctor workspace
mfdoctor federation --workspace apps packages
```

Defaults discover `**/.mf/doctor/project.json` under the given roots (cwd when
omitted). Override discovery with `--glob` when you need a manual layout:

```bash
mfdoctor workspace --glob "packages/*/.mf/doctor/project.json"
mfdoctor federation --workspace examples/showcase/federation/version-conflict --glob "*.project.json"
```

Explicit `federation` globs without `--workspace` remain the escape hatch for
hand-tuned CI:

```bash
mfdoctor federation ".mf/doctor/**/project.json"
```

## Fingerprint baselines

For incremental CI adoption, check in a fingerprint baseline so known debt does
not block `failOn` while new findings still fail. See
[Fingerprint baselines](./baselines.md) and
[Suppressions and allowlists](./suppressions.md).

```bash
mfdoctor baseline generate .mf/doctor/report.json --out mfdoctor.baseline.json
mfdoctor check --ci --baseline ./mfdoctor.baseline.json
```

Suppressed findings still appear in reports (marked suppressed) but do not fail
policy unless `baseline.failOnSuppressed` is true. Baselines are tracked debt —
prune them as findings are fixed.

## CI auto-detect

Doctor enables CI defaults automatically when the environment looks like CI
(`CI=true` / `CI=1`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, Jenkins,
Azure Pipelines, and similar). No `mode: "ci"` is required in plugin config.

When CI is detected (or you pass `--ci` / `mode: "ci"`):

- `failOn` defaults to `"error"`
- output formats default to `terminal`, `json`, and `sarif`

Local development defaults to `failOn: "never"` so findings still print without
breaking the build. Override with `failOn: "warning" | "error" | "never"`, or
force local defaults in CI with `mode: "development"`.

`rules` prints the machine-readable built-in rule catalog. Pass one rule id to
get its default severity, category, impact, fix, supported bundlers, docs path,
and official sources.

## Runtime trace import

`runtime` is an explicit opt-in path for correlating browser Observability Plugin
reports with Doctor project facts. Pass a JSON export (`exportReport`,
`.mf/observability/latest.json`, or an array/`reports` wrapper). Project globs
default to `.mf/doctor/**/project.json`. You can also set `runtimeTrace` in
`mfdoctor.config` when the CLI path is omitted. The same `runtimeTrace` option
on bundler/`check` Doctor options merges shared and remote hints into import
facts for dynamic-import recall without changing offline defaults when unset.

Doctor never fetches URLs found in the trace and never executes remote
JavaScript. Trace URLs are collapsed to origin plus basename, and token, cookie,
authorization, password, and secret fields are redacted before findings are
emitted.

See `examples/showcase/runtime/green` (exit 0) and
`examples/showcase/runtime/shared-mismatch` (exit 1) for offline demos.

## Deployed manifest probe

`probe` is the only command that uses the network. It downloads a deployed
manifest, checks that it looks like a federation manifest, and prints a small
JSON summary. Query strings are removed from the output, so signed URLs do not
leak into logs.

Use `--remote-entry` to send a `HEAD` request to the entry named by the
manifest. Doctor reports its status, content type, and size. It does not
download or run that JavaScript.

Safety defaults:

- HTTPS is required, except HTTP on the initial localhost/loopback URL.
- The manifest timeout is 10 seconds. Change it with `--timeout 5000`.
- The manifest size limit is 2 MiB. Change it with `--max-bytes 1000000`.
- Redirects are re-validated each hop and limited to five. Redirect targets
  do not inherit the initial HTTP-localhost exception.
- Private, link-local, loopback, and cloud-metadata hosts are blocked unless
  the probe API sets `allowPrivateNetworks`.
- URLs with embedded user names or passwords are rejected.

An unreachable target or invalid response exits 2. A reachable remote entry
with an HTTP error exits 1.

## GitHub Actions

Reuse the composite action after each federated app has emitted
`.mf/doctor/project.json`:

```yaml
permissions:
  contents: read
  security-events: write

jobs:
  federation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter './apps/docs' build
      - uses: tonoizer/module-federation-doctor/.github/actions/workspace-federation-gate@main
        with:
          roots: .
          cli: pnpm exec mfdoctor
          formats: terminal,json,sarif
```

Optional inputs: `build-command` (run builds inside the action), `globs` (manual
discovery escape hatch), `upload-sarif` / `upload-artifact`.

You can also call the CLI directly and upload `.mf/doctor/results.sarif` with
`github/codeql-action/upload-sarif` when code scanning is enabled.
