import { attachDoctorAfterEmit, type CompilerLike } from "./plugin.js";
import { moduleFederationDoctorPlugin } from "./rspack.js";
import type { DoctorOptions } from "./types.js";
import type { ModernContextFacts } from "./types.js";

/** Minimal bundler-chain surface used by Modern.js `modifyBundlerChain`. */
export type BundlerChainLike = {
  plugin: (name: string) => {
    use: (plugin: unknown, args?: unknown[]) => unknown;
  };
};

type ModernAppContext = {
  packageName?: string;
  command?: string;
  metaName?: string;
  bundlerType?: string;
  appDirectory?: string;
  isProd?: boolean;
};

type ModernChainUtils = {
  env?: unknown;
  target?: unknown;
};

/** Duck-typed Modern.js / App Tools plugin API (no hard dependency on app-tools). */
export type ModernDoctorApi = {
  getAppContext?: () => ModernAppContext;
  modifyBundlerChain?: (
    handler: (chain: BundlerChainLike, utils?: ModernChainUtils) => void | Promise<void>,
  ) => void;
};

export type ModernDoctorPlugin = {
  name: string;
  setup: (api: ModernDoctorApi) => void | Promise<void>;
};

type AfterEmitDoctorPlugin = {
  name: string;
  apply: (compiler: CompilerLike) => void;
};

function createAfterEmitPlugin(
  options: DoctorOptions,
  modernContext?: ModernContextFacts,
): AfterEmitDoctorPlugin {
  return {
    name: "ModuleFederationDoctor",
    apply(compiler) {
      attachDoctorAfterEmit(compiler, options, modernContext);
    },
  };
}

/**
 * Modern.js-oriented Doctor plugin — register next to `moduleFederationPlugin`
 * from `@module-federation/modern-js` / `@module-federation/modern-js-v3`.
 *
 * Modern.js sits on Rspack (or Webpack). This adapter records `bundler: "modern"`
 * and attaches the **same** post-emit analysis used by the direct Rspack/Webpack
 * adapters via `modifyBundlerChain`. It does **not** replace or deprecate
 * `@module-federation/doctor/rspack` — bare `@rspack/core` projects should keep
 * using that entry.
 */
export function pluginModuleFederationDoctor(options: DoctorOptions = {}): ModernDoctorPlugin {
  return {
    name: "@module-federation/doctor",
    setup(api) {
      const context = api.getAppContext?.() ?? {};
      const root = options.root ?? context.appDirectory;
      const configured: DoctorOptions = {
        ...options,
        ...(root ? { root } : {}),
        bundler: "modern",
      };
      if (typeof api.modifyBundlerChain !== "function") {
        console.warn(
          "[@module-federation/doctor/modern] api.modifyBundlerChain is missing; Doctor was not registered. Use a Modern.js App Tools plugin API, or call appendModuleFederationDoctor / @module-federation/doctor/rspack from tools.bundlerChain.",
        );
        return;
      }
      api.modifyBundlerChain((chain, utils) => {
        const modernContext: ModernContextFacts = {};
        for (const key of ["packageName", "command", "metaName", "bundlerType"] as const) {
          const value = context[key];
          if (typeof value === "string" && value.length > 0) modernContext[key] = value;
        }
        if (typeof context.isProd === "boolean") modernContext.isProd = context.isProd;
        if (typeof utils?.env === "string" && utils.env.length > 0) modernContext.env = utils.env;
        if (typeof utils?.target === "string" && utils.target.length > 0)
          modernContext.target = utils.target;
        const immutableContext = Object.freeze(modernContext);
        chain
          .plugin("module-federation-doctor")
          .use(createAfterEmitPlugin(configured, immutableContext));
      });
    },
  };
}

/**
 * Escape hatch for `tools.bundlerChain` / `tools.rspack` when you want the
 * **public Rspack adapter** inside a Modern.js (or Rsbuild) config. Facts are
 * recorded as `bundler: "rspack"`. Prefer {@link pluginModuleFederationDoctor}
 * for first-class Modern.js projects.
 */
export function appendModuleFederationDoctor(
  chain: BundlerChainLike,
  options: DoctorOptions = {},
): void {
  chain.plugin("module-federation-doctor").use(moduleFederationDoctorPlugin(options));
}

/** @deprecated Use `pluginModuleFederationDoctor`. */
export const doctor = pluginModuleFederationDoctor;

export default pluginModuleFederationDoctor;
