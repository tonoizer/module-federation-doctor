# `@acme/mfdoctor-policy`

In-repo fixture for shareable Doctor policy packs (MFDOCTOR-110 / #26).

## What it ships

- Severity map overrides (`config/remote-http-insecure` → error, `shared/candidate` → off)
- Custom rule `acme/require-manifest` via `defineRule`

## Monorepo reuse

```ts
import acme from "@acme/mfdoctor-policy";

export default {
  extends: ["recommended", acme],
  rules: {
    // App-local overrides win over the pack and preset.
    "shared/unused": "off",
  },
};
```

String form (resolved from the project root, no HTTP download):

```ts
export default {
  extends: ["recommended", "@acme/mfdoctor-policy"],
};
```

See [Policy packs and presets](../../apps/docs/docs/policy-packs.md).
