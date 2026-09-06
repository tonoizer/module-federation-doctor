export default {
  bundler: "rspack",
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
    name: "prefix_share_enhanced_rspack",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Root share only — `react/jsx-runtime` is uncovered, so prefix-share-recommended fires.
      react: { singleton: true },
      // Vite-style prefix/subpath keys with no parent install. Enhanced does not inherit
      // provider version from the parent package; subpath-version-unresolved must stay quiet.
      "lodash/": { singleton: true },
      "@acme/ui/button": { singleton: true },
    },
  },
};
