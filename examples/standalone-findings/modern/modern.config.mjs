/**
 * Documented Modern.js config shape for the standalone red emit cell.
 * The CI build (`build.mjs`) applies the same MFDoctor plugin via the
 * Modern.js `modifyBundlerChain` surface without requiring `@modern-js/app-tools`.
 *
 * This cell stays **partial**: Rspack-under-the-hood + adapter API, not a
 * first-class `@modern-js/app-tools` build. Green smoke lives in
 * `examples/compatibility/modern/`.
 *
 * Real app:
 *
 * ```ts
 * import { appTools, defineConfig } from "@modern-js/app-tools";
 * import { moduleFederationPlugin } from "@module-federation/modern-js";
 * import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/modern";
 *
 * const mfOptions = { name: "standalone_modern", ... };
 *
 * export default defineConfig({
 *   plugins: [
 *     appTools(),
 *     moduleFederationPlugin(),
 *     moduleFederationDoctorPlugin({
 *       moduleFederation: mfOptions,
 *       failOn: "never",
 *     }),
 *   ],
 * });
 * ```
 */
export const mfOptions = {
  name: "standalone_modern",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.js" },
  shared: {
    // React 18 installed while requiredVersion asks for ^19 → version-unsatisfied.
    // singleton: false → singleton-risk.
    react: { singleton: false, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: false, requiredVersion: "^19.1.0" },
  },
};
