export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "vite/remotes-prefer-module": "off",
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/remote-manifest-recommended": "off",
    "reliability/version-first-offline-remotes": "off",
  },
  moduleFederation: {
    name: "remote_http_insecure",
    manifest: true,
    remotes: {
      // Non-localhost plain HTTP.
      shop: "http://cdn.example.com/remoteEntry.js",
    },
    shared: {},
  },
};
