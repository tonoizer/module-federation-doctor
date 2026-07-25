# Policy packs and named presets

Encode Module Federation governance once and reuse it across hosts and remotes —
the same idea as ESLint shareable configs. For per-app `"off"` / severity
overrides, baselines, and `failOn`, see
[Suppressions and allowlists](./suppressions.md).

## Built-in presets

| Preset        | Intent                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommended` | Documented severity map matching built-in / federation / runtime catalog defaults.                                                                                                              |
| `strict`      | Production gate: `info` → `warning`, `warning` → `error`, except advisory tooling / soft-heuristic signals (`doctor/partial-analysis`, `shared/candidate`, `config/implementation-suspicious`). |

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

## Shareable packs

A pack is a `DoctorPolicyPack`: optional `name`, a `rules` severity map, and
optional `plugins` (custom rules from `defineRule`).

```ts
import { definePolicyPack, defineRule } from "@module-federation/doctor";

export const requireManifest = defineRule({
  meta: {
    id: "team/require-manifest",
    defaultSeverity: "error",
    supportedBundlers: ["vite", "rspack", "rsbuild", "webpack"],
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
- `presets` / `recommendedPreset` / `strictPreset` — built-in packs
- `resolvePolicy` / `resolveOptions` — resolve `extends` + merge `rules`
- Subpath: `@module-federation/doctor/policy`
