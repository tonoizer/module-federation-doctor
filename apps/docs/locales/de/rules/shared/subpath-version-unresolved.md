<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `shared/subpath-version-unresolved`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

On Vite, prefix and package-subpath shared keys inherit provider `version` from the parent package. When that resolution fails, the shared entry ships with `version: undefined`, which breaks singleton / `requiredVersion` matching and can crash remotes that expect the host to provide the share.

## So beheben Sie das Problem

Set an explicit `version` (or a concrete `requiredVersion` such as `"^19.1.0"`) on the prefix/subpath shared key, or ensure the parent package is installed so `@module-federation/vite` can inherit its version. Non-Vite adapters are out of scope for this rule.

Suppress or retarget with `rules["shared/subpath-version-unresolved"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://github.com/module-federation/vite/blob/main/src/utils/normalizeModuleFederationOptions.ts)
