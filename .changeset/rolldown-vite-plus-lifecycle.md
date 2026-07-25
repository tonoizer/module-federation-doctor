---
"@module-federation/doctor": minor
---

Extend the Vite adapter for Rolldown and Vite Plus emit lifecycles: detect
flavor/engine with strong signals only, prefer on-disk assets with
`closeBundle` fallback, and record honest `doctor/partial-analysis` when emit
facts are missing. Matrix status stays **partial** until a real smoke build
lands in CI.
