import { createUnplugin } from "unplugin";
import fg from "fast-glob";
import { analyzeBuild } from "./engine.js";
import type { BundlerName, DoctorOptions } from "./types.js";

function createDoctorPlugin(bundler: BundlerName) {
  return createUnplugin<DoctorOptions | undefined>((options = {}) => {
    const configured: DoctorOptions = {
      ...options,
      bundler,
    };
    const finish = async (emittedAssets: string[]) => {
      const result = await analyzeBuild(configured, emittedAssets);
      if (result.exitCode === 1)
        throw new Error("Module Federation Doctor policy failed. See .mf/doctor/report.json.");
      if (result.exitCode === 2) throw new Error("Module Federation Doctor could not complete.");
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
              await finish(emittedAssets);
            },
          }
        : {}),
      ...(bundler === "rspack"
        ? {
            rspack(compiler) {
              if (!configured.root) configured.root = compiler.context;
              compiler.hooks.afterEmit.tapPromise("ModuleFederationDoctor", async (compilation) =>
                finish(Object.keys(compilation.assets)),
              );
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
                  await finish(assets);
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
