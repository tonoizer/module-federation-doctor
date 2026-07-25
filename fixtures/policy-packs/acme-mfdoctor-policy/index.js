/**
 * Example shareable policy pack (`@acme/mfdoctor-policy`).
 *
 * Prefer authoring with `definePolicyPack` / `defineRule` from
 * `@module-federation/doctor` in published packs. This fixture keeps a plain
 * default export so path-based `extends` resolution works without linking.
 *
 * Monorepo reuse:
 *
 * ```js
 * import acme from "@acme/mfdoctor-policy";
 * export default {
 *   extends: ["recommended", acme],
 *   rules: { "shared/unused": "off" },
 * };
 * ```
 *
 * Or by package/path string: `extends: ["recommended", "@acme/mfdoctor-policy"]`
 */

const requireManifest = {
  meta: {
    id: "acme/require-manifest",
    defaultSeverity: "error",
    supportedBundlers: ["vite", "rspack", "rsbuild", "unknown"],
    documentation: "/rules/acme/require-manifest",
    category: "reliability",
    impact: "Without a manifest, hosts lose type hints and richer DevTools data.",
    fix: "Enable Module Federation `manifest: true` (or an options object) for producers.",
  },
  check(context) {
    const mf = context.facts.moduleFederation;
    if (!mf) return;
    if (mf.exposes && Object.keys(mf.exposes).length > 0 && !context.facts.artifacts.manifest) {
      context.report({
        message: "Acme policy requires producers to emit a federation manifest.",
        evidence: { exposes: Object.keys(mf.exposes).sort() },
        suggestion: "Set manifest: true on the Module Federation plugin options.",
      });
    }
  },
};

const pack = {
  name: "@acme/mfdoctor-policy",
  rules: {
    "config/remote-http-insecure": "error",
    "shared/candidate": "off",
  },
  plugins: [requireManifest],
};

export default pack;
export { requireManifest };
