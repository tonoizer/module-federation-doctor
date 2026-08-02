import { createUnplugin, type UnpluginOptions } from "unplugin";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { analyzeBuild } from "./engine.js";
import type { BuildDiagnostics } from "./collect.js";
import type {
  AnalysisResult,
  BuildOutputInput,
  BundlerName,
  DoctorOptions,
  ModernContextFacts,
  OutputPublicPathKind,
} from "./types.js";
import { normalizePath, relativePath } from "./utils.js";
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
  name?: string;
  hash?: string | null;
  fullHash?: string | null;
};

export type CompilerLike = {
  context: string;
  name?: string;
  hooks: {
    afterEmit: {
      tapPromise: (name: string, fn: (compilation: CompilationLike) => Promise<void>) => void;
    };
  };
  webpack?: { WebpackError?: new (message: string) => Error };
  options?: {
    name?: string;
    mode?: string;
    target?: string | string[] | false;
    plugins?: unknown[];
    output?: { path?: string; publicPath?: unknown };
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

function compilerTargetKind(
  target: string | string[] | false | undefined,
): BuildOutputInput["targetKind"] {
  if (!target) return undefined;
  const value = (Array.isArray(target) ? target.join(",") : target).toLowerCase();
  if (value.includes("worker")) return "worker";
  if (value.includes("node") || value.includes("async-node") || value.includes("electron"))
    return "node";
  if (value.includes("web")) return "web";
  return "unknown";
}

function compilerOutputRoot(compiler: CompilerLike): string | undefined {
  const outputPath = compiler.options?.output?.path;
  if (!outputPath) return undefined;
  const root = path.resolve(compiler.context);
  const absolute = path.resolve(root, outputPath);
  const relative = relativePath(root, absolute);
  return relative.startsWith("[external]/") ? undefined : normalizePath(relative);
}

type RsbuildStatsJsonLike = {
  assets?: Array<{ name?: unknown }>;
  children?: unknown[];
  name?: unknown;
  outputPath?: unknown;
  hash?: unknown;
  fullHash?: unknown;
  mode?: unknown;
  target?: unknown;
};

type RsbuildStatsLike = {
  toJson: (...args: never[]) => unknown;
};

function rsbuildTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return (value as string[]).join(",");
  return undefined;
}

function rsbuildOutputRoot(root: string, value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const absolute = path.resolve(root, value);
  const relative = relativePath(path.resolve(root), absolute);
  return relative.startsWith("[external]/") ? undefined : normalizePath(relative);
}

function rsbuildAssetName(value: string, outputRoot: string | undefined): string {
  const normalized = normalizePath(value);
  if (outputRoot && outputRoot !== "." && normalized.startsWith(`${outputRoot}/`))
    return normalized.slice(outputRoot.length + 1);
  return normalized;
}

/**
 * Convert public Rsbuild/Rspack stats JSON into one build input per stats node.
 * Children stay separate so parent and child compiler assets cannot be joined.
 */
function collectRsbuildBuildOutputs(stats: RsbuildStatsLike, root: string): BuildOutputInput[] {
  const outputs: BuildOutputInput[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const data = value as RsbuildStatsJsonLike;
    const target = rsbuildTarget(data.target);
    const children = Array.isArray(data.children) ? data.children : [];
    const reportedOutputRoot = rsbuildOutputRoot(root, data.outputPath);
    const emittedAssets = (data.assets ?? [])
      .flatMap((asset) =>
        typeof asset.name === "string" ? [rsbuildAssetName(asset.name, reportedOutputRoot)] : [],
      )
      .sort();
    // A real MultiStats wrapper can carry an aggregate hash while leaving all
    // useful build data on its children. Do not turn that wrapper into a
    // phantom empty build or let it downgrade emitted-asset capability.
    const isMultiStatsWrapper =
      children.length > 0 &&
      emittedAssets.length === 0 &&
      typeof data.name !== "string" &&
      reportedOutputRoot === undefined &&
      typeof data.mode !== "string" &&
      target === undefined;
    // Missing/unsafe outputPath is still safe to represent at the project
    // root. Stats asset names are then project-relative, and discovered
    // artifacts keep their normal paths for matching.
    const outputRoot = isMultiStatsWrapper ? undefined : (reportedOutputRoot ?? ".");
    const isBuild =
      !isMultiStatsWrapper &&
      (emittedAssets.length > 0 ||
        (typeof data.name === "string" && data.name.length > 0) ||
        outputRoot !== undefined ||
        (typeof data.fullHash === "string" && data.fullHash.length > 0) ||
        (typeof data.hash === "string" && data.hash.length > 0) ||
        (typeof data.mode === "string" && data.mode.length > 0) ||
        target !== undefined);
    if (isBuild) {
      outputs.push({
        adapter: "rsbuild",
        bundler: "rsbuild",
        ...(typeof data.name === "string" && data.name.length > 0
          ? { compilationName: data.name }
          : {}),
        ...(outputRoot ? { outputRoot } : {}),
        ...(typeof data.fullHash === "string" && data.fullHash.length > 0
          ? { hash: data.fullHash }
          : typeof data.hash === "string" && data.hash.length > 0
            ? { hash: data.hash }
            : {}),
        emittedAssets: [...new Set(emittedAssets)],
        emittedAssetsSource: "bundle",
        sourceHook: "onAfterBuild",
        ...(typeof data.mode === "string" && data.mode.length > 0
          ? { effectiveMode: data.mode }
          : {}),
        ...(target !== undefined
          ? {
              target,
              ...(compilerTargetKind(target) ? { targetKind: compilerTargetKind(target) } : {}),
            }
          : {}),
      });
    }
    for (const child of data.children ?? []) visit(child);
  };

  visit(stats.toJson({ assets: true } as never));
  return outputs;
}

export function compilerBuildOutput(
  compiler: CompilerLike,
  compilation: CompilationLike,
  adapter: BundlerName,
  modernContext?: ModernContextFacts,
): BuildOutputInput {
  const compilerName =
    typeof compiler.name === "string" && compiler.name.length > 0
      ? compiler.name
      : typeof compiler.options?.name === "string" && compiler.options.name.length > 0
        ? compiler.options.name
        : undefined;
  const outputRoot = compilerOutputRoot(compiler);
  const hash =
    typeof compilation.fullHash === "string"
      ? compilation.fullHash
      : typeof compilation.hash === "string"
        ? compilation.hash
        : undefined;
  const compilerTarget = compiler.options?.target;
  const target =
    typeof compilerTarget === "string"
      ? compilerTarget
      : Array.isArray(compilerTarget)
        ? compilerTarget.join(",")
        : modernContext?.target;
  const effectiveMode = compiler.options?.mode || modernContext?.env;
  return {
    adapter,
    bundler: adapter,
    ...(compilerName ? { compilerName } : {}),
    ...(typeof compilation.name === "string" && compilation.name.length > 0
      ? { compilationName: compilation.name }
      : {}),
    ...(hash ? { hash } : {}),
    ...(outputRoot ? { outputRoot } : {}),
    emittedAssets: Object.keys(compilation.assets).sort(),
    emittedAssetsSource: "bundle",
    sourceHook: "afterEmit",
    ...(effectiveMode ? { effectiveMode } : {}),
    ...(target ? { target } : {}),
    ...(compilerTargetKind(target) ? { targetKind: compilerTargetKind(target) } : {}),
    ...(modernContext ? { modernContext } : {}),
  };
}

/**
 * Post-emit only: analyze emitted assets, print via the shared terminal reporter
 * inside analyzeBuild, then fail the compilation once if policy requires it.
 * Do not push per-finding warnings — that double-prints with the terminal block.
 * Shared by Rspack, Webpack, and the Modern.js adapter (which composes this hook).
 */
export function attachDoctorAfterEmit(
  compiler: CompilerLike,
  configured: DoctorOptions,
  modernContext?: ModernContextFacts,
): void {
  if (!configured.root) configured.root = compiler.context;
  compiler.hooks.afterEmit.tapPromise("ModuleFederationDoctor", async (compilation) => {
    const diagnostics = collectCompilerDiagnostics(compiler);
    const output = compilerBuildOutput(
      compiler,
      compilation,
      configured.bundler ?? "webpack",
      modernContext,
    );
    const emittedAssets = output.outputRoot
      ? output.emittedAssets.map((asset) => `${output.outputRoot}/${asset}`)
      : output.emittedAssets;
    const result = await analyzeBuild(configured, emittedAssets, diagnostics, [output]);
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

type ViteResolvedConfigLike = {
  root?: string;
  command?: string;
  mode?: string;
  build?: {
    outDir?: string;
    write?: boolean;
    ssr?: boolean;
    target?: string;
    rollupOptions?: {
      output?: { manualChunks?: unknown } | Array<{ manualChunks?: unknown }>;
    };
    // Rolldown / Vite Plus
    codeSplitting?: { groups?: unknown };
  };
  ssr?: { target?: string };
  resolve?: { alias?: unknown };
  server?: { origin?: string };
};

function extractViteConfigFacts(
  config: ViteResolvedConfigLike,
): import("./types.js").ViteBundlerConfigFacts {
  const facts: import("./types.js").ViteBundlerConfigFacts = {};
  const output = config.build?.rollupOptions?.output;
  const outputs = Array.isArray(output) ? output : output ? [output] : [];
  if (outputs.some((item) => item.manualChunks !== undefined)) facts.manualChunks = true;
  if (config.build?.codeSplitting?.groups !== undefined) facts.codeSplittingGroups = true;

  const aliases: Record<string, string> = {};
  const alias = config.resolve?.alias;
  if (alias && typeof alias === "object" && !Array.isArray(alias)) {
    for (const [key, value] of Object.entries(alias as Record<string, unknown>)) {
      if (typeof value === "string") aliases[key] = value;
    }
  } else if (Array.isArray(alias)) {
    for (const entry of alias) {
      if (!entry || typeof entry !== "object") continue;
      const find = (entry as { find?: unknown }).find;
      const replacement = (entry as { replacement?: unknown }).replacement;
      if (typeof find === "string" && typeof replacement === "string") aliases[find] = replacement;
    }
  }
  if (Object.keys(aliases).length > 0) facts.resolveAliases = aliases;

  // Record origin observation whenever `server` is present on the resolved config.
  if (config.server) {
    const origin = config.server.origin;
    facts.serverOrigin = typeof origin === "string" && origin.length > 0 ? origin : null;
  }

  return facts;
}

type ViteOutputOptionsLike = { dir?: string; file?: string };

function targetKind(config: ViteResolvedConfigLike): BuildOutputInput["targetKind"] {
  const raw =
    config.build?.ssr || config.ssr?.target ? (config.ssr?.target ?? "ssr") : config.build?.target;
  if (!raw) return undefined;
  const value = String(raw).toLowerCase();
  if (value.includes("node") || value.includes("deno") || value.includes("bun")) return "node";
  if (value.includes("worker")) return "worker";
  if (config.build?.ssr) return "ssr";
  return "web";
}

/** List files under a known safe project-relative output root only. */
async function listBoundedOutputAssets(root: string, outputRoot: string): Promise<string[]> {
  const cwd = path.join(root, outputRoot === "." ? "" : outputRoot);
  const files = await fg(["**/*"], {
    cwd,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  return files.map((file) => file.replaceAll("\\", "/")).sort();
}

async function safeOutputRoot(
  root: string,
  value: string | undefined,
): Promise<string | undefined> {
  if (!value) return undefined;
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (relative !== "" && relative.startsWith("..")) return undefined;
  const rootReal = await fs.realpath(root).catch(() => undefined);
  const outputReal = await fs.realpath(absolute).catch(() => undefined);
  const outputStat = await fs.lstat(absolute).catch(() => undefined);
  if (outputStat?.isSymbolicLink() && !outputReal) return undefined;
  let existing = absolute;
  let existingReal = outputReal;
  while (!existingReal && existing !== path.dirname(existing)) {
    const stat = await fs.lstat(existing).catch(() => undefined);
    if (stat?.isSymbolicLink()) {
      const linkTarget = await fs.readlink(existing).catch(() => undefined);
      if (linkTarget) {
        const resolvedTarget = path.resolve(path.dirname(existing), linkTarget);
        const targetReal = await fs.realpath(resolvedTarget).catch(() => undefined);
        const checkedTarget = targetReal ?? resolvedTarget;
        if (rootReal && (path.relative(rootReal, checkedTarget) || ".").startsWith(".."))
          return undefined;
      }
    }
    existing = path.dirname(existing);
    existingReal = await fs.realpath(existing).catch(() => undefined);
  }
  if (rootReal && existingReal && (path.relative(rootReal, existingReal) || ".").startsWith(".."))
    return undefined;
  return relative === "" ? "." : relative;
}

/**
 * Vite / Rolldown / Vite Plus post-emit path.
 *
 * Prefer exact `writeBundle` bundle keys when present. When Rolldown/Vite Plus
 * finishes disk writes after an empty `writeBundle`, recover with a bounded
 * scan of the known safe output root at `closeBundle` and mark that evidence
 * partial. Never rescan unrelated project `dist`/`build` trees. Analysis runs
 * once after the output set is finalized.
 */
function createViteFamilyHooks(configured: DoctorOptions) {
  let resolvedConfig: ViteResolvedConfigLike | undefined;
  let outputs: BuildOutputInput[] = [];
  let pendingCloseFinalization: number | undefined;

  const run = async (
    hook: "writeBundle" | "closeBundle",
    meta: ViteHookMeta | undefined,
    outputOptions?: ViteOutputOptionsLike,
    bundle?: Record<string, unknown>,
  ): Promise<void> => {
    const root = configured.root ?? process.cwd();
    const detected = configured.viteLifecycle ?? (await detectViteLifecycle(root, meta));
    const lifecycle = withPostEmitHook(detected, hook);
    configured.viteLifecycle = lifecycle;
    const config = resolvedConfig;
    const requestedOutputRoot =
      outputOptions?.dir ??
      (outputOptions?.file ? path.dirname(outputOptions.file) : undefined) ??
      config?.build?.outDir;
    const outputRoot = await safeOutputRoot(root, requestedOutputRoot);
    const emittedAssets = bundle ? Object.keys(bundle).sort() : [];
    // An explicitly supplied unsafe root is not an unavailable root. Drop the
    // whole output so its assets cannot become exact evidence through fallback,
    // but let closeBundle still finalize the current cycle.
    if (!(requestedOutputRoot && !outputRoot)) {
      const publicConfig = config ?? {};
      const input: BuildOutputInput = {
        adapter: "vite",
        bundler: "vite",
        ...(outputRoot ? { outputRoot } : {}),
        emittedAssets,
        ...(emittedAssets.length > 0 ? { emittedAssetsSource: "bundle" as const } : {}),
        sourceHook: hook,
        ...(config?.mode ? { effectiveMode: config.mode } : {}),
        ...(config?.ssr?.target
          ? { target: config.ssr.target }
          : config?.build?.target
            ? { target: config.build.target }
            : {}),
        ...(targetKind(publicConfig) ? { targetKind: targetKind(publicConfig) } : {}),
        ...(config?.build?.write !== undefined ? { buildWrite: config.build.write } : {}),
        flavor: lifecycle.flavor,
        engine: lifecycle.engine,
      };
      if (hook === "writeBundle" || outputs.length === 0) {
        outputs.push(input);
        if (hook === "writeBundle" && lifecycle.engine === "rolldown" && emittedAssets.length === 0)
          pendingCloseFinalization = outputs.length - 1;
      } else if (lifecycle.engine === "rolldown" && pendingCloseFinalization !== undefined) {
        const pending = outputs[pendingCloseFinalization];
        let recovered: string[] = [];
        if (pending?.outputRoot && pending.buildWrite !== false)
          recovered = await listBoundedOutputAssets(root, pending.outputRoot);
        outputs = outputs.map((item, index) => {
          if (index !== pendingCloseFinalization) return item;
          if (recovered.length === 0) return { ...item, sourceHook: hook };
          return {
            ...item,
            sourceHook: hook,
            emittedAssets: recovered,
            emittedAssetsSource: "output-root-scan" as const,
          };
        });
        pendingCloseFinalization = undefined;
      }
    }
    if (hook === "writeBundle") return;
    try {
      const allAssets = outputs.flatMap((item) =>
        item.buildWrite === false
          ? []
          : item.outputRoot
            ? item.emittedAssets.map((asset) => `${item.outputRoot}/${asset}`)
            : item.emittedAssets,
      );
      const result = await analyzeBuild(configured, allAssets, undefined, outputs);
      failAfterCollect(result);
    } finally {
      outputs = [];
      pendingCloseFinalization = undefined;
    }
  };

  return {
    configResolved(config: ViteResolvedConfigLike) {
      resolvedConfig = config;
      if (!configured.root && config.root) configured.root = config.root;
      const facts = extractViteConfigFacts(config);
      if (Object.keys(facts).length > 0) configured.viteConfigFacts = facts;
    },
    buildStart() {
      outputs = [];
      pendingCloseFinalization = undefined;
    },
    async writeBundle(
      this: unknown,
      outputOptions?: ViteOutputOptionsLike,
      bundle?: Record<string, unknown>,
    ) {
      // Runtime plugin context may expose public Rolldown/Vite meta on `this`.
      const meta = (this as unknown as { meta?: ViteHookMeta } | undefined)?.meta;
      await run("writeBundle", meta, outputOptions, bundle);
    },
    async closeBundle(this: unknown) {
      const meta = (this as unknown as { meta?: ViteHookMeta } | undefined)?.meta;
      await run("closeBundle", meta);
    },
  } as Pick<UnpluginOptions, "writeBundle"> & {
    configResolved: (config: ViteResolvedConfigLike) => void;
    buildStart: NonNullable<UnpluginOptions["buildStart"]>;
    closeBundle: NonNullable<UnpluginOptions["writeBundle"]>;
  };
}

/**
 * Build/CI-only invariant (#32 / #54): adapters may gather facts from public
 * build hooks (`configResolved` / `buildStart`) and analyze only on post-emit
 * surfaces (`writeBundle` / `closeBundle` / `afterEmit` / `onAfterBuild`).
 * Never register `transform` / `load` / `banner` (or similar) hooks that inject
 * Doctor into client assets. Findings print once via the shared terminal
 * reporter at the end of analysis — adapters must not re-emit per-finding
 * bundler logs (#46).
 */
function createDoctorPlugin(bundler: BundlerName) {
  return createUnplugin<DoctorOptions | undefined>((options = {}) => {
    const configured: DoctorOptions = {
      ...options,
      bundler,
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
                  const outputs = stats
                    ? collectRsbuildBuildOutputs(stats, configured.root ?? api.context.rootPath)
                    : [];
                  const assets = [
                    ...new Set(
                      outputs.flatMap((output) =>
                        output.outputRoot
                          ? output.emittedAssets.map((asset) => `${output.outputRoot}/${asset}`)
                          : output.emittedAssets,
                      ),
                    ),
                  ];
                  const result = await analyzeBuild(
                    configured,
                    assets,
                    undefined,
                    outputs.length > 0 ? outputs : undefined,
                  );
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
