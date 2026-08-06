# `doctor/partial-analysis`

- Category: **tooling**
- Default severity: **warning**

## Issue

Missing facts, unresolved dynamic imports, or an evidence budget cutoff reduce
confidence and can hide relevant findings.

## How to fix it

When MF options are missing, pass them explicitly. On Vite, missing `mf-manifest.json` / `mf-stats.json` usually means enable `manifest: true` — not missing options. Prefer string-literal dynamic imports or an opt-in runtime trace when analysis is incomplete.

Suppress or retarget with `rules["doctor/partial-analysis"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

The `analysisBudgets.maxEvidenceNodes` and
`analysisBudgets.maxSerializedBytes` limits apply before imported evidence is
copied, normalized, or hashed. Nodes count JSON values; serialized bytes are
the UTF-8 size of the raw JSON representation, including keys and separators.
When either limit is exceeded, the reader throws an `EvidenceReaderError` with
`failureCode: "budget-exceeded"` and a deterministic budget `report`; it does
not return a partial graph. The rule runner may instead return `unknown`
evaluations with `partial` completeness when normalization or rule execution is
clipped. All exceeded limits are reported deterministically. The reservation is
atomic, so a rejected document does not consume part of either limit.

Legacy projection helpers accept an optional `analysisBudget`. They reserve the
normalized graph and complete projected document as separate atomic units and
throw on overflow instead of returning a truncated v1 report.

## Sources

- [Official source](https://module-federation.io/configure/index.html)
