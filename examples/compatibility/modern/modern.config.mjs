/**
 * Documented Modern.js config shape for MFDoctor.
 * The CI smoke build (`build.mjs`) applies the same MFDoctor plugin via the
 * Modern.js `modifyBundlerChain` surface without requiring `@modern-js/app-tools`.
 * Current App Tools releases cannot enter this lockfile under
 * `trustPolicy: no-downgrade` (last provenance-attested stable is `2.63.3`).
 *
 * Real app (Modern.js 3):
 *
 * ```ts
 * import { appTools, defineConfig } from "@modern-js/app-tools";
 * import { moduleFederationPlugin } from "@module-federation/modern-js-v3";
 * import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/modern";
 *
 * const mfOptions = { name: "modern_smoke", ... };
 *
 * export default defineConfig({
 *   plugins: [
 *     appTools(),
 *     moduleFederationPlugin({ config: mfOptions, ssr: false }),
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
