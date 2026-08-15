<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Production readiness

MFDoctor treats Module Federation as three linked surfaces:

1. build configuration,
2. emitted manifest/stats/type artifacts,
3. federation-wide runtime contracts.

A config can be valid by itself and still fail after deployment. For example,
an `externalRuntime` remote is only safe when a pure top-level consumer provides
the runtime first. MFDoctor therefore keeps local and cross-project checks
separate.

## Abdeckungskarte

| Surface             | Examples                                                        | Main benefit                  |
| ------------------- | --------------------------------------------------------------- | ----------------------------- |
| Identity and format | `name`, `filename`, `library`, `remoteType`                     | Correctness                   |
| Remote loading      | `remotes`, HTTPS, manifest entries, `shareStrategy`             | Reliability and startup speed |
| Sharing             | scopes, versions, singleton, eager, fallback, tree shaking      | Correctness and bundle size   |
| Runtime             | plugins, async startup, external runtime, snapshot capabilities | Reliability and performance   |
| Output              | manifest, stats, remote entry, type metadata, asset maps        | Deploy safety                 |
| Vite-only           | parse timeouts, CSS bundling, runtime feature removal           | Build and runtime performance |

The [rule reference](./rules/index.md) groups every diagnostic by correctness,
reliability, performance, security, or tooling. Each rule page includes the
impact, a concrete fix, and upstream evidence.

## Wichtige Unterschiede

Core/Rspack/Rsbuild options come from the
[Module Federation plugin types](https://github.com/module-federation/core/blob/641a0b6edc0f30865586e7d021522bfa27051c4c/packages/sdk/src/types/plugins/ModuleFederationPlugin.ts).
They include runtime plugins, manifest, DTS, async startup, external runtime,
snapshot optimization, and shared tree shaking.

Vite has its own integration and extra options. Its
[normalized option type](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/src/utils/normalizeModuleFederationOptions.ts)
adds `publicPath`, `bundleAllCSS`, parser timeouts, injection location, SSR
externals, and direct runtime capability flags. A MFDoctor rule says when it is
Vite-only; it does not pretend the setting exists in every bundler.

## Produktionsrichtlinie

Recommended CI policy — register the plugin and let CI env auto-detect do the
rest (`failOn: "error"` + SARIF when `CI` / provider vars are set):

```ts
import { federationDoctor } from "@tonoizer/mfdoctor/vite";

federationDoctor({
  moduleFederation: mfOptions,
});
```

Force CI or local defaults only when needed: `mode: "ci"`, `mode: "development"`,
or an explicit `failOn`. Use `mfdoctor check --ci` when running the CLI outside
a CI provider.

Use `mfdoctor federation ".mf/doctor/**/project.json"` after every application
has produced `project.json`. This is where name collisions, version/scope
conflicts, missing providers, and external-runtime provider gaps become visible.

For incremental adoption, check in a
[fingerprint baseline](./baselines.md) so known debt stays visible in reports
without failing the gate. Baselines are debt — prune them as findings are fixed.

MFDoctor stays offline by default. It records normalized config and artifact
metadata, not source bodies, secrets, or live remote responses.

Install MFDoctor as a `devDependency`. Adapters analyze after emit in Node; they
are not part of the client bundle. MF `runtimePlugins` are covered through the
shared bundler `mfOptions` object — not by shipping MFDoctor into the runtime.

## Research sources

Use primary upstream references when changing rules or claiming Module
Federation behavior. The repository
[contribution guide](https://github.com/tonoizer/module-federation-doctor/blob/main/CONTRIBUTING.md#research-sources)
keeps the maintainer source list. High-level entry points:

- [Official configuration index](https://module-federation.io/configure/index.html)
- [Official `mf` agent skill](https://github.com/module-federation/agent-skills/tree/main/skills/mf)
- [Module Federation Core](https://github.com/module-federation/core)
- [Module Federation Vite](https://github.com/module-federation/vite)
- [Vitest docs and UI](https://github.com/vitest-dev/vitest)

The official agent-skill repository currently has no license file. MFDoctor does
not vendor its code or browser asset. MFDoctor-specific agent UX prefers CLI and
plugin finding output; `.agents/skills/mf` remains for Module Federation
concepts.
