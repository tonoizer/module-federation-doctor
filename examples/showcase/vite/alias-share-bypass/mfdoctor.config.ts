export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "shared/unused": "off",
  },
  // CLI stand-in for plugin `configResolved` resolve.alias facts (no Vite build).
  viteConfigFacts: {
    resolveAliases: { react: "./src/shims/react.ts" },
  },
  moduleFederation: {
    name: "alias_share_bypass",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Shared + overlapping resolve.alias rewrites imports around the share scope.
      react: { singleton: true, requiredVersion: "^19.1.0" },
    },
  },
};
