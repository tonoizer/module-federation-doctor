<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# External runtime capture contract

The runtime capture contract is an explicit handoff boundary for a future
external capture tool. It is not a MFDoctor runtime agent.

The design record is [ADR 0084: External runtime capture boundary](https://github.com/tonoizer/module-federation-doctor/blob/main/docs/adr/0084-external-runtime-capture-boundary.md).

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

The contract and bounded file-only import are the first safe slice. Browser
transport, safe snapshot projections, network/error fallback, and automatic
capture remain separate stacked slices for issue #84. The bounded file-only import is now
available through the existing offline runtime command:

```bash
mfdoctor runtime ./capture.json
```

The command accepts only contract version 1, rejects oversized or unsafe files
before analysis, and keeps the existing runtime output shape. Browser and
DevTools transport, snapshot probing, network/error fallback, and runtime
mutation remain deferred.
