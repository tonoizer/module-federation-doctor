---
"@tonoizer/mfdoctor": major
---

Stop re-exporting unused identity factories (`createOrganizationIdentity`, `createIdentity`, `canonicalIdentityKey`, and the other per-kind helpers) from the `@tonoizer/mfdoctor` root entry. Keep `createApplicationIdentity`, `unknownIdentity`, `IDENTITY_SCHEMA_VERSION`, and `IdentityValidationError` plus the runtime-identity types used by the engine/CLI path. Remaining factories stay in `src/identity.ts` for tests. This is a breaking change for anyone who imported the dropped symbols from the public package root.
