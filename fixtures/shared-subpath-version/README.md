# `shared/subpath-version-unresolved` fixtures

Vite prefix and package-subpath shared keys inherit provider `version` from the
parent package (`@module-federation/vite` `normalizeSharedKey` /
`searchPackageVersion`). When that inheritance fails, the shared entry can ship
with `version: undefined` and break runtime share matching.

| Directory           | Expectation                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `unresolved/`       | Vite prefix/subpath shares without a resolvable parent version → finding     |
| `resolved/`         | Parent installed, explicit `version`, or concrete `requiredVersion` → quiet  |
| `enhanced-rspack/`  | Enhanced: prefix-share-recommended on deep imports; unresolved-version quiet |
| `enhanced-webpack/` | Same as `enhanced-rspack/` for webpack                                       |

`shared/subpath-version-unresolved` is Vite-only (`@module-federation/vite`
`normalizeSharedKey` / `searchPackageVersion`). Webpack and Rspack Enhanced
prefix/`react/` keys do not inherit a parent provider version — do not copy the
Vite fix onto those bundlers. `shared/prefix-share-recommended` remains
all-bundler and still fires when observed `react/...` imports are uncovered.
