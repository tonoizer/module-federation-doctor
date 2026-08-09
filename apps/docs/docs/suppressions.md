# Governance: suppressions and allowlists

Doctor already supports intentional allow/deny of specific rules. Use this page
when a finding is **known and accepted** — for example enterprise nesting that
keeps direct `remoteEntry` URLs — so CI stays green without disabling Doctor.

This is the short **Governance** reference for `rules: { "id": "off" }`,
severity overrides, policy packs, fingerprint baselines, and `failOn`.

There is **no** source-comment `eslint-disable` style in v1. Prefer config
`rules`, policy packs, or fingerprint baselines.

## When to use which

| Mechanism                               | Use when                                                                    | Still visible in reports? |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------- |
| Per-rule `"off"`                        | The rule does not apply to this app by design                               | No (rule does not run)    |
| Severity override                       | Keep the check, but change how hard it fails (`info` / `warning` / `error`) | Yes                       |
| Policy presets / packs                  | Share org defaults across hosts and remotes                                 | Depends on pack map       |
| Fingerprint [baselines](./baselines.md) | Incremental CI: known debt fingerprints must not block, new ones must       | Yes (`suppressed: true`)  |
| `failOn`                                | Decide which severities fail the build / CLI exit                           | N/A (policy gate)         |

**Rule of thumb:** fix first. Turn a rule `"off"` only for intentional product
choices. Use a baseline for temporary debt. Use packs/presets for shared
governance. Tune `failOn` for how strict the gate is, not to hide findings.

## Per-rule off and severity override

Local `rules` win over pack and preset maps
([override precedence](./policy-packs.md#override-precedence)):

```ts
export default {
  rules: {
    "config/remote-manifest-recommended": "off",
    "config/observability-plugin-recommended": "info",
    "shared/prefix-share-recommended": "off",
    "shared/singleton-risk": "warning", // was elevated / pack default
  },
};
```

### Heuristic shared / config rules

These rules use package-name or path heuristics. Defaults stay advisory so teams
(and agents) do not learn to ignore Doctor:

| Rule                               | Default   | Why it stays soft                                      |
| ---------------------------------- | --------- | ------------------------------------------------------ |
| `shared/candidate`                 | `info`    | Likely-share guess from framework package names        |
| `config/implementation-suspicious` | `info`    | Custom `implementation` string is not a hard contract  |
| `shared/singleton-risk`            | `warning` | Framework shared without `singleton` — config evidence |
| `shared/unused`                    | `warning` | Fires only when import evidence is complete enough     |

Mute intentional exceptions with `rules: { "<id>": "off" }` (comment why). When
dynamic `import()` / `loadShare*` cannot be resolved, Doctor prefers
`doctor/partial-analysis` over a confident `shared/unused` finding — see
[capabilities](./capabilities.md#dynamic-import-completeness-v1). Showcase
fixtures under `examples/showcase/shared/*-suppressed` and
`shared/unused-unresolved` prove quiet suppression and the partial-analysis path.

The same map works on adapter options:

```ts
federationDoctor({
  moduleFederation: mfOptions,
  rules: {
    "config/remote-manifest-recommended": "off",
  },
});
```

Document **why** in a short comment next to the entry. Config does not yet take
a structured `reason` beside `"off"`; for tracked debt with a reportable reason,
use baseline `reason` fields (below).

## Canonical example: mixed-federation host

The green multi-bundler example
[`examples/mixed-federation/host-vite`](https://github.com/tonoizer/module-federation-doctor/blob/main/examples/mixed-federation/host-vite/vite.config.ts)
is the canonical pattern for intentional host suppressions. The fixture has no
manifest server and tests direct Vite→Rspack/Rsbuild remotes, so it turns two
rules off with comments:

```ts
federationDoctor({
  moduleFederation: mfOptions,
  rules: {
    // This local example has no manifest server. Production apps should
    // prefer manifest URLs so tooling can inspect richer metadata.
    "config/remote-manifest-recommended": "off",
    // Keep version-first here because this fixture tests direct
    // Vite-to-Rspack/Rsbuild interoperability, not offline recovery.
    "reliability/version-first-offline-remotes": "off",
  },
});
```

Copy that shape for production hosts that **knowingly** keep direct remote
entries or skip version-first offline remotes: keep Doctor on, mute only the
accepted rules, and leave a comment explaining the choice.

## Policy presets and packs

Reuse severity maps with `extends`:

```ts
export default {
  extends: ["recommended"], // or "strict", "demo", "production", or a pack
  rules: {
    // Per-app overrides on top of the pack
    "config/remote-manifest-recommended": "off",
  },
};
```

The same overlays can be selected directly with `profile`:

```ts
export default {
  profile: "demo", // local showcase; CI resolves this to production for safety
  rules: {
    // Local rules still win over the profile.
    "shared/prefix-share-recommended": "off",
  },
};
```

See [Policy packs and named presets](./policy-packs.md) for `recommended` /
`strict`, `demo` / `production`, shareable packs, and precedence. The `demo`
pack is safe for local showcases: it softens only bounded local-development
recommendations. It does not hide non-localhost findings or CI findings.

The enable-this rules are independently suppressible: use
`config/observability-plugin-recommended` when runtime reports are not part of
the environment, and use `shared/prefix-share-recommended` when exact subpath
sharing is intentional. A baseline keeps either recommendation visible as
`suppressed: true` while allowing CI to continue.

## Fingerprint baselines

Baselines mute **specific finding fingerprints**, not whole rules. Matched
findings stay in terminal / JSON / SARIF as `suppressed: true`, and optional
`reason` is copied to `suppressionReason`:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "fingerprint": "a1b2c3…",
      "ruleId": "shared/singleton-mismatch",
      "project": "host",
      "reason": "Legacy singleton until shared migration lands"
    }
  ]
}
```

Wire with `baseline: "./mfdoctor.baseline.json"` (or CLI `--baseline`). Full
workflow: [Fingerprint baselines](./baselines.md).

## `failOn`

`failOn` chooses which severities fail the gate after every finding is
collected:

| Value       | Gate behavior                                         |
| ----------- | ----------------------------------------------------- |
| `"never"`   | Print findings; exit / build succeeds (local default) |
| `"warning"` | Fail on warning or error                              |
| `"error"`   | Fail on error only (CI auto-detect default)           |

CI env vars turn on `failOn: "error"` and SARIF automatically. Override with
`failOn`, `mode: "ci"` / `mode: "development"`, or `--ci`. Baselines suppress
policy failure for matched fingerprints unless `baseline.failOnSuppressed` is
true — they do not change which severities `failOn` considers.

## What v1 does not include

- No per-line source comments (`// mfdoctor-disable`, eslint-disable style).
- No structured `reason` field on `rules: { id: "off" }` yet — use a comment, or
  baseline `reason` when the mute is fingerprint debt.
