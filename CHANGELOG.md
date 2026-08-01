# @module-federation/doctor

## Unreleased

### Added

- Optional versioned finding `detailsSchema` + `details` payloads for first-batch
  rule families (`shared/*`, `config/remote-*`, `artifact/*`,
  `doctor/partial-analysis`). Fingerprints/baselines/SARIF stay stable — schema
  version is never written into `evidence`.

## 0.1.0

Initial production foundation with Vite, Rspack, and Rsbuild adapters; local and
federation-wide diagnostics; stable terminal, JSON, and SARIF reports; published
JSON Schemas (including the programmatic federation graph payload); guarded
manifest probes; mixed federation proof; and release validation.
