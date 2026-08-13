/**
 * Documented Modern.js config shape for Module Federation Doctor.
 * The CI smoke build (`build.mjs`) applies the same Doctor plugin via the
 * Modern.js `modifyBundlerChain` surface without requiring `@modern-js/app-tools`.
 *
 * Real app:
 *
 * ```ts
 * import { appTools, defineConfig } from "@modern-js/app-tools";
 * import { moduleFederationPlugin } from "@module-federation/modern-js";
 * import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/modern";
 *
 * const mfOptions = { name: "modern_smoke", ... };
 *
 * export default defineConfig({
 *   plugins: [
 *     appTools(),
 *     moduleFederationPlugin(),
 *     moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
 *   ],
 * });
 * ```
 *
 * Escape hatch (public Rspack adapter, records bundler as `rspack`):
 *
 * ```ts
 * import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/rspack";
 * // tools.bundlerChain(chain => {
 * //   chain.plugin("mf-doctor").use(moduleFederationDoctorPlugin({ moduleFederation: mfOptions }));
 * // })
 * ```
 */
export const mfOptions = {
  name: "modern_smoke",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.js" },
  shared: {},
};
