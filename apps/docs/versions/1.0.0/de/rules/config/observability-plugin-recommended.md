<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/observability-plugin-recommended`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

Module Federation 2.5+ projects can opt into runtime health correlation, but a declared Observability Plugin is ineffective until its runtime entry is registered. The default nudge requires the package to be present; the production profile can recommend it for every supported federated surface.

## So beheben Sie das Problem

Add `@module-federation/observability-plugin` and register its browser/runtime entry through `runtimePlugins` or the runtime `plugins` option. The build-only `/build` entry does not provide runtime reporting. Use `off` or a fingerprint baseline when this environment intentionally does not collect runtime reports.

Suppress or retarget with `rules["config/observability-plugin-recommended"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
- [Official source](https://module-federation.io/configure/runtimeplugins.html)
