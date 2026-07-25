# Monorepos

Run `mfdoctor check` once per federation project with that project as root. Then
run `mfdoctor federation` over all generated `project.json` files. This checks
version ranges, providers, singleton choices, and share scopes across projects.
