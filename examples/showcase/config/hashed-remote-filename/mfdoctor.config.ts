export default {
  bundler: "webpack",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "artifact/types-missing": "off",
    "artifact/types-metadata-missing": "off",
    "artifact/dts-disabled": "off",
    "artifact/manifest-disabled": "off",
  },
  moduleFederation: {
    name: "hashed_remote_filename",
    // Hashed container entries invalidate consumer remote URLs on rebuild.
    filename: "remoteEntry.[contenthash].js",
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
