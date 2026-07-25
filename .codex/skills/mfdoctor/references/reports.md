# Doctor reports

`project.json` contains normalized, workspace-relative facts. It is the input
for federation-wide analysis.

`report.json` contains sorted findings, stable fingerprints, capability flags,
and severity totals. Baseline-matched findings include `suppressed: true` and
may set `summary.suppressed`.

`results.sarif` is for code-scanning upload (including external suppressions
when a baseline matches).

`mfdoctor.baseline.json` is an optional checked-in fingerprint allowlist for
incremental CI adoption. See docs `baselines.md`.

`mfdoctor probe` prints a separate, bounded live-manifest summary. It is opt-in,
strips URL queries from output, and does not execute the remote entry.

Capabilities matter. If `config`, `manifest`, `stats`, `emittedAssets`, or
`installedVersions` is false, state that the analysis is partial. Import facts
may also list `unresolvedDynamic` call sites; prefer `doctor/partial-analysis`
over claiming unused shared packages when those gaps could hide usage.

Exit codes:

- `0`: analysis completed and policy passed;
- `1`: findings met the configured failure threshold;
- `2`: Doctor could not complete the analysis.

Never turn exit `2` into a clean result.
