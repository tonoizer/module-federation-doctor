<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Policy packs and named presets

Encode Module Federation governance once and reuse it across hosts and remotes —
the same idea as ESLint shareable configs. For per-app `"off"` / severity
overrides, baselines, and `failOn`, see
[Suppressions and allowlists](./suppressions.md).

## Integrierte Voreinstellungen

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

For an application-level shortcut, use the top-level `profile` option:

```ts
export default {
  profile: "demo", // or "production"
  extends: ["recommended"],
};
```

`profile` is appended after `extends` and before local `rules`. The effective
order is `default < extends (left to right) < profile < local rules`. When
`profile: "demo"` is used in CI, MFDoctor resolves the safer `production` overlay
instead of hiding demo-only recommendations. The resolved overlay is visible
in `appliedPolicies`.

The `demo` overlay softens local-only demo noise: bare / loopback `remoteEntry`
recommendations and version-first offline-remotes are hidden only in
development runs. A deployed or non-localhost remote stays visible, and CI
stays loud even when `demo` is present. It also hides manifest and implicit
Bridge-router nudges only during local development, while keeping them visible
in CI, and softens disabled DTS to `info`. The `production` overlay makes
manifest, disabled DTS, implicit Bridge-router, and version-first offline-
remote nudges `warning`; it also elevates the Observability recommendation.
These overlays only change recommendation severities and bounded rule
options; they do not change default runs or correctness rules.
Use `rules: { "<rule-id>": "off" }` or a baseline when a production team
intentionally accepts a recommendation.

The manifest and DTS checks only recommend an enablement when MF config shows a
federated surface and the option is explicitly disabled. They are advisory in
the default profile: `demo` hides manifest guidance and keeps DTS at `info`,
while `production` raises both to `warning`. A local `rules` entry wins over
either profile, including `"off"`. The Observability nudge is conservative by
default: it requires a supported MF 2.5+ package and an installed or declared
`@module-federation/observability-plugin`; production can opt into the wider
recommendation. React and React DOM prefix-share gaps are errors by default
(`shared/prefix-share-recommended`) and remain independently suppressible.

## Teilbare Pakete

A pack is a `DoctorPolicyPack`: optional `name`, a `rules` severity map, and
optional `plugins` (custom rules from `defineRule`).

```ts
import { definePolicyPack, defineRule } from "@tonoizer/mfdoctor";

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

## Richtlinienoptionen für Shared-Nutzung

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

## Priorität von Überschreibungen

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
- Subpath: `@tonoizer/mfdoctor/policy`
