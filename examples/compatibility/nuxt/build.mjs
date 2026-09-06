import path from "node:path";
import { fileURLToPath } from "node:url";
import { federation } from "@module-federation/vite";
import { build } from "vite";
import nuxtConfig, { mfOptions } from "./nuxt.config.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load Nuxt modules the way Nuxt 3/4 does: string specifiers, tuples, and
 * `setup(options, nuxt)` / callable defaults. `configKey` options from
 * nuxt.config are merged under inline tuple options.
 */
async function loadNuxtModule(entry) {
  const [mod, inlineOptions] = Array.isArray(entry) ? entry : [entry, undefined];
  if (typeof mod === "string") {
    const loaded = await import(mod);
    return { module: loaded.default ?? loaded.moduleFederationDoctor, inlineOptions };
  }
  return { module: mod, inlineOptions };
}

const viteConfig = { plugins: [] };
const extendConfigHooks = [];
const nuxt = {
  options: {
    rootDir: root,
    moduleFederation: nuxtConfig.moduleFederation,
  },
  hook(name, callback) {
    if (name === "vite:extendConfig") extendConfigHooks.push(callback);
  },
};

for (const entry of nuxtConfig.modules ?? []) {
  const { module, inlineOptions } = await loadNuxtModule(entry);
  const configKey = module?.meta?.configKey;
  const keyed =
    typeof configKey === "string" &&
    nuxtConfig[configKey] &&
    typeof nuxtConfig[configKey] === "object"
      ? nuxtConfig[configKey]
      : undefined;
  const options = { ...keyed, ...inlineOptions };
  if (typeof module.setup === "function") module.setup(options, nuxt);
  else if (typeof module === "function") module(options, nuxt);
}

// Official MF Nuxt module owns federation; this smoke attaches the same Vite
// plugin before firing `vite:extendConfig` so MFDoctor still registers after it.
viteConfig.plugins.push(federation(mfOptions));

// Nuxt invokes this hook for client and SSR. The adapter de-duplicates.
for (const apply of extendConfigHooks) {
  apply(viteConfig);
  apply(viteConfig);
}

await build({
  root,
  configFile: false,
  mode: "production",
  plugins: viteConfig.plugins,
  build: { target: "esnext", outDir: "dist", emptyOutDir: true },
});
