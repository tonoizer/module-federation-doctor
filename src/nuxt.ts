import { federationDoctor } from "./vite.js";
import { coerceFederationInstanceInputs } from "./federation-instance.js";
import type {
  DoctorOptions,
  ModuleFederationConfigLike,
  ModuleFederationInstanceInput,
} from "./types.js";

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
  (options: NuxtDoctorOptions | undefined, nuxt: NuxtModuleContext): void;
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

function normalizeNuxtFederationConfig(
  config: ModuleFederationConfigLike | undefined,
): ModuleFederationConfigLike | undefined {
  if (!config) return undefined;
  // @module-federation/nuxt resolves these defaults before it creates the
  // Vite plugin: manifests are on, while DTS generation is off by default.
  // Apply the same effective values so Vite-family rules do not report Nuxt's
  // normal defaults as missing artifacts.
  return {
    ...config,
    manifest: config.manifest ?? true,
    dts: config.dts ?? false,
  };
}

function normalizeNuxtFederationInstances(
  inputs: DoctorOptions["moduleFederationInstances"],
): ModuleFederationInstanceInput[] | undefined {
  if (inputs === undefined) return undefined;
  return coerceFederationInstanceInputs(inputs).map((input) =>
    Object.assign({}, input, {
      config: normalizeNuxtFederationConfig(input.config) ?? input.config,
    }),
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
  const setup = (options: NuxtDoctorOptions | undefined, nuxt: NuxtModuleContext): void => {
    const resolved = { ...defaults, ...options };
    const root = resolved.root ?? nuxt.options?.rootDir ?? process.cwd();
    const moduleFederation = normalizeNuxtFederationConfig(
      resolved.moduleFederation ?? nuxt.options?.moduleFederation?.config,
    );
    const moduleFederationInstances = normalizeNuxtFederationInstances(
      resolved.moduleFederationInstances,
    );
    const doctorOptions: DoctorOptions = {
      ...resolved,
      root,
      ...(moduleFederation ? { moduleFederation } : {}),
      ...(moduleFederationInstances !== undefined ? { moduleFederationInstances } : {}),
    };

    nuxt.hook("vite:extendConfig", (config) => {
      config.plugins ??= [];
      if (config.plugins.some(isDoctorPlugin)) return;
      config.plugins.push(federationDoctor(doctorOptions));
    });
  };
  const module = ((options: NuxtDoctorOptions | undefined, nuxt: NuxtModuleContext) => {
    setup(options, nuxt);
  }) as NuxtModule;
  module.meta = {
    name: "@module-federation/doctor/nuxt",
    configKey: "moduleFederationDoctor",
  };
  module.setup = setup;
  return module;
}

/** Nuxt module for tuple registration and programmatic module loading. */
export const nuxtDoctor = createNuxtDoctorModule();

/** Alias matching the Vite adapter's public naming. */
export const federationDoctorNuxt = nuxtDoctor;

/** Nuxt's module loader consumes the default module directly. */
export default nuxtDoctor;
