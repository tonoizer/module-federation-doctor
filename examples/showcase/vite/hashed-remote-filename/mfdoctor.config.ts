export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
  },
  moduleFederation: {
    name: "hashed_remote_filename",
    manifest: true,
    // Content-hash in the remote entry filename invalidates consumer URLs.
    filename: "remoteEntry.[hash].js",
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
