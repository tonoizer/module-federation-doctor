export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/remote-manifest-recommended": "off",
    "reliability/version-first-offline-remotes": "off",
  },
  moduleFederation: {
    name: "remote_alias_prefix_collision",
    manifest: true,
    remotes: {
      button: {
        name: "@scope/button",
        entry: "https://example.test/button/mf-manifest.json",
      },
      component: {
        name: "@scope/component",
        alias: "@scope",
        entry: "https://example.test/component/mf-manifest.json",
      },
    },
    shared: {},
  },
};
