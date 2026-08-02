# Custom rules

Custom rules use `defineRule` and receive frozen normalized facts only. A rule
may be async. It reports findings through `context.report` and cannot mutate
facts. Facts come from public MF options, manifests, stats, and recorded
capabilities — not private plugin state
([limitations](./limitations.md#permanent-guarantees--non-goals)).

```ts
import { defineRule } from "@module-federation/doctor/rules";

export const requireManifest = defineRule({
  meta: {
    id: "team/require-manifest",
    defaultSeverity: "error",
    supportedBundlers: ["vite", "rspack", "rsbuild", "webpack", "modern"],
    documentation: "/rules/team/require-manifest",
  },
  check(context) {
    if (!context.facts.artifacts.manifest) {
      context.report({
        message: "Manifest missing.",
        evidence: {},
        // Optional (#136): detailsSchema + details — never put schema version in evidence
        // detailsSchema: "custom.team.topic.v1",
        // details: { path: "mf-manifest.json" },
      });
    }
  },
});
```

Register custom rules through `extends` (alone or inside a
[policy pack](./policy-packs.md)):

```ts
import { requireManifest } from "./rules/require-manifest";

export default {
  extends: ["recommended", requireManifest],
};
```
