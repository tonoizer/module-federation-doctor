---
"@tonoizer/mfdoctor": major
---

Stop re-exporting migrated rule-group id arrays (`MIGRATED_GROUP1_*` … `MIGRATED_GROUP6_RULE_IDS`) from the `@tonoizer/mfdoctor` root entry. The arrays remain in `src/rule-inventory.ts` for evidence bridges and tests. This is a breaking change for anyone who imported those symbols from the public package root.
