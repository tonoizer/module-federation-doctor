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

The benchmark also analyzes the checked-in `fixtures/workspaces/clean` and
`fixtures/workspaces/conflict` monorepo-style project facts. Its normalized semantic
results are committed in `benchmarks/analysis-cost-expected.json`. CI compares exit
codes, report summaries, machine-readable finding details and evidence, and stable
bundler/project/module-federation/import/config/dependency/artifact facts, plus the
workspace project contract, against that file. Bound paths are normalized relative to
their fixture root. Timings, RSS, generated timestamps, absolute/temp paths, and other
environment details are intentionally excluded from the semantic contract. The
workspace rows also enforce bounded discovery, wall-time, RSS, repeat-run, and parity
checks. To intentionally change the contract, update the expectation file in the same
change after reviewing the resulting diff; CI never updates it automatically and the
required suite cannot be reduced.

The `legacy`, `shadow`, and `v2-compat` rows still exercise the existing v1 collector
with different rollout-controller selections. They do not represent independent v2
collector implementations.
