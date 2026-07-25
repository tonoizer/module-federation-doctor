import { createUnplugin, type UnpluginOptions } from "unplugin";
import fg from "fast-glob";
import { analyze, analyzeBuild } from "./engine.js";
import type { BuildDiagnostics } from "./collect.js";
import type { AnalysisResult, BundlerName, DoctorOptions, OutputPublicPathKind } from "./types.js";
import { detectViteLifecycle, withPostEmitHook, type ViteHookMeta } from "./vite-lifecycle.js";

/**
 * Fail only after every finding has already been collected and reported.
 * The thrown message lists the full finding set so CI never only shows the first error.
 */
export function failAfterCollect(result: AnalysisResult): void {
  if (result.exitCode === 0) return;
  if (result.exitCode === 2) {
    throw new Error("Module Federation Doctor could not complete analysis.");
  }
  const { errors, warnings, info } = result.report.summary;
  const details = result.report.findings
    .map((finding) => `  - [${finding.severity}] ${finding.ruleId}: ${finding.message}`)
    .join("\n");
  throw new Error(
    `Module Federation Doctor policy failed (${errors} error(s), ${warnings} warning(s), ${info} info). See .mf/doctor/report.json.\n${details}`,
  );
}

type CompilationLike = {
  assets: Record<string, unknown>;
  errors: Error[];
};

export type CompilerLike = {
  context: string;
  hooks: {
    afterEmit: {
      tapPromise: (name: string, fn: (compilation: CompilationLike) => Promise<void>) => void;
    };
  };
  webpack?: { WebpackError?: new (message: string) => Error };
  options?: {
    plugins?: unknown[];
    output?: { publicPath?: unknown };
  };
};

// Public instance names: enhanced webpack sets `.name = "ModuleFederationPlugin"`
// (not "EnhancedModuleFederationPlugin"); rspack sets `"RspackModuleFederationPlugin"`.
// Native webpack often omits `.name`, so fall back to `constructor.name`.
const MF_PLUGIN_NAMES = new Set(["ModuleFederationPlugin", "RspackModuleFederationPlugin"]);

function moduleFederationPluginName(plugin: object): string | undefined {
  const named = (plugin as { name?: unknown }).name;
  if (typeof named === "string" && named.length > 0) return named;
  const ctorName = (plugin as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof ctorName === "string" && ctorName.length > 0 ? ctorName : undefined;
}

/** Count public Module Federation plugin instances on the compiler (core singleton check). */
export function countModuleFederationPlugins(compiler: {
  options?: { plugins?: unknown[] };
}): number {
  const plugins = compiler.options?.plugins;
  if (!Array.isArray(plugins)) return 0;
  return plugins.filter((plugin) => {
    if (!plugin || typeof plugin !== "object") return false;
    const name = moduleFederationPluginName(plugin);
    return typeof name === "string" && MF_PLUGIN_NAMES.has(name);
  }).length;
}

/** Classify bundler `output.publicPath` the way MF manifest generation does. */
export function classifyOutputPublicPath(publicPath: unknown): OutputPublicPathKind {
  if (publicPath === undefined) return "unknown";
  if (typeof publicPath !== "string") return "non-string";
  if (publicPath === "auto") return "auto";
  return "string";
}

function collectCompilerDiagnostics(compiler: CompilerLike): BuildDiagnostics {
  const diagnostics: BuildDiagnostics = {};
  const count = countModuleFederationPlugins(compiler);
  if (compiler.options?.plugins) diagnostics.moduleFederationPluginCount = count;
  if (compiler.options?.output && "publicPath" in compiler.options.output)
    diagnostics.outputPublicPathKind = classifyOutputPublicPath(compiler.options.output.publicPath);
  return diagnostics;
}

/**
 * Post-emit only: analyze emitted assets, print via the shared terminal reporter
 * inside analyzeBuild, then fail the compilation once if policy requires it.
 * Do not push per-finding warnings — that double-prints with the terminal block.
 * Shared by Rspack, Webpack, and the Modern.js adapter (which composes this hook).
 */
export function attachDoctorAfterEmit(compiler: CompilerLike, configured: DoctorOptions): void {
  if (!configured.root) configured.root = compiler.context;
  compiler.hooks.afterEmit.tapPromise("ModuleFederationDoctor", async (compilation) => {
    const diagnostics = collectCompilerDiagnostics(compiler);
    const result = await analyzeBuild(configured, Object.keys(compilation.assets), diagnostics);
    if (result.exitCode === 0) return;
    const ErrorCtor = compiler.webpack?.WebpackError ?? Error;
    // Single policy failure diagnostic — findings already printed by writeReports.
    compilation.errors.push(
      new ErrorCtor(
        `Module Federation Doctor policy failed. See terminal output and .mf/doctor/report.json.`,
      ),
    );
    failAfterCollect(result);
  });
}

async function listViteEmittedAssets(root: string): Promise<string[]> {
  return fg(["dist/**/*", "build/**/*"], {
    cwd: root,
    onlyFiles: true,
  });
}

/**
 * Vite / Rolldown / Vite Plus post-emit path.
 *
 * Prefer on-disk assets over the in-memory `bundle` object — Rolldown does not
 * share that object across hooks the way Rollup does. When Rolldown/Vite Plus
 * has not finished writing on `writeBundle`, defer to `closeBundle`. If emit
 * facts are still missing, analyze without claiming `emittedAssets` so
 * `doctor/partial-analysis` stays honest.
 */
function createViteFamilyHooks(configured: DoctorOptions) {
  let analyzed = false;

  const run = async (
    hook: "writeBundle" | "closeBundle",
    meta: ViteHookMeta | undefined,
  ): Promise<void> => {
    if (analyzed) return;
    const root = configured.root ?? process.cwd();
    const detected = configured.viteLifecycle ?? (await detectViteLifecycle(root, meta));
    const lifecycle = withPostEmitHook(detected, hook);
    configured.viteLifecycle = lifecycle;

    const emittedAssets = await listViteEmittedAssets(root);
    // Rolldown can finish disk writes after writeBundle; wait for closeBundle.
    if (hook === "writeBundle" && emittedAssets.length === 0 && lifecycle.engine === "rolldown") {
      return;
    }

    analyzed = true;
    if (emittedAssets.length === 0 && lifecycle.engine === "rolldown") {
      // Honest gap: config/imports only; do not claim emit coverage.
      const result = await analyze(configured);
      failAfterCollect(result);
      return;
    }

    const result = await analyzeBuild(configured, emittedAssets);
    failAfterCollect(result);
  };

  return {
    async writeBundle(this: void) {
      // Runtime plugin context may expose public Rolldown/Vite meta on `this`.
      const meta = (this as unknown as { meta?: ViteHookMeta } | undefined)?.meta;
      await run("writeBundle", meta);
    },
    async closeBundle(this: void) {
      const meta = (this as unknown as { meta?: ViteHookMeta } | undefined)?.meta;
      await run("closeBundle", meta);
    },
  } as Pick<UnpluginOptions, "writeBundle"> & {
    closeBundle: NonNullable<UnpluginOptions["writeBundle"]>;
  };
}

/**
 * Build/CI-only invariant (#32 / #54): adapters may hook post-emit surfaces only
 * (`writeBundle` / `closeBundle` / `afterEmit` / `onAfterBuild`). Never register
 * `transform` / `load` / `banner` (or similar) hooks that inject Doctor into
 * client assets. Findings print once via the shared terminal reporter at the
 * end of analysis — adapters must not re-emit per-finding bundler logs (#46).
 */
function createDoctorPlugin(bundler: BundlerName) {
  return createUnplugin<DoctorOptions | undefined>((options = {}) => {
    const configured: DoctorOptions = {
      ...options,
      bundler,
    };
    const statsAssets = (value: unknown): string[] => {
      if (!value || typeof value !== "object") return [];
      const data = value as {
        assets?: Array<{ name?: string }>;
        children?: unknown[];
      };
      return [
        ...(data.assets ?? []).flatMap((asset) => (asset.name ? [asset.name] : [])),
        ...(data.children ?? []).flatMap(statsAssets),
      ];
    };

    return {
      name: "module-federation-doctor",
      enforce: "post",
      ...(bundler === "vite" ? createViteFamilyHooks(configured) : {}),
      ...(bundler === "rspack"
        ? {
            rspack(compiler) {
              attachDoctorAfterEmit(compiler, configured);
            },
          }
        : {}),
      ...(bundler === "webpack"
        ? {
            webpack(compiler) {
              attachDoctorAfterEmit(compiler, configured);
            },
          }
        : {}),
      ...(bundler === "rsbuild"
        ? {
            rsbuild: {
              setup(api) {
                if (!configured.root) configured.root = api.context.rootPath;
                api.onAfterBuild(async ({ stats }) => {
                  const assets = stats ? statsAssets(stats.toJson({ assets: true })) : [];
                  const result = await analyzeBuild(configured, assets);
                  failAfterCollect(result);
                });
              },
            },
          }
        : {}),
    };
  });
}

export const viteDoctor = createDoctorPlugin("vite");
export const rspackDoctor = createDoctorPlugin("rspack");
export const rsbuildDoctor = createDoctorPlugin("rsbuild");
export const webpackDoctor = createDoctorPlugin("webpack");
