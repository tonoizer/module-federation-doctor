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
    "shared/react-host-missing": "off",
    "shared/candidate": "off",
  },
  moduleFederation: {
    name: "async_boundary_missing",
    manifest: true,
    remotes: {
      shop: "https://example.test/mf-manifest.json",
    },
    shared: {
      // Non-eager shared + sync entry import → config/async-boundary-missing (RUNTIME-005).
      react: { singleton: true, eager: false, requiredVersion: "^19.1.0" },
    },
  },
};
