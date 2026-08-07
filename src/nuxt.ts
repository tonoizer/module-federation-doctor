import { federationDoctor } from "./vite.js";
import type { DoctorOptions, ModuleFederationConfigLike } from "./types.js";

/** Options accepted by the Nuxt module adapter. */
export type NuxtDoctorOptions = Omit<DoctorOptions, "bundler">;

type NuxtViteConfig = { plugins?: unknown[] };

/** The small public Nuxt surface used by the adapter in Nuxt 3 and Nuxt 4. */
export type NuxtModuleContext = {
  options?: {
    rootDir?: string;
    moduleFederation?: { config?: ModuleFederationConfigLike };
  };
  hook: (
    name: "vite:extendConfig",
    callback: (config: NuxtViteConfig, context?: unknown) => void,
  ) => void;
};

export type NuxtModule = {
  meta: { name: string; configKey: string };
  setup: (options: NuxtDoctorOptions | undefined, nuxt: NuxtModuleContext) => void;
};

function isDoctorPlugin(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { name?: unknown }).name === "module-federation-doctor",
  );
}

/**
 * Create the first-class Nuxt adapter.
 *
 * Nuxt 3 and Nuxt 4 both expose `vite:extendConfig`; keeping the adapter on
 * that public hook avoids a dependency on Nuxt internals and lets the same
 * entry observe client and SSR builds. The Module Federation plugin remains
 * owned by the Nuxt integration or the application's Vite config.
 */
export function createNuxtDoctorModule(defaults: NuxtDoctorOptions = {}): NuxtModule {
  return {
    meta: {
      name: "@module-federation/doctor/nuxt",
      configKey: "moduleFederationDoctor",
    },
    setup(options = {}, nuxt) {
      const resolved = { ...defaults, ...options };
      const root = resolved.root ?? nuxt.options?.rootDir ?? process.cwd();
      const moduleFederation = resolved.moduleFederation ?? nuxt.options?.moduleFederation?.config;
      const doctorOptions: DoctorOptions = {
        ...resolved,
        root,
        ...(moduleFederation ? { moduleFederation } : {}),
      };

      nuxt.hook("vite:extendConfig", (config) => {
        config.plugins ??= [];
        if (config.plugins.some(isDoctorPlugin)) return;
        config.plugins.push(federationDoctor(doctorOptions));
      });
    },
  };
}

/** Nuxt module for tuple registration and programmatic module loading. */
export const nuxtDoctor = createNuxtDoctorModule();

/** Alias matching the Vite adapter's public naming. */
export const federationDoctorNuxt = nuxtDoctor;

/** Nuxt's module loader consumes the default module directly. */
export default nuxtDoctor;
