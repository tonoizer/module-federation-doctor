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
    name: "bridge_vue_share_missing",
    manifest: true,
    // Vue Bridge is imported from source, but `vue` is omitted from shared.
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
