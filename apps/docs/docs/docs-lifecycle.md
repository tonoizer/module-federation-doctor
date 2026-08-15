---
title: Documentation lifecycle
description: Release, language, and API-reference ownership rules for MFDoctor documentation.
---

# Documentation lifecycle

MFDoctor keeps one canonical documentation surface: the English content at
`mfdoctor.kevinbeier.com`. Release metadata, localization, and API references
must be backed by maintained inputs before they become new navigation surfaces.

## Release-backed version indicator

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

## Language policy

English is the canonical language and `@tonoizer` is the maintainer for its
technical accuracy. German and other translations are intentionally deferred
until a translator owner, review path, and parity check exist. No language
selector or partially translated route should be added before then.

When a translation is accepted, it must have:

- a named owner and a review date;
- parity with the canonical page set, including CLI flags, schemas, and rule links;
- canonical and alternate links that resolve in the production build;
- a documented policy for keeping release-specific examples current.

## API reference policy

The [public API surface](./api.md) is generated from `package.json#exports` and
checked in the docs build. It lists every runtime and JSON Schema entry point
without inventing a hand-maintained symbol catalog. A detailed symbol-level
reference can be added later only when it is generated from published
declarations and contract-tested against those exports; an empty API tab is not
an acceptable placeholder.

## Ownership and update rules

| Surface                            | Owner                                    | Update trigger                             | Required proof                            |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Canonical English guides and rules | `@tonoizer`                              | Feature, rule, or release behavior changes | Docs build and link checks                |
| Release indicator                  | Release workflow + `@tonoizer`           | Package version or GitHub release changes  | Package semver and exact release tag link |
| Translations                       | Named translator with `@tonoizer` review | Canonical page changes                     | Content parity and production link checks |
| API surface catalog                | Package export map                       | Public entry-point changes                 | Generated-doc drift check                 |
