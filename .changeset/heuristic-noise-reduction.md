---
"@tonoizer/mfdoctor": patch
---

Reduce false-positive noise from soft heuristic rules: default
`shared/candidate` and `config/implementation-suspicious` to `info`, keep them
advisory under `strict`, document the suppress path, and add showcase fixtures
for intentional `"off"` mutes plus unresolved-dynamic `doctor/partial-analysis`
instead of confident `shared/unused`.
