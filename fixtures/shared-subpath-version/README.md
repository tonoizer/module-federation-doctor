# `shared/subpath-version-unresolved` fixtures

Vite prefix and package-subpath shared keys inherit provider `version` from the
parent package (`@module-federation/vite` `normalizeSharedKey` /
`searchPackageVersion`). When that inheritance fails, the shared entry can ship
with `version: undefined` and break runtime share matching.

| Directory     | Expectation                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| `unresolved/` | Prefix/subpath shares without a resolvable parent version → finding         |
| `resolved/`   | Parent installed, explicit `version`, or concrete `requiredVersion` → quiet |

Non-Vite bundlers are out of scope for this rule (false-positive bound).
