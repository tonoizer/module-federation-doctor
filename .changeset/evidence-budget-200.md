---
"@tonoizer/mfdoctor": patch
---

Bound imported evidence processing before copying, normalization, and hashing
with shared analysis node and raw UTF-8 serialized-byte budgets. Throw a typed
reader error with a budget report on overflow, preserve partial/unknown
semantics in the rule runner, report all exceeded limits, and make optional
legacy projections atomic without silently truncating v1 output.
