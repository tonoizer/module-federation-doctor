# Runtime Observability fixtures

These fixtures are split by source contract:

- `current-2.5.3.json` is a sanitized contract fixture derived from the public
  `@module-federation/observability-plugin` 2.5.3 report assertions around
  `getLatestReport()`/`exportReport()` in the upstream observability tests at
  Module Federation Core commit
  `d92724217184f5ab7d7171b2cbd93c36f5808969`.
  Source: <https://github.com/module-federation/core/blob/d92724217184f5ab7d7171b2cbd93c36f5808969/packages/observability-plugin/__tests__/observability.spec.ts>.
  Construction method: retain the JSON field names and value kinds from the public
  report, replace test-specific names/URLs/timestamps with deterministic safe
  values, and omit raw stacks and private locators.
- `partial-devtools.json` is a `{ "reports": [...] }` snapshot with only
  partial report data. Missing fields mean “not collected”, not success.
- `healthy.json`, `init-failed.json`, `remote-load-failed.json`, and
  `shared-mismatch.json` are legacy Doctor fixtures. They remain here so the
  migration adapter can prove the documented compatibility window.

The upstream package has no runtime report schema version. Doctor must keep its
source-contract marker separate from `runtimeVersion`, which is the Module
Federation runtime version.

The fixture matrix intentionally covers `component-loaded` and `pending` in
this first contract slice. Failure, recovery, preload, and shared mismatch
captures are added with the behavior slices that consume those semantics.
