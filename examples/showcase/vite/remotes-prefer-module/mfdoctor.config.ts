export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/remote-manifest-recommended": "off",
    "config/remote-localhost-in-production": "off",
  },
  moduleFederation: {
    name: "remotes_prefer_module",
    manifest: true,
    remotes: {
      // String remotes default to `var` on Vite; Vite↔Vite ESM needs `type: 'module'`.
      shop: "https://example.test/mf-manifest.json",
    },
    shared: {},
  },
};
