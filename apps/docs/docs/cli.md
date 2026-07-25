# CLI and CI

The **build plugin** is the primary DX. Use the CLI for offline checks,
cross-project federation analysis, runtime trace correlation, and deployed
manifest probes.

```bash
mfdoctor check
mfdoctor check packages/host --ci
mfdoctor check --format terminal,json,sarif
mfdoctor federation ".mf/doctor/**/project.json"
mfdoctor runtime ./trace.json
mfdoctor runtime ./trace.json ".mf/doctor/**/project.json" --format terminal,json
mfdoctor rules
mfdoctor rules config/name-required
mfdoctor probe https://cdn.example.com/mf-manifest.json
mfdoctor probe http://localhost:3001/mf-manifest.json --remote-entry
```

Doctor loads optional `mfdoctor.config.ts`; flags win over config. Use
`extends` for [named presets and shareable policy packs](./policy-packs.md).
`check` exits 0 when policy passes, 1 for policy findings, and 2 when analysis
cannot finish. `check` and `federation` make no network requests. `runtime` also
stays offline: it only reads a user-supplied Observability export and local
`project.json` files.

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

- HTTPS is required, except HTTP on localhost.
- The manifest timeout is 10 seconds. Change it with `--timeout 5000`.
- The manifest size limit is 2 MiB. Change it with `--max-bytes 1000000`.
- Redirects are checked and limited to five.
- URLs with embedded user names or passwords are rejected.

An unreachable target or invalid response exits 2. A reachable remote entry
with an HTTP error exits 1.

## GitHub Actions

Upload `.mf/doctor/results.sarif` with
`github/codeql-action/upload-sarif` when code scanning is enabled.
