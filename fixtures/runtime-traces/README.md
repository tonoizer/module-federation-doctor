# Runtime Observability fixtures

These fixtures are sanitized replays from the pinned upstream harness. They
are not invented reports.

- `current-2.5.3.json` is the serialized result of upstream
  `records a successful loadRemote report when enabled`.
- `snapshot-failure-2.5.3.json` is the serialized snapshot/moduleInfo failure
  from `does not return hook args from the default browser entry`.
- `partial-devtools.json` is the serialized partial page snapshot from
  `keeps reports without runtime version as basic observability regardless of
scope` in the Chrome DevTools package.
- `healthy.json`, `init-failed.json`, `remote-load-failed.json`, and
  `shared-mismatch.json` are legacy Doctor fixtures. They remain separate for
  the later migration adapter.

Replay and sanitization details, original digests, sanitized digests, and the
field mapping are in `provenance.json`. The upstream package is MIT licensed;
these small JSON fixtures contain no copied source code and retain attribution
to the upstream repository.

The upstream package has no runtime report schema version. Doctor must keep its
source-contract marker separate from `runtimeVersion`, which is the Module
Federation runtime version.

Failure/recovery, preload, shared-recovery, and future/unsupported-contract
captures are intentionally deferred until the behavior slices consume them.
The current and snapshot fixtures cover success, error summaries/context,
warnings/actions, and actual moduleInfo attribution without claiming those
deferred cases.
