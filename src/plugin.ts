import { createUnplugin } from "unplugin";
import fg from "fast-glob";
import { analyzeBuild } from "./engine.js";
import type { AnalysisResult, BundlerName, DoctorFinding, DoctorOptions } from "./types.js";

function formatFinding(finding: DoctorFinding): string {
  return `Module Federation Doctor [${finding.severity}] ${finding.ruleId}: ${finding.message}`;
}

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
  warnings: Error[];
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

function attachCompilationAfterEmit(compiler: CompilerLike, configured: DoctorOptions): void {
  if (!configured.root) configured.root = compiler.context;
  compiler.hooks.afterEmit.tapPromise("ModuleFederationDoctor", async (compilation) => {
    const result = await analyzeBuild(configured, Object.keys(compilation.assets));
    const ErrorCtor = compiler.webpack?.WebpackError ?? Error;
    const policyErrors: Error[] = [];
    // Pass 1: publish every finding (as warnings) so nothing is lost mid-hook.
    for (const finding of result.report.findings) {
      const diagnostic = new ErrorCtor(formatFinding(finding));
      compilation.warnings.push(diagnostic);
      if (finding.severity === "error" && result.exitCode === 1) {
        policyErrors.push(diagnostic);
      }
    }
    // Pass 2: attach all policy errors together, then throw once.
    for (const diagnostic of policyErrors) compilation.errors.push(diagnostic);
    failAfterCollect(result);
  });
}

/**
 * Build/CI-only invariant (#32): adapters may hook post-emit surfaces only
 * (`writeBundle` / `afterEmit` / `onAfterBuild`). Never register
 * `transform` / `load` / `banner` (or similar) hooks that inject Doctor into
 * client assets.
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
              // Collect every finding first (analyzeBuild runs all rules).
              const result = await analyzeBuild(configured, emittedAssets);
              const context = this as unknown as { warn?: (message: string) => void };
              // Report every finding before any throw.
              for (const finding of result.report.findings) {
                context.warn?.(formatFinding(finding));
              }
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
                  const logger = api.logger as
                    | {
                        error?: (message: string) => void;
                        warn?: (message: string) => void;
                        info?: (message: string) => void;
                      }
                    | undefined;
                  for (const finding of result.report.findings) {
                    const message = formatFinding(finding);
                    if (finding.severity === "error") logger?.error?.(message);
                    else if (finding.severity === "warning") logger?.warn?.(message);
                    else logger?.info?.(message);
                  }
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
