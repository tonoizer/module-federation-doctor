---
"@tonoizer/mfdoctor": major
---

Stop re-exporting finding-lineage and governance-waiver helpers (`createFindingLineage`, `defineGovernanceWaiver`, history diffs, and related types) from the `@tonoizer/mfdoctor` root entry. The modules and JSON Schema contracts remain in source for tests and library consumers; the CLI, including `mfdoctor baseline`, is unchanged. This is a breaking change for anyone who imported those symbols from the public package root.
