# Security Policy

## Supported versions

Before the first public release, security fixes target `main`. After release,
security fixes are accepted for the latest published `@tonoizer/mfdoctor`
version and `main`.

## Reporting a vulnerability

Do **not** open a public issue for a security report. Prefer GitHub's private
vulnerability reporting:

https://github.com/tonoizer/module-federation-doctor/security/advisories/new

If that is unavailable, email **hey@kevinbeier.com** with:

- a short description of the issue;
- steps to reproduce or a proof of concept;
- affected versions or commit hashes, if known;
- any suggested fix.

You should receive an acknowledgment within a few days. After triage, we will
confirm whether the report is accepted, share a remediation plan when possible,
and credit reporters who want to be named.

## Privacy and network behavior

`check`, `federation`, and `runtime` are offline. They never collect source
bodies, environment values, request headers, cookies, or secrets. Reports
redact URL credentials, auth-like keys, tokens, and absolute user paths. Review
reports before sharing because package names, import names, and federation
topology remain project metadata.

`runtime` only reads a user-supplied Observability Plugin export from disk. It
does not fetch URLs in the trace or execute remote JavaScript. Imported traces
redact token, cookie, authorization, password, and secret fields, and reduce
private URLs before correlation evidence is written.

`probe` is an explicit network action. It accepts HTTPS and local-development
HTTP, limits redirects, time, and response size, and never executes a remote
entry. Redirect targets are revalidated to block private, link-local, loopback,
and cloud-metadata hosts unless the probe API explicitly opts into private
networks. The requested server can still see the caller's IP address and normal
HTTP metadata.

Dependency advisories are in scope when they affect the published package
surface; include the advisory ID in the report.
