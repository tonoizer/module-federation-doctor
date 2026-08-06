# Analysis budget fixtures

These small, medium, and large source trees are used to prove deterministic
file, byte, artifact, and evidence cutoffs without involving runtime collection.

Run the checked-in benchmark matrix after building with:

```sh
pnpm benchmark:analysis -- --output analysis-cost-results.json
```

The command runs the actual v1 collector under the legacy, shadow, and
v2-compat rollout-controller selections. It records wall time, RSS, budget
usage, bounded-cache hits/misses, repeated-run parity, and an optional
`readEvidenceFile` seam measurement with evidence-node and serialized-byte
budgets.
`v2-compat` is only the result of promoting the controller after all release
gates; it does not claim that a separate v2 collector exists. The mixed
Vite/Rspack/Rsbuild/Webpack coverage belongs to the existing compatibility
matrix, not this source-only benchmark. Limits are kept in
`benchmarks/analysis-cost-baseline.json`.
