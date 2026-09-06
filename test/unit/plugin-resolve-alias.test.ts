import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UnpluginContextMeta, UnpluginOptions } from "unplugin";
import { rsbuildDoctor, rspackDoctor, webpackDoctor } from "../../src/plugin.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function projectRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-alias-${name}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "dist", "remoteEntry.js"), "window.remote = {};\n");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name,
      dependencies: { "@module-federation/enhanced": "1.0.0", react: "19.1.1" },
    }),
  );
  return root;
}

function asSinglePlugin(value: UnpluginOptions | UnpluginOptions[]): UnpluginOptions {
  expect(Array.isArray(value)).toBe(false);
  return value as UnpluginOptions;
}

describe("webpack-family resolve.alias collection", () => {
  it("records overlapping compiler resolve.alias on webpack", async () => {
    const root = await projectRoot("webpack-alias");
    const taps: Array<
      (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      options: {
        resolve: { alias: { react: path.join(root, "src/shims/react.ts") } },
        output: { path: path.join(root, "dist") },
      },
      hooks: {
        afterEmit: {
          tapPromise(
            _name: string,
            fn: (compilation: {
              assets: Record<string, unknown>;
              errors: Error[];
            }) => Promise<void>,
          ) {
            taps.push(fn);
          },
        },
      },
    };
    const plugin = asSinglePlugin(
      webpackDoctor.raw(
        {
          root,
          moduleFederation: {
            name: "webpack_alias",
            filename: "remoteEntry.js",
            shared: { react: { singleton: true } },
          },
          mode: "ci",
          output: { formats: ["json"] },
          rules: {
            "doctor/partial-analysis": "off",
            "config/plugin-package-mismatch": "off",
            "artifact/remote-entry-missing": "off",
            "artifact/types-missing": "off",
            "artifact/types-metadata-missing": "off",
            "artifact/manifest-disabled": "off",
          },
        },
        { framework: "webpack", versions: { unplugin: "3.3.0" } } as UnpluginContextMeta,
      ),
    );
    plugin.webpack?.(compiler as never);
    await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { resolveAliases?: Record<string, string> } };
    expect(project.bundler.resolveAliases).toMatchObject({
      react: "./src/shims/react.ts",
    });
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as {
      findings: Array<{ ruleId: string }>;
    };
    expect(report.findings.map((item) => item.ruleId)).toContain("config/alias-share-bypass");
  });

  it("records overlapping compiler resolve.alias on rspack", async () => {
    const root = await projectRoot("rspack-alias");
    const taps: Array<
      (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      options: {
        resolve: { alias: { react: "./src/shims/react.ts" } },
        output: { path: path.join(root, "dist") },
      },
      hooks: {
        afterEmit: {
          tapPromise(
            _name: string,
            fn: (compilation: {
              assets: Record<string, unknown>;
              errors: Error[];
            }) => Promise<void>,
          ) {
            taps.push(fn);
          },
        },
      },
    };
    const plugin = asSinglePlugin(
      rspackDoctor.raw(
        {
          root,
          moduleFederation: {
            name: "rspack_alias",
            filename: "remoteEntry.js",
            shared: { react: { singleton: true } },
          },
          mode: "ci",
          output: { formats: ["json"] },
          rules: {
            "doctor/partial-analysis": "off",
            "config/plugin-package-mismatch": "off",
            "artifact/remote-entry-missing": "off",
            "artifact/types-missing": "off",
            "artifact/types-metadata-missing": "off",
            "artifact/manifest-disabled": "off",
          },
        },
        { framework: "rspack", versions: { unplugin: "3.3.0" } } as UnpluginContextMeta,
      ),
    );
    plugin.rspack?.(compiler as never);
    await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as {
      findings: Array<{ ruleId: string }>;
    };
    expect(report.findings.map((item) => item.ruleId)).toContain("config/alias-share-bypass");
  });

  it("records overlapping Rsbuild bundler resolve.alias from onBeforeCreateCompiler", async () => {
    const root = await projectRoot("rsbuild-alias");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          moduleFederation: {
            name: "rsbuild_alias",
            filename: "remoteEntry.js",
            shared: { react: { singleton: true } },
          },
          mode: "ci",
          output: { formats: ["json"] },
          rules: {
            "doctor/partial-analysis": "off",
            "config/plugin-package-mismatch": "off",
            "artifact/remote-entry-missing": "off",
            "artifact/types-missing": "off",
            "artifact/types-metadata-missing": "off",
            "artifact/manifest-disabled": "off",
          },
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let afterBuild: ((args: { stats: null }) => Promise<void>) | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      getRsbuildConfig() {
        return { source: { alias: () => ({}) } };
      },
      onBeforeCreateCompiler(
        fn: (args: {
          bundlerConfigs: Array<{ resolve: { alias: Record<string, string> } }>;
        }) => void,
      ) {
        fn({ bundlerConfigs: [{ resolve: { alias: { react: "./src/shims/react.ts" } } }] });
      },
      onAfterBuild(fn: (args: { stats: null }) => Promise<void>) {
        afterBuild = fn;
      },
    } as never);
    await afterBuild!({ stats: null });
    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { resolveAliases?: Record<string, string>; resolveAliasFunction?: boolean } };
    expect(project.bundler.resolveAliases).toMatchObject({ react: "./src/shims/react.ts" });
    expect(project.bundler.resolveAliasFunction).toBe(true);
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as {
      findings: Array<{ ruleId: string }>;
    };
    expect(report.findings.map((item) => item.ruleId)).toContain("config/alias-share-bypass");
  });

  it("does not warn when Rsbuild only exposes a function alias", async () => {
    const root = await projectRoot("rsbuild-alias-fn");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          moduleFederation: {
            name: "rsbuild_alias_fn",
            filename: "remoteEntry.js",
            shared: { react: { singleton: true } },
          },
          mode: "ci",
          output: { formats: ["json"] },
          rules: {
            "doctor/partial-analysis": "off",
            "config/plugin-package-mismatch": "off",
            "artifact/remote-entry-missing": "off",
            "artifact/types-missing": "off",
            "artifact/types-metadata-missing": "off",
            "artifact/manifest-disabled": "off",
          },
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let afterBuild: ((args: { stats: null }) => Promise<void>) | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      getRsbuildConfig() {
        return { source: { alias: () => ({ react: "./src/shims/react.ts" }) } };
      },
      onAfterBuild(fn: (args: { stats: null }) => Promise<void>) {
        afterBuild = fn;
      },
    } as never);
    await afterBuild!({ stats: null });
    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { resolveAliases?: Record<string, string>; resolveAliasFunction?: boolean } };
    expect(project.bundler.resolveAliases).toBeUndefined();
    expect(project.bundler.resolveAliasFunction).toBe(true);
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as {
      findings: Array<{ ruleId: string }>;
    };
    expect(report.findings.map((item) => item.ruleId)).not.toContain("config/alias-share-bypass");
  });
});
