import type { BuildDiagnostics } from "./collect.js";
import { attachDoctorAfterEmit, type CompilerLike } from "./plugin.js";
import { moduleFederationDoctorPlugin as rspackModuleFederationDoctorPlugin } from "./rspack.js";
import { observeSourceTransformImportFromConfigs } from "./share-rewrite.js";
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
  /** Public CLI plugin API: user `modern.config.*`. */
  getConfig?: () => unknown;
  /** Public CLI plugin API: normalized config (onPrepare and later). */
  getNormalizedConfig?: () => unknown;
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

function callPublicConfig<T>(fn: (() => T) | undefined): T | undefined {
  if (typeof fn !== "function") return undefined;
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function createAfterEmitPlugin(
  options: DoctorOptions,
  modernContext?: ModernContextFacts,
  extraDiagnostics?: BuildDiagnostics,
): AfterEmitDoctorPlugin {
  return {
    name: "ModuleFederationDoctor",
    apply(compiler) {
      attachDoctorAfterEmit(compiler, options, modernContext, extraDiagnostics);
    },
  };
}

/**
 * Modern.js-oriented MFDoctor plugin — register next to `moduleFederationPlugin`
 * from `@module-federation/modern-js` / `@module-federation/modern-js-v3`.
 *
 * Modern.js sits on Rspack (or Webpack). This adapter records `bundler: "modern"`
 * and attaches the **same** post-emit analysis used by the direct Rspack/Webpack
 * adapters via `modifyBundlerChain`. It does **not** replace or deprecate
 * `@tonoizer/mfdoctor/rspack` — bare `@rspack/core` projects should keep
 * using that entry.
 */
export function moduleFederationDoctorPlugin(options: DoctorOptions = {}): ModernDoctorPlugin {
  return {
    name: "@tonoizer/mfdoctor",
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
          "[@tonoizer/mfdoctor/modern] api.modifyBundlerChain is missing; MFDoctor was not registered. Use a Modern.js App Tools plugin API, or call appendModuleFederationDoctor / @tonoizer/mfdoctor/rspack from tools.bundlerChain.",
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
        const transformImportLibraries = observeSourceTransformImportFromConfigs(
          callPublicConfig(api.getNormalizedConfig),
          callPublicConfig(api.getConfig),
        );
        chain
          .plugin("module-federation-doctor")
          .use(
            createAfterEmitPlugin(
              configured,
              immutableContext,
              transformImportLibraries !== undefined ? { transformImportLibraries } : undefined,
            ),
          );
      });
    },
  };
}

/**
 * Escape hatch for `tools.bundlerChain` / `tools.rspack` when you want the
 * **public Rspack adapter** inside a Modern.js (or Rsbuild) config. Facts are
 * recorded as `bundler: "rspack"`. Prefer {@link moduleFederationDoctorPlugin}
 * for first-class Modern.js projects.
 */
export function appendModuleFederationDoctor(
  chain: BundlerChainLike,
  options: DoctorOptions = {},
): void {
  chain.plugin("module-federation-doctor").use(rspackModuleFederationDoctorPlugin(options));
}

export default moduleFederationDoctorPlugin;
