export default {
  bundler: "rspack",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/remote-manifest-recommended": "off",
    "reliability/version-first-offline-remotes": "off",
    "config/remote-type-urls-missing": "off",
  },
  moduleFederation: {
    name: "nested_producer_dts_extract",
    filename: "remoteEntry.js",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    remotes: {
      shop: "https://example.test/shop/mf-manifest.json",
    },
    // Nested producer without extractRemoteTypes.
    dts: { generateTypes: true },
    shared: {},
  },
};
