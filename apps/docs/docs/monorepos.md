# Monorepos

Run `mfdoctor check` once per federation project with that project as root. Then
run `mfdoctor federation` over all generated `project.json` files. This checks
version ranges, providers, singleton choices, and share scopes across projects.

Share org policy with a workspace package (or path) and `extends` — see
[policy packs and presets](./policy-packs.md). Example fixture:
`fixtures/policy-packs/acme-mfdoctor-policy`.
