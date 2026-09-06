export default {
  bundler: "rspack",
  bundlerVersion: "1.7.4",
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
    name: "async_startup_rspack_version",
    // Rspack 1.7.4 cannot honor experiments.asyncStartup (requires > 1.7.4).
    experiments: { asyncStartup: true },
    exposes: { "./Widget": "./src/Widget.ts" },
  },
};
