# External runtime capture contract

The runtime capture contract is an explicit handoff boundary for an external
capture/export tool. It is not a MFDoctor runtime agent.

The design record is [ADR 0084: External runtime capture boundary](https://github.com/tonoizer/module-federation-doctor/blob/main/docs/adr/0084-external-runtime-capture-boundary.md).

Capture must be invoked by a user with an approved target or export file. It
must not run from `check`, a bundler adapter, application startup, or a client
bundle. The current adapter slices read existing public Observability, DevTools,
app-owned, and Node/SSR exports, provide an explicitly requested browser
transport, and project supplied snapshot/runtime-instance fallback evidence. It
never injects plugins, calls runtime mutators, reads storage, or exports
headers, bodies, cookies, source, props, factories, or raw stacks.

The contract records source capabilities as `exact`, `partial`, `unavailable`,
`not-applicable`, or `unknown`. Missing old/preview fields stay unknown. It
also scopes every record by capture, navigation, realm, and sequence so equal
trace IDs from separate realms do not merge.

The default limits are 5 MiB, 100 reports, 5,000 events, 500 snapshots, 100
instances, 2,000 network records, 200 errors, 4 KiB strings, depth 12, and 100
object keys. The hard total ceiling is 25 MiB; truncation must be recorded.

The contract, bounded file-only import, existing file/export adapters, explicit
read-only browser transport, safe snapshot/runtime-instance projections, and
network/error fallback are the shipped safe slices. The atomic validated JSON
handoff is available through the capture entry point; automatic export remains
outside this boundary. The bounded file-only import is available through
the existing offline runtime command:

```bash
mfdoctor runtime ./capture.json
```

The command accepts only contract version 1, rejects oversized or unsafe files
before analysis, and keeps the existing runtime output shape. Runtime mutation
and automatic export remain outside the boundary.

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
is explicit and is never performed by this adapter implicitly.

## Atomic offline handoff

After an external adapter has produced a validated envelope, write it with the
capture entry point:

```ts
import {
  importRuntimeCaptureNetworkFallback,
  writeRuntimeCaptureExportFile,
} from "@tonoizer/mfdoctor/capture";

const capture = importRuntimeCaptureNetworkFallback({
  errors: [{ code: "RUNTIME-007", message: "remote entry failed" }],
});

await writeRuntimeCaptureExportFile(capture, "./.mf/doctor/runtime-capture.json");
```

The writer validates a safe normalized copy before creating a sibling temporary
file. It bounds the serialized UTF-8 output by `limits.maxBytes`, writes with
mode `0600`, flushes the file, atomically renames it into place, and cleans up
the temporary path if the handoff fails. Existing output stays untouched when
validation or the rename fails.

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

## Read-only fallback projections

When an external tool has already read a runtime state object, the capture
entry point can project the small snapshot and runtime-instance surface that is
safe to retain:

```ts
import { importRuntimeCaptureFallback } from "@tonoizer/mfdoctor/capture";

const capture = importRuntimeCaptureFallback({
  runtimeVersion: "2.5.0",
  moduleInfo: {
    totalCount: 1,
    entries: [
      {
        name: "checkout",
        publicPath: "https://cdn.example.test/checkout/",
        remoteEntry: "https://cdn.example.test/checkout/remoteEntry.js",
      },
    ],
  },
  instances: [{ name: "host", remoteNames: ["checkout"], shareScopes: ["default"] }],
});
```

The projection reads only own data properties for `moduleInfo`, snapshot
entries, and `instances`/`runtimeInstances`. It ignores unknown runtime graphs,
does not read `getPublicPath`, factories, functions, headers, or raw errors, and
never calls a runtime API or mutates the supplied object. A configured
`disableSnapshot: true` state produces a `not-applicable` snapshot capability
with no snapshot records. Missing moduleInfo is `unavailable`; clipped,
uncounted, malformed, or quota-limited data remains `partial` or `unknown`.
Preview/unknown runtime versions do not upgrade shared-lifecycle capability and
the fallback never infers shared-state health from instance names or scopes.

## Network/error fallback metadata

An external collector can hand over bounded MF-focused request and runtime-error
metadata without exporting request internals:

```ts
import { importRuntimeCaptureNetworkFallback } from "@tonoizer/mfdoctor/capture";

const capture = importRuntimeCaptureNetworkFallback({
  network: [
    {
      url: "https://cdn.example.test/checkout/remoteEntry.js",
      kind: "remote-entry",
      status: 200,
      requestId: "request-1",
      timestamp: 1_000,
    },
  ],
  errors: [
    {
      code: "RUNTIME-007",
      message: "remote entry failed",
      requestId: "request-1",
      timestamp: 1_001,
    },
  ],
});
```

Only allowlisted URL, kind, status, failure/duration/initiator classes, error
code/name/message/phase, request IDs, and timestamps are projected. URL
credentials and secret query values are redacted before digesting or writing;
headers, bodies, cookies, raw stacks, and arbitrary error contexts are ignored.
An exact request ID or redacted URL creates an exact relation. A timestamp-only
match is a `time-window-candidate`, never an exact causal link. Floods and
malformed records remain partial/unknown and produce explicit truncation.
