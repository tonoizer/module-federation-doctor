/**
 * Example Bridge policy pack for org-wide Bridge defaults (#140).
 *
 * ```js
 * import bridge from "./fixtures/policy-packs/bridge/index.js";
 * export default { extends: ["recommended", bridge] };
 * ```
 */

const pack = {
  name: "@example/mfdoctor-bridge-policy",
  rules: {
    // Keep info advisories soft even when apps extend `strict`.
    "bridge/ssr-instanceid-hydration": "info",
    "bridge/tanstack-router-conflict": "info",
    "bridge/disable-alias-deprecated": "info",
    // Elevate a warning when orgs want fallback UI in CI under recommended.
    "bridge/missing-fallback-loading": "warning",
  },
};

export default pack;
