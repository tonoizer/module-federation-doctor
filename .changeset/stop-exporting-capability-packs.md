---
"@tonoizer/mfdoctor": major
---

Stop re-exporting unused capability-pack helpers (`queryCapability`, `resolveCapabilityPack`, `BUILT_IN_CAPABILITY_PACKS`, and related types) from the `@tonoizer/mfdoctor` root entry. The tables remain in source for review and unit tests; the engine, CLI, and adapters never queried them. This is a breaking change for anyone who imported those symbols from the public package root.
