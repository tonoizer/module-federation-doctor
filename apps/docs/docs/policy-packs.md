# Policy packs and named presets

Encode Module Federation governance once and reuse it across hosts and remotes —
the same idea as ESLint shareable configs. For per-app `"off"` / severity
overrides, baselines, and `failOn`, see
[Suppressions and allowlists](./suppressions.md).

## Built-in presets

| Preset        | Intent                                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommended` | Documented severity map matching built-in / federation / runtime catalog defaults.                                                                                                                                         |
| `strict`      | Production gate: `info` → `warning`, `warning` → `error`, except advisory tooling / soft-heuristic signals (`doctor/partial-analysis`, `shared/candidate`, `config/implementation-suspicious`, `federation/ghost-shares`). |
| `demo`        | Local/demo overlay: hides selected opt-in tooling nudges and softens DTS guidance; correctness findings stay unchanged.                                                                                                    |
| `production`  | Production overlay: elevates selected enable-this recommendations to `warning`; correctness findings stay unchanged.                                                                                                       |

```ts
export default {
  extends: ["recommended"],
};
```

```ts
export default {
  extends: ["strict"],
};
```

Profiles are explicit policy overlays, not a second config system. Compose one
with `recommended` when you want the full catalog, and keep local `rules`
overrides last:

```ts
export default {
  extends: ["recommended", "demo"],
};
```

```ts
export default {
  extends: ["recommended", "production"],
  rules: {
    // Local intent still wins over the profile.
  },
};
```

The `demo` overlay turns off the manifest, version-first offline-remote, and
implicit Bridge-router nudges and softens disabled DTS to `info`. This fits
localhost demos where remotes may be intentionally offline. The `production`
overlay makes manifest, disabled DTS, and implicit Bridge-router nudges
`warning`; it leaves the version-first offline-remote warning on. These
overlays only change existing recommendation severities; they do not change
default runs or correctness rules. Use `rules: { "<rule-id>": "off" }` or a
baseline when a production team intentionally accepts a recommendation.

## Shareable packs

A pack is a `DoctorPolicyPack`: optional `name`, a `rules` severity map, and
optional `plugins` (custom rules from `defineRule`).

```ts
import { definePolicyPack, defineRule } from "@module-federation/doctor";

export const requireManifest = defineRule({
  meta: {
    id: "team/require-manifest",
    defaultSeverity: "error",
    supportedBundlers: ["vite", "rspack", "rsbuild", "webpack", "modern"],
    documentation: "/rules/team/require-manifest",
  },
  check(context) {
    if (!context.facts.artifacts.manifest) {
      context.report({ message: "Manifest missing.", evidence: {} });
    }
  },
});

export default definePolicyPack({
  name: "@scope/mfdoctor-policy",
  rules: {
    "config/remote-http-insecure": "error",
  },
  plugins: [requireManifest],
});
```

Publish the pack as a workspace or npm package and depend on it from each app.
Load it by import or by package/path string (resolved from the project root —
no remote HTTP download):

```ts
import teamPolicy from "@scope/mfdoctor-policy";

export default {
  extends: ["recommended", teamPolicy],
  rules: {
    // Per-app overrides
  },
};
```

```ts
export default {
  extends: ["recommended", "@scope/mfdoctor-policy"],
};
```

In-repo example: `fixtures/policy-packs/acme-mfdoctor-policy`.

## Shared-usage policy knobs

Packs (and local `DoctorOptions`) can extend built-in package lists and import
depth without replacing them:

```ts
export default definePolicyPack({
  name: "@scope/mfdoctor-policy",
  sharedPolicy: {
    importDepth: "local-graph", // or "direct"
    additionalCandidates: ["@acme/ui"],
    additionalSingletonRisks: ["@acme/store"],
    alwaysShared: ["@acme/runtime"],
    deepImportAllowlist: ["lodash/fp"],
  },
  rules: {
    "shared/deep-import-bypass": "warning",
  },
});
```

Equivalent local fields on `DoctorOptions`: `importDepth`,
`additionalCandidates`, `additionalSingletonRisks`, `alwaysShared`,
`deepImportAllowlist`.

## Override precedence

Later layers win:

1. Built-in rule `defaultSeverity`
2. Preset maps from `extends` (left → right)
3. Pack maps from `extends` (left → right)
4. Local `rules` in `mfdoctor.config` / adapter `DoctorOptions`
5. CLI / adapter flags merged onto options before resolve (for example `--ci`
   forcing `mode`, or an explicit `rules` object passed from a wrapper)

So: **CLI/flags > local rules > pack > preset defaults**.

Custom rules stay available through `defineRule` either as direct `extends`
entries or as `plugins` on a pack.

## API

- `definePolicyPack` — author a pack
- `presets` / `recommendedPreset` / `strictPreset` / `demoPreset` /
  `productionPreset` — built-in packs and recommendation overlays
- `resolvePolicy` / `resolveOptions` — resolve `extends` + merge `rules`
- Subpath: `@module-federation/doctor/policy`
