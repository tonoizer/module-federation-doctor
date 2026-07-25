# CLI and CI

```bash
mfdoctor check
mfdoctor check packages/host --ci
mfdoctor check --format terminal,json,sarif,html
mfdoctor check --ui
mfdoctor check --ui --ui-port 51205
mfdoctor federation ".mf/doctor/**/project.json"
mfdoctor federation ".mf/doctor/**/project.json" --ui
mfdoctor rules
mfdoctor rules config/name-required
mfdoctor probe https://cdn.example.com/mf-manifest.json
mfdoctor probe http://localhost:3001/mf-manifest.json --remote-entry
```

Doctor loads optional `mfdoctor.config.ts`; flags win over config. `check` exits
0 when policy passes, 1 for policy findings, and 2 when analysis cannot finish.
`check` and `federation` make no network requests.

`--ui` is supported on `check` and `federation`. It ensures HTML output is
written, serves the portable dashboard on `127.0.0.1`, and opens a browser.
Change the port with `--ui-port`. The UI server is read-only and loopback-bound.

`rules` prints the machine-readable built-in rule catalog. Pass one rule id to
get its default severity, category, impact, fix, supported bundlers, docs path,
and official sources.

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
