export default {
  bundler: "rsbuild",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "artifact/remote-entry-missing": "off",
    "artifact/types-missing": "off",
    "artifact/types-metadata-missing": "off",
    "artifact/manifest-disabled": "off",
  },
  moduleFederation: {
    name: "rsbuild_mf_api_generation",
    // Classic Rsbuild 1.5 bag pasted into the v2 plugin options object.
    options: {
      name: "rsbuild_mf_api_generation",
      exposes: { "./Widget": "./src/Widget.ts" },
      filename: "remoteEntry.js",
    },
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
