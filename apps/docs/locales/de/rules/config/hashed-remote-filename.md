<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/hashed-remote-filename`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Hashed remote entry filenames invalidate consumer URLs whenever the producer rebuilds. Webpack/Rspack `[contenthash]` in Module Federation `filename`, or in `output.filename` when the container filename is unset, has the same effect as Vite `[hash]`.

## So beheben Sie das Problem

Use a stable Module Federation `filename` such as `remoteEntry.js`. Keep hashing on chunk filenames instead of the container entry.

Suppress or retarget with `rules["config/hashed-remote-filename"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/filename.html)
- [Official source](https://webpack.js.org/configuration/output/#outputfilename)
