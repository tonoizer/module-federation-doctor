import { createUnplugin } from "unplugin";
import fg from "fast-glob";
import { analyzeBuild } from "./engine.js";
import type { AnalysisResult, BundlerName, DoctorOptions } from "./types.js";

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

type CompilerLike = {
  context: string;
  hooks: {
    afterEmit: {
      tapPromise: (name: string, fn: (compilation: CompilationLike) => Promise<void>) => void;
    };
  };
  webpack?: { WebpackError?: new (message: string) => Error };
};

/**
 * Post-emit only: analyze emitted assets, print via the shared terminal reporter
 * inside analyzeBuild, then fail the compilation once if policy requires it.
 * Do not push per-finding warnings — that double-prints with the terminal block.
 */
function attachCompilationAfterEmit(compiler: CompilerLike, configured: DoctorOptions): void {
  if (!configured.root) configured.root = compiler.context;
  compiler.hooks.afterEmit.tapPromise("ModuleFederationDoctor", async (compilation) => {
    const result = await analyzeBuild(configured, Object.keys(compilation.assets));
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

/**
 * Build/CI-only invariant (#32 / #54): adapters may hook post-emit surfaces only
 * (`writeBundle` / `afterEmit` / `onAfterBuild`). Never register
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
      ...(bundler === "vite"
        ? {
            async writeBundle() {
              const root = configured.root ?? process.cwd();
              const emittedAssets = await fg(["dist/**/*", "build/**/*"], {
                cwd: root,
                onlyFiles: true,
              });
              // analyzeBuild prints the findings block once; preserve severity via failOn.
              const result = await analyzeBuild(configured, emittedAssets);
              failAfterCollect(result);
            },
          }
        : {}),
      ...(bundler === "rspack"
        ? {
            rspack(compiler) {
              attachCompilationAfterEmit(compiler, configured);
            },
          }
        : {}),
      ...(bundler === "webpack"
        ? {
            webpack(compiler) {
              attachCompilationAfterEmit(compiler, configured);
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
