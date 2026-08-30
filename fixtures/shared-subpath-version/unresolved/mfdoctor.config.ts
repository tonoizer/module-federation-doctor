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
    name: "subpath_version_unresolved",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Parent `@acme/ui` is not installed → Vite cannot inherit a provider version.
      "@acme/ui/button": { singleton: true },
      // Trailing-slash prefix with no parent install and no explicit version.
      "lodash/": { singleton: true },
    },
  },
};
