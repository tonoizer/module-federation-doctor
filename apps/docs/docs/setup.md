---
title: Get started
description: Install Module Federation Doctor, add the build adapter, and run the first local and workspace checks.
---

# Get started

Doctor runs after your Module Federation build, while the bundler still has the
configuration and emitted files needed to explain a problem. It adds nothing to
the browser bundle.

## Install

Add Doctor as a development dependency:

```bash
pnpm add -D @tonoizer/mfdoctor
```

Use npm or Yarn if that is what the project already uses. Supported versions
are listed in the [compatibility matrix](./compatibility.md).

## Add an adapter

Keep one `mfOptions` object and pass it to both Module Federation and Doctor.
This gives Doctor the complete build-time config, including `runtimePlugins`.

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

## Run the first check

Run the normal production build. Doctor waits until emit is complete, then
prints one findings block. A finding includes:

- severity and rule ID
- the problem and its impact
- a short fix
- a direct Doctor rule link
- official Module Federation sources when available

Clean local builds stay quiet. Local findings do not fail the build unless you
change `failOn`. In CI, Doctor defaults to `failOn: "error"` and writes terminal,
JSON, and SARIF reports.

Use this loop:

1. Build the project.
2. Fix each policy-failing finding.
3. Rebuild until the process exits `0`.
4. If a finding is intentional, suppress the rule or baseline that exact
   fingerprint. Do not remove Doctor to make CI green.

See [Rules](./rules/) for fixes and [Suppressions](./suppressions.md) for
governance.

## Gate all apps

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

## What Doctor covers

| Path                                                 | Coverage                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| Build plugin plus Doctor adapter sharing `mfOptions` | Primary, with config and emitted-file evidence                      |
| `mfdoctor workspace` after all apps build            | Cross-app names, shared packages, providers, and topology           |
| `mfdoctor check` without a build adapter             | Partial; config and imports are available, emitted facts may not be |
| `mfdoctor runtime` with an Observability export      | Opt-in runtime correlation, performed offline                       |
| `mfdoctor probe` against a deployed manifest         | Producer and deployment evidence only                               |

Runtime-only apps that call `@module-federation/runtime` without a supported
build plugin are not first-class Doctor targets. Doctor does not parse runtime
initialization from source or inject a runtime agent. See [Limitations](./limitations.md).
