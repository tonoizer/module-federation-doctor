---
"@tonoizer/mfdoctor": patch
---

Add additive `report.status` with stable `incompleteReasons[]` codes (`missing-emit`, `partial-bundler`, `probe-skipped`, `evidence-unknown`). Complete runs use an empty list. Does not change rule evaluation or exit codes.
