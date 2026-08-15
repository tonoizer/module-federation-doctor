# ADR 0084: External runtime capture/export boundary

## Status

Proposed for owner review. The contract, offline import, browser transport,
read-only snapshot/runtime-instance and network/error fallback slices, and the
atomic validated exporter are implemented; compatibility closeout remains a
separate implementation slice.

## Context

MFDoctor needs a way to analyze runtime evidence that already exists in a user-
approved browser, Node/SSR export, or application-owned file. That capability
must not turn MFDoctor into a runtime agent. Issues #32 and #33 therefore remain
hard boundaries: no Doctor code, plugin, hook, listener, or instrumentation is
bundled into an application, and no capture runs during `check`, an adapter,
build, startup, or page load.

The shipped `runtime-capture` contract and `mfdoctor runtime <capture.json>`
import path provide the offline handoff. This ADR records the decisions that
the remaining #84 slices must preserve.

## Decision

Capture is an explicit external operation with a user-approved source and
output path. It follows this pipeline:

```text
detect -> read -> project -> validate -> export -> offline import
```

The external side may read an existing public export surface, but it must not
install or enable one. MFDoctor's offline analysis consumes the resulting
versioned envelope and never needs browser or network access.

### Source priority

Sources remain separate records. A lower-priority source may fill a missing
field, but it cannot replace or upgrade a higher-priority fact.

1. Existing official Module Federation Observability reports/events.
2. Existing official DevTools/export data.
3. Strict, allowlisted snapshot and runtime-instance projections.
4. MF-focused network and runtime-error metadata.

Observability report parsing and attribution remain owned by #82. #84 adds
capture provenance and fallback adapters; it must not add a second report
parser or attribution engine.

### Evidence state and identity

Every source advertises `exact`, `partial`, `unavailable`, `not-applicable`, or
`unknown`, with a reason, source version, and scope. Missing or unsupported
fields stay unknown; a runtime version string alone never upgrades capability.

Every record is scoped by capture ID, navigation ID, realm ID, and monotonic
sequence. Trace/request IDs are not globally unique. Cross-realm or time-window
matches remain candidates until an exact identity proves the relationship.

The envelope records provenance, completeness, content digest, relations, and
truncation. Timestamps and session-specific values are source metadata, not
stable semantic or finding identity.

### Privacy, quotas, and validation

The shipped contract defaults to a 5 MiB output, 100 reports, 5,000 events, 500
snapshots, 100 instances, 2,000 network records, 200 errors, 4 KiB strings,
16 KiB diagnosis/error strings, depth 12, and 100 object keys. The hard total
ceiling is 25 MiB with fixed per-collection ceilings. Overflow is explicit
truncation and partial completeness, never silent loss.

Projection is strict and allowlisted. It reads own data properties only and
rejects accessors, functions, symbols, cycles, prototypes, polluted keys,
headers, bodies, cookies, credentials, source, factories, props, storage, and
raw stacks. Redaction occurs before buffering, digesting, logging, or writing.
The complete normalized envelope is validated before atomic handoff.

### No-mutation law

Capture must not assign to or delete from federation globals, runtime instances,
snapshots, remotes, share scopes, DevTools state, or browser storage. It must
not call load/register/remove/preload/init/get APIs, enable overrides, inject a
plugin, or alter collection configuration. Frozen/proxied-global fixtures and
mutator spies are required for every adapter that reads a live source.

### Package and command boundary

Capture functionality stays outside the default app-facing exports and client
bundles. The `@tonoizer/mfdoctor/capture` subpath contains contract validation
and safe projection primitives; the existing `runtime` command remains the
offline import path. A future live transport must be an explicit external
command/API and must not be invoked by ordinary analysis commands.

## Shipped versus remaining slices

The following slices are already on `main`:

- the versioned envelope, schema, identity, capabilities, quotas, redaction,
  validation, and no-mutation contract;
- bounded file-only import through `mfdoctor runtime <capture.json>`;
- adversarial privacy, malformed-input, future-version, quota, and ambiguity
  tests;
- package/docs boundary checks.

The following first adapter slice is now also implemented without live
attachment:

- existing Observability, DevTools, app-owned, and Node/SSR JSON exports are
  detected, projected through the #82 reader, scoped, redacted, validated, and
  returned as a contract-v1 envelope;
- DevTools metadata stays source-partial and keeps source-supplied relations;
- report/event count limits produce explicit truncation and partial capability
  state.

The explicit browser transport slice is also implemented without fallback
global reads:

- an external connector must be selected with `attach` or `launch`, one target,
  and explicit user approval;
- only recognized Observability/DevTools export reader callbacks are invoked;
- session, target, navigation, realm, and source scope are validated and passed
  into the capture identity;
- the connector is always closed after success or failure.

The read-only fallback projection slice is also implemented:

- supplied moduleInfo/snapshot entries and runtime-instance collections are
  projected through own-data-property allowlists only;
- `disableSnapshot` is preserved as `not-applicable`, absent moduleInfo remains
  `unavailable`, and clipped/uncounted/invalid/quota-limited evidence remains
  partial or unknown;
- preview/unknown runtime versions do not infer shared-lifecycle facts, and
  unknown runtime graphs, functions, getters, factories, and raw error fields
  are not exported.

The network/error fallback slice is also implemented:

- only bounded MF-focused URL/status/kind metadata and bounded runtime-error
  code/name/message/phase metadata are projected;
- credentials and secret query values are redacted before digesting, while
  headers, bodies, cookies, raw stacks, and arbitrary error contexts are not
  read;
- exact request-ID/URL links remain exact, while timestamp-only matches are
  explicitly `time-window-candidate` relations and flood/malformed input stays
  partial or unknown.

The atomic exporter slice is also implemented:

- a validated safe copy is serialized within the envelope byte quota before any
  file is created;
- the output is written with restrictive permissions, flushed, atomically
  renamed into place, and cleaned up on failure;
- validation and rename failures leave the existing output untouched.

The remaining work stays linear and independently reviewable:

1. Compatibility matrix, package-boundary audit, privacy docs, and capture-
   then-import examples.

No slice may reopen the rejected runtime-agent design or be merged as a broad
implementation of #84.

## Consequences

- Users get a reviewable, offline evidence handoff without client-bundle code.
- Partial, unavailable, and ambiguous evidence remain visible instead of being
  presented as health.
- The external tool can evolve independently from Doctor's default analysis
  path, but each new source needs a schema/fixture and privacy review.
- Browser transport and fallback adapters require explicit owner review because
  they cross process, realm, and security boundaries.

## Verification

- `schemas/runtime-capture.schema.json` is checked by the schema contract suite.
- `src/capture.ts` enforces the allowlist, quotas, redaction-before-digest, and
  deterministic record identity.
- `src/runtime-trace.ts` imports only validated contract-v1 files and preserves
  incomplete/truncated evidence.
- `apps/docs/docs/runtime-capture.md` documents the external/offline boundary.

Part of [#84](https://github.com/tonoizer/module-federation-doctor/issues/84).
