---
"@tonoizer/mfdoctor": patch
---

Do not default omitted `shareStrategy` to `version-first` when comparing federation hosts. Omitted vs omitted stays quiet; omitted vs an explicit strategy is a mismatch. Single-project version-first rules still use the runtime default.
