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
    supportedBundlers: ["vite", "rspack", "rsbuild", "webpack"],
    documentation: "/rules/team/require-manifest",
  },
  check(context) {
    if (!context.facts.artifacts.manifest) {
      context.report({ message: "Manifest missing.", evidence: {} });
    }
  },
});
```
