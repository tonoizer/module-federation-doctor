# External runtime capture contract

The runtime capture contract is an explicit handoff boundary for an external
capture/export tool. It is not a MFDoctor runtime agent.

The design record is [ADR 0084: External runtime capture boundary](https://github.com/tonoizer/module-federation-doctor/blob/main/docs/adr/0084-external-runtime-capture-boundary.md).

Capture must be invoked by a user with an approved target or export file. It
must not run from `check`, a bundler adapter, application startup, or a client
bundle. The current adapter slice reads existing public Observability,
DevTools, app-owned, and Node/SSR exports; later slices add explicitly
requested browser transport and strictly projected fallback evidence. It
never injects plugins, calls runtime mutators, reads storage, or exports
headers, bodies, cookies, source, props, factories, or raw stacks.

The contract records source capabilities as `exact`, `partial`, `unavailable`,
`not-applicable`, or `unknown`. Missing old/preview fields stay unknown. It
also scopes every record by capture, navigation, realm, and sequence so equal
trace IDs from separate realms do not merge.

The default limits are 5 MiB, 100 reports, 5,000 events, 500 snapshots, 100
instances, 2,000 network records, 200 errors, 4 KiB strings, depth 12, and 100
object keys. The hard total ceiling is 25 MiB; truncation must be recorded.

The contract, bounded file-only import, existing file/export adapters, and
explicit read-only browser transport are the first safe slices. Safe snapshot
projections, network/error fallback, and automatic export remain separate
stacked slices for issue #84. The bounded file-only import is available through
the existing offline runtime command:

```bash
mfdoctor runtime ./capture.json
```

The command accepts only contract version 1, rejects oversized or unsafe files
before analysis, and keeps the existing runtime output shape. Snapshot probing,
network/error fallback, atomic output writing, and runtime mutation remain
deferred.

## Existing export adapters

The `@tonoizer/mfdoctor/capture` entry point can normalize a user-supplied
existing export without attaching to a browser or runtime:

```ts
import { loadRuntimeCaptureExportFile } from "@tonoizer/mfdoctor/capture";

const capture = await loadRuntimeCaptureExportFile(".mf/observability/latest.json", {
  adapter: "observability",
});
```

The adapter accepts current or partial Observability reports, official
DevTools exports, app-owned `onReport`/`onEvent` files, and Node/SSR JSON
exports. It reuses the existing runtime reader, adds scoped identity,
provenance, capabilities, truncation, and stable record IDs, then validates the
complete contract before returning it. DevTools projections remain partial and
retain a source-supplied relation to their report records.

The adapter only reads the supplied value. It does not launch or attach to a
browser, inspect live globals, install a plugin, enable DevTools, call runtime
load/register/init APIs, or mutate the input. Atomic output-file writing
remains a later #84 slice.

## Explicit browser transport

An external browser tool may provide a narrow connector to an explicitly
approved target. MFDoctor calls only `readObservabilityExport` or
`readDevtoolsExport`; the connector must not expose arbitrary page evaluation,
plugin injection, runtime mutation, or DevTools overrides.

```ts
import { captureRuntimeBrowserExport } from "@tonoizer/mfdoctor/capture";

const capture = await captureRuntimeBrowserExport(connector, {
  mode: "attach",
  target: { id: "tab-1", url: "https://app.example.test/" },
  userApproved: true,
});
```

The connector supplies the session, target, navigation, and realm identity.
The transport validates web targets, rejects credentials and secret query keys,
passes the scope to the official export reader, and closes the external
connection on success or failure. It does not reload or navigate the page.
Capture is still one explicit operation; ordinary `check`, bundler adapters,
and application startup never call it.
