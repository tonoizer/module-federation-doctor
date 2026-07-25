# Security Policy

## Supported versions

Security fixes are accepted for the latest published release of
`@module-federation/doctor` on the `main` branch.

## Reporting a vulnerability

Please **do not** open a public issue for security reports.

Prefer GitHub's private vulnerability reporting for this repository:

https://github.com/tonoizer/module-federation-doctor/security/advisories/new

If that is unavailable, email **hey@kevinbeier.com** with:

- a short description of the issue
- steps to reproduce or a proof of concept
- affected versions or commit hashes, if known
- any suggested fix

You should receive an acknowledgment within a few days. After triage we will
confirm whether the report is accepted, share a remediation plan when possible,
and credit reporters who want to be named.

## Scope notes

`check` and `federation` are offline analyzers. `probe` makes explicit network
requests but never executes remote JavaScript. See
[Security and privacy](https://github.com/tonoizer/module-federation-doctor/blob/main/apps/docs/docs/security.md)
for product privacy behavior. Reports about dependency advisories are welcome when they affect this
package's published surface; please include the advisory ID.
