# Doctor reports

`project.json` contains normalized, workspace-relative facts. It is the input
for federation-wide analysis.

`report.json` contains sorted findings, stable fingerprints, capability flags,
and severity totals.

`results.sarif` is for code-scanning upload.

`mfdoctor probe` prints a separate, bounded live-manifest summary. It is opt-in,
strips URL queries from output, and does not execute the remote entry.

Capabilities matter. If `config`, `manifest`, `stats`, `emittedAssets`, or
`installedVersions` is false, state that the analysis is partial.

Exit codes:

- `0`: analysis completed and policy passed;
- `1`: findings met the configured failure threshold;
- `2`: Doctor could not complete the analysis.

Never turn exit `2` into a clean result.
