export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "shared/unused": "off",
    "shared/candidate": "off",
  },
  moduleFederation: {
    name: "subpath_version_resolved",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Parent `react` is installed → Vite can inherit the provider version.
      "react/": { singleton: true },
      // Explicit version is enough even when the parent package is absent.
      "lodash/cloneDeep": { singleton: true, version: "4.17.21" },
      // Concrete requiredVersion lets Vite infer a provider version fallback.
      "@acme/ui/button": { singleton: true, requiredVersion: "^1.2.3" },
    },
  },
};
