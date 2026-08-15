---
title: Lebenszyklus der Dokumentation
description: Regeln für Releases, Sprachen und Zuständigkeiten der MFDoctor-Dokumentation.
---

<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Lebenszyklus der Dokumentation

MFDoctor keeps one canonical documentation surface: the English content at
`mfdoctor.kevinbeier.com`. Release metadata, localization, and API references
are backed by maintained inputs before they become navigation surfaces.

## Release-basierter Versionshinweis

The header version link is generated from the repository root `package.json`.
It displays the current package version and points to the exact matching GitHub
release tag. The same version is published at the
[`@tonoizer/mfdoctor` npm package](https://www.npmjs.com/package/@tonoizer/mfdoctor).

The release workflow owns the invariant:

1. the Changesets release PR updates `package.json`;
2. the merged version is published to npm;
3. the matching GitHub release tag is created;
4. the docs deployment exposes that version link.

The docs build rejects a missing or non-semver package version rather than
rendering a guessed label.

## Sprachrichtlinie

English is the canonical language and `@tonoizer` is the maintainer for its
technical accuracy. German is published alongside English and is maintained by
`@tonoizer` under the same release gate. The language selector is enabled only
when every canonical page has a matching German route.

Each published translation must have:

- a named owner and a release review;
- parity with the canonical page set, including CLI flags, schemas, and rule links;
- canonical and alternate links that resolve in the production build;
- a documented policy for keeping release-specific examples current.

Technical identifiers, CLI flags, rule IDs, schemas, links, and code examples
remain contract-identical across languages. German UI labels and explanatory
copy are reviewed with the release; the parity check prevents a German route
from silently disappearing when an English page is added.

## Richtlinie für die API-Referenz

The [public API surface](./api.md) is generated from `package.json#exports` and
checked in the docs build. It lists every runtime and JSON Schema entry point
without inventing a hand-maintained symbol catalog. A detailed symbol-level
reference can be added later only when it is generated from published
declarations and contract-tested against those exports; an empty API tab is not
an acceptable placeholder.

## Zuständigkeiten und Aktualisierungsregeln

| Surface                            | Owner                          | Update trigger                             | Required proof                            |
| ---------------------------------- | ------------------------------ | ------------------------------------------ | ----------------------------------------- |
| Canonical English guides and rules | `@tonoizer`                    | Feature, rule, or release behavior changes | Docs build and link checks                |
| Release indicator                  | Release workflow + `@tonoizer` | Package version or GitHub release changes  | Package semver and exact release tag link |
| German translation                 | `@tonoizer`                    | Canonical page changes                     | Content parity and production link checks |
| API surface catalog                | Package export map             | Public entry-point changes                 | Generated-doc drift check                 |
