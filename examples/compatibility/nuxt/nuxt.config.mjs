/**
 * Documented Nuxt config shape for MFDoctor.
 * Nuxt auto-imports `defineNuxtConfig`; the smoke keeps a local identity so
 * this file stays copyable without a Nuxt dependency.
 */
export function defineNuxtConfig(config) {
  return config;
}

/**
 * Shared with `@module-federation/vite` in `build.mjs`. Real apps pass the
 * same object to `@module-federation/nuxt` / `nuxt.options.moduleFederation`.
 */
export const mfOptions = {
  name: "nuxt_smoke",
  manifest: true,
  dts: false,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.js" },
  remotes: {},
  shared: {},
};

export default defineNuxtConfig({
  // Real apps also register "@module-federation/nuxt" (or equivalent) first.
  // This smoke cannot depend on that package while the upstream example stays
  // baseline-blocked (nuxt/nuxt#36009).
  modules: [
    [
      "@tonoizer/mfdoctor/nuxt",
      {
        moduleFederation: mfOptions,
        rules: {
          // Smoke focuses on adapter wiring, not DTS generation. Nuxt defaults
          // dts off; the adapter applies that effective value.
          "artifact/types-missing": "off",
          "artifact/dts-disabled": "off",
        },
      },
    ],
  ],
  // Nuxt 4-style public config the adapter also reads when module options omit
  // `moduleFederation`.
  moduleFederation: { config: mfOptions },
});
