# Suppressions and allowlists

Doctor already supports intentional allow/deny of specific rules. Use this page
when a finding is **known and accepted** — for example enterprise nesting that
keeps direct `remoteEntry` URLs — so CI stays green without disabling Doctor.

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
    "shared/singleton-risk": "warning", // was error / default
  },
};
```

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
  extends: ["recommended"], // or "strict", or a shareable pack
  rules: {
    // Per-app overrides on top of the pack
    "config/remote-manifest-recommended": "off",
  },
};
```

See [Policy packs and named presets](./policy-packs.md) for `recommended` /
`strict`, shareable packs, and precedence.

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
