/** Rsbuild remote MF options for CLI `mfdoctor check` (mirrors rsbuild.config.ts). */
const mfOptions = {
  name: "rsbuild_remote_issues",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  shareScope: ["default", "legacy"],
  shared: {
    react: { singleton: true, requiredVersion: "^19.1.0", shareScope: "legacy" },
    "react-dom": { singleton: true, requiredVersion: "^19.1.0", shareScope: "legacy" },
  },
};

export default {
  bundler: "rsbuild",
  mode: "ci",
  moduleFederation: mfOptions,
};
