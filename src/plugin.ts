import { createUnplugin } from "unplugin";
import fg from "fast-glob";
import { analyzeBuild } from "./engine.js";
import type { AnalysisResult, BundlerName, DoctorFinding, DoctorOptions } from "./types.js";

function formatFinding(finding: DoctorFinding): string {
  return `Module Federation Doctor [${finding.severity}] ${finding.ruleId}: ${finding.message}`;
}

function failAfterCollect(result: AnalysisResult): void {
  if (result.exitCode === 1) {
    const { errors, warnings, info } = result.report.summary;
    throw new Error(
      `Module Federation Doctor policy failed (${errors} error(s), ${warnings} warning(s), ${info} info). See .mf/doctor/report.json.`,
    );
  }
  if (result.exitCode === 2)
    throw new Error("Module Federation Doctor could not complete analysis.");
}

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
              const result = await analyzeBuild(configured, emittedAssets);
              const context = this as unknown as { warn?: (message: string) => void };
              for (const finding of result.report.findings) context.warn?.(formatFinding(finding));
              failAfterCollect(result);
            },
          }
        : {}),
      ...(bundler === "rspack"
        ? {
            rspack(compiler) {
              if (!configured.root) configured.root = compiler.context;
              compiler.hooks.afterEmit.tapPromise("ModuleFederationDoctor", async (compilation) => {
                const result = await analyzeBuild(configured, Object.keys(compilation.assets));
                const ErrorCtor =
                  (compiler as { webpack?: { WebpackError?: new (message: string) => Error } })
                    .webpack?.WebpackError ?? Error;
                for (const finding of result.report.findings) {
                  const diagnostic = new ErrorCtor(formatFinding(finding));
                  // Only treat as bundler errors when policy will fail; otherwise keep
                  // findings visible as warnings so failOn: "never" builds still succeed.
                  if (finding.severity === "error" && result.exitCode === 1)
                    compilation.errors.push(diagnostic);
                  else compilation.warnings.push(diagnostic);
                }
                failAfterCollect(result);
              });
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
                  for (const finding of result.report.findings) {
                    const message = formatFinding(finding);
                    const logger = api.logger as
                      | {
                          error?: (message: string) => void;
                          warn?: (message: string) => void;
                          info?: (message: string) => void;
                        }
                      | undefined;
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
