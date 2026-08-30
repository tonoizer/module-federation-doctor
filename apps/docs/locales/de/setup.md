---
title: Erste Schritte
description: MFDoctor installieren, den Build-Adapter hinzufügen und die ersten lokalen und Workspace-Prüfungen ausführen.
---

<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Get started

MFDoctor runs after your Module Federation build, while the bundler still has the
configuration and emitted files needed to explain a problem. It adds nothing to
the browser bundle.

## Installation

Add MFDoctor as a development dependency:

```bash
pnpm add -D @tonoizer/mfdoctor
```

**Name clash:** `npx mf-doctor` is a different package (tiagocastro070), not this
project. This package is `@tonoizer/mfdoctor` (CLI binary `mfdoctor`). Install as
a dependency and run via package-manager exec (`pnpm exec mfdoctor`,
`npx mfdoctor`, etc.) — not `npx mf-doctor`.

Use npm or Yarn if that is what the project already uses. Supported versions
are listed in the [compatibility matrix](./compatibility.md).

## Einen Adapter hinzufügen

Keep one `mfOptions` object and pass it to both Module Federation and MFDoctor.
This gives MFDoctor the complete build-time config, including `runtimePlugins`.

For Vite:

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";

const mfOptions = {
  name: "host",
  remotes: {},
};

export default {
  plugins: [federation(mfOptions), federationDoctor({ moduleFederation: mfOptions })],
};
```

Using another build tool? Open [Bundler integrations](./integrations.md) for
Nuxt, Rspack, Rsbuild, Webpack, Modern.js, Rolldown-integrated Vite, and Vite
Plus examples.

## Die erste Prüfung ausführen

Run the normal production build. MFDoctor waits until emit is complete, then
prints one findings block. A finding includes:

- severity and rule ID
- the problem and its impact
- a short fix
- a direct MFDoctor rule link
- official Module Federation sources when available

Clean local builds stay quiet. Local findings do not fail the build unless you
change `failOn`. In CI, MFDoctor defaults to `failOn: "error"` and writes terminal,
JSON, and SARIF reports.

Use this loop:

1. Build the project (plugin emit — strongest evidence).
2. Fix each policy-failing finding.
3. Rebuild until the process exits `0`.
4. In a monorepo, run `mfdoctor workspace` after every app has built.
5. If a finding is intentional, suppress the rule or baseline that exact
   fingerprint. Do not remove MFDoctor to make CI green.

`mfdoctor check` alone is offline config/static analysis. Do not claim green
from check alone — see the [agent loop](./agent-loop.md) (check vs emit +
workspace) and treat [`doctor/partial-analysis`](./rules/doctor/partial-analysis.md)
as incomplete analysis.

See [Rules](./rules/) for fixes and [Suppressions](./suppressions.md) for
governance.

## Alle Apps absichern

Each adapter writes `.mf/doctor/project.json`. After every host and remote has
built, run one workspace gate:

```bash
mfdoctor workspace
```

For selected monorepo roots and CI reports:

```bash
mfdoctor workspace apps packages --format terminal,json,sarif
```

The command exits `0` when policy passes, `1` for policy failures, and `2` when
analysis cannot finish. See the [CLI command reference](./cli.md) for explicit
federation globs, baselines, runtime traces, and deployed probes.

## Was MFDoctor abdeckt

| Path                                                   | Coverage                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| Build plugin plus MFDoctor adapter sharing `mfOptions` | Primary, with config and emitted-file evidence                      |
| `mfdoctor workspace` after all apps build              | Cross-app names, shared packages, providers, and topology           |
| `mfdoctor check` without a build adapter               | Partial; config and imports are available, emitted facts may not be |
| `mfdoctor runtime` with an Observability export        | Opt-in runtime correlation, performed offline                       |
| `mfdoctor probe` against a deployed manifest           | Producer and deployment evidence only                               |

Runtime-only apps that call `@module-federation/runtime` without a supported
build plugin are not first-class MFDoctor targets. MFDoctor does not parse runtime
initialization from source or inject a runtime agent. See [Limitations](./limitations.md).

## Nächste Schritte

Host teams: [CI](./production-readiness.md) → [Rules](./rules/) → [Limitations](./limitations.md).

Extending Doctor as a library author? Identity, waivers, graph, and capture
contracts live under [Library / extension](./capabilities.md#library-contracts-110).
