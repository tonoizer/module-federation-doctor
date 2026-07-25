# Runtime, manifests, and snapshots

## What each artifact does

`mf-stats.json` is build-focused. It carries detailed assets, exposes, remotes,
shared packages, used exports, plugin/build versions, remote entry metadata,
and type metadata.

`mf-manifest.json` is the stable runtime view distilled from those stats.
Consumers can use it for dynamic type hints, preloading, and DevTools data.

The exact upstream shapes live in
[manifest types](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types/manifest.ts)
and
[stats types](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types/stats.ts).

Doctor records:

- container id and name,
- public path,
- plugin and build versions,
- remote entry name/path/type,
- type archive/API metadata,
- expose asset lists,
- shared versions and asset lists,
- remote alias/entry/version/scope metadata.

It then compares these values with config, installed packages, and emitted
assets. This catches stale output that a config-only linter cannot see.

## Deployed probe

When network access is explicitly wanted, compare the build view with a live
manifest:

```bash
mfdoctor probe https://cdn.example.com/mf-manifest.json --remote-entry
```

The probe downloads only the bounded JSON manifest. `--remote-entry` adds a
`HEAD` request for the entry. It reports status and headers but does not
download or execute the remote JavaScript. This is useful for stale-CDN,
wrong-public-path, missing-entry, and bad-content-type checks. It cannot prove
that container initialization or an exposed factory works; use runtime
observability for those stages.

## Snapshot flow

At runtime, a manifest is converted into module snapshot data. The snapshot
contains the resolved remote entry, public path, remote type URLs, dependent
remotes, shared assets, and optional secondary tree-shaken shared artifacts.
The runtime caches manifest fetches and emits `RUNTIME-013` when required
manifest fields are missing.

See the upstream
[snapshot types](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types/snapshot.ts)
and
[snapshot loader](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/runtime-core/src/plugins/snapshot/SnapshotHandler.ts).

## Observability

Doctor's default analysis is static and offline. For a live failure, use the
official
[Observability Plugin](https://module-federation.io/plugin/plugins/observability-plugin).
It can identify whether a failure occurred during manifest, remote entry,
container init, expose lookup, factory execution, or shared resolution.

Do not guess from a generic network error:

1. keep the stable `RUNTIME-xxx` code;
2. capture the failed URL/status and original browser exception;
3. use an observability trace when available;
4. match the live report with Doctor's build facts and manifest metadata.

This separates a bad deployment URL from valid JavaScript that downloaded and
then failed during execution.
