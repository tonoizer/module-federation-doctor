<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `security/get-public-path-dynamic-code`

- Kategorie: **security**
- Standardschweregrad: **warning**

## Problem

Module Federation evaluates this string with `new Function` in the consumer.

## So beheben Sie das Problem

Keep it static, review it as code, and never concatenate untrusted data.

Suppress or retarget with `rules["security/get-public-path-dynamic-code"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/getpublicpath.html)
