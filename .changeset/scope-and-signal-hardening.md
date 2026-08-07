---
"@module-federation/doctor": minor
---

Add explicit federation groups for workspace analysis and a `--group` CLI
scope, so independent fixtures and deliberately separate graphs do not have to
share federation-wide comparisons. Improve workspace documentation and add a
machine-readable compatibility matrix for local production cells and pinned
upstream validation.

Reduce noisy diagnostics by emitting one actionable manifest warning for
disabled Vite manifests, making Vite server-origin and manual-chunk guidance
advisory by default, and deduplicating overlapping shared assets in performance
budget findings.
