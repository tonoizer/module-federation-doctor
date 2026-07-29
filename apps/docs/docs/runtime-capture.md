# External runtime capture contract

The runtime capture contract is an explicit handoff boundary for a future
external capture tool. It is not a Doctor runtime agent.

Capture must be invoked by a user with an approved target or export file. It
must not run from `check`, a bundler adapter, application startup, or a client
bundle. Capture reads existing public Observability or DevTools exports and
strictly projected fallback evidence. It never injects plugins, calls runtime
mutators, reads storage, or exports headers, bodies, cookies, source, props,
factories, or raw stacks.

The contract records source capabilities as `exact`, `partial`, `unavailable`,
`not-applicable`, or `unknown`. Missing old/preview fields stay unknown. It
also scopes every record by capture, navigation, realm, and sequence so equal
trace IDs from separate realms do not merge.

The default limits are 5 MiB, 100 reports, 5,000 events, 500 snapshots, 100
instances, 2,000 network records, 200 errors, 4 KiB strings, depth 12, and 100
object keys. The hard total ceiling is 25 MiB; truncation must be recorded.

This PR defines the contract only. File adapters, browser transport, safe
snapshot projections, network/error fallback, and offline import are separate
stacked slices for issue #84.
