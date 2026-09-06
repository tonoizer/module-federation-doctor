# `shared/package-path-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

`shared[pkg].packagePath` redirects where the bundler reads the shared package (version, singleton fallback). A path that is missing on disk makes version/singleton negotiation fail at build or runtime with no other MFDoctor finding.

## How to fix it

Point `packagePath` at an existing package directory or entry file (relative to the project root, or an absolute path). Remove the field when Node module resolution should be used instead. Unknown bundlers skip this check rather than inventing a disk finding.

Suppress or retarget with `rules["shared/package-path-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://github.com/originjs/vite-plugin-federation/blob/main/README.md)
