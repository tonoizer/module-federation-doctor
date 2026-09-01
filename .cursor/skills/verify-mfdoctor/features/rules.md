# Rules

`mfdoctor rules` prints the built-in rule catalog (or one rule’s metadata) as machine-readable JSON. Users and agents use it to inspect default severity, category, impact, and docs without running analysis.

## Sub-features

- `rules-catalog` lists all built-in rules when no ID is passed.
- `rules-one` prints metadata for a single rule ID.
- `rules-unknown` exits `2` for an unknown rule ID.

## How to get to it (user POV)

- `pnpm exec mfdoctor rules`
- `pnpm exec mfdoctor rules config/name-required`
- From this checkout: `node dist/cli.js rules`

## Driving it with the mfdoctor CLI

Preconditions:

- Doctor passed.
- Offline; no project path required for the catalog.

- **List catalog.** Run `node dist/cli.js rules`. Exit `0`. Stdout JSON includes `schemaVersion` and a `rules` collection.
- **Inspect one rule.** Run `node dist/cli.js rules config/remote-http-insecure`. Exit `0`. Output describes that rule’s severity/category/docs.
- **Unknown ID.** Run `node dist/cli.js rules definitely/not-a-rule`. Exit `2`.
- **Proof.** Save catalog or single-rule stdout under
  `.cursor/skills/verify-mfdoctor/evidence/rules/` (truncate huge catalogs if needed, but keep schemaVersion + a sample rule ID).

## Gotchas

- Catalog output can be large — evidence may store a head excerpt plus `ruleCount` if full JSON is unwieldy, but prefer full JSON when practical.
- `rules` does not analyze a project; pairing with `check` is a separate feature proof.
- Do not confuse suppressed showcase cases (`rules["…"] = "off"` in fixture config) with catalog defaults.
