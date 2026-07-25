---
"@module-federation/doctor": minor
---

Complete v1 dynamic-import analysis: resolve string-literal `import()` /
`loadRemote` / `loadShare*` / `registerRemotes` patterns, merge opt-in runtime
trace and manifest remote hints into import facts, prefer
`doctor/partial-analysis` over false `shared/unused` certainty, and document the
supported completeness bar.
