export default {
  bundler: "rspack",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
  },
  moduleFederation: {
    name: "share_scope_undeclared",
    manifest: true,
    shareScope: ["default"],
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // custom is not in top-level shareScope.
      react: { singleton: true, shareScope: "custom", requiredVersion: "^19.1.0" },
    },
  },
};
