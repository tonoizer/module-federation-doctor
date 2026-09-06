export default {
  bundler: "rspack",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "artifact/types-missing": "off",
    "artifact/types-metadata-missing": "off",
    "reliability/version-first-offline-remotes": "off",
  },
  moduleFederation: {
    name: "nested_producer_dts_extract_ok",
    filename: "remoteEntry.js",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    remotes: {
      leaf: {
        name: "leaf",
        entry: "https://example.test/leaf/mf-manifest.json",
      },
    },
    dts: {
      generateTypes: {
        extractRemoteTypes: true,
      },
    },
    shared: {},
  },
};
