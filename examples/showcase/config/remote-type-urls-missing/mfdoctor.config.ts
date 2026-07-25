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
    "config/remote-localhost-in-production": "off",
  },
  moduleFederation: {
    name: "remote_type_urls_missing",
    manifest: true,
    remotes: {
      shop: "https://example.test/remoteEntry.js",
    },
    dts: true,
    shared: {},
  },
};
