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
  },
  moduleFederation: {
    name: "js_remote_without_type_urls",
    remotes: {
      // Direct .js remotes do not publish type URLs the way mf-manifest.json does.
      shop: "https://cdn.example.test/remoteEntry.js",
    },
    shared: {},
  },
};
