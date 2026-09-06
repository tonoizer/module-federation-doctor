import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UnpluginContextMeta, UnpluginOptions } from "unplugin";
import { moduleFederationDoctorPlugin, type BundlerChainLike } from "../../src/modern.js";
import { rsbuildDoctor, type CompilerLike } from "../../src/plugin.js";
import type { DoctorOptions } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const quietRules: DoctorOptions["rules"] = {
  "doctor/partial-analysis": "off",
  "config/plugin-package-mismatch": "off",
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "artifact/types-metadata-missing": "off",
  "artifact/manifest-disabled": "off",
};

const antdArcoTransformImport = [
  { libraryName: "antd", libraryDirectory: "es", style: true },
  {
    libraryName: "@arco-design/web-react",
    libraryDirectory: "es",
    camelToDashComponentName: false,
  },
];

const sharedAntdArco = {
  antd: { singleton: true },
  "@arco-design/web-react": { singleton: true },
};

async function projectRoot(name: string, federationPackage: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-transform-import-${name}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "dist", "remoteEntry.js"), "window.remote = {};\n");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name,
      dependencies: {
        [`@module-federation/${federationPackage}`]: "1.0.0",
        antd: "4.24.0",
        "@arco-design/web-react": "2.66.0",
      },
    }),
  );
  return root;
}

function asSinglePlugin(value: UnpluginOptions | UnpluginOptions[]): UnpluginOptions {
  expect(Array.isArray(value)).toBe(false);
  return value as UnpluginOptions;
}

async function readEmit(root: string): Promise<{
  libraries: string[] | undefined;
  ruleIds: string[];
}> {
  const project = JSON.parse(
    await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
  ) as { bundler: { transformImportLibraries?: string[] } };
  const report = JSON.parse(
    await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
  ) as {
    findings: Array<{ ruleId: string }>;
  };
  return {
    libraries: project.bundler.transformImportLibraries,
    ruleIds: report.findings.map((item) => item.ruleId),
  };
}

describe("adapter transformImport library facts (BL-45)", () => {
  it("emits config/transform-import-share-conflict from Rsbuild source.transformImport", async () => {
    const root = await projectRoot("rsbuild-antd", "rsbuild-plugin");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          moduleFederation: {
            name: "rsbuild_antd",
            filename: "remoteEntry.js",
            shared: sharedAntdArco,
          },
          mode: "ci",
          output: { formats: ["json"] },
          rules: quietRules,
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let afterBuild: ((args: { stats: null }) => Promise<void>) | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      getNormalizedConfig() {
        return { source: { transformImport: antdArcoTransformImport } };
      },
      getRsbuildConfig() {
        return { source: {} };
      },
      onAfterBuild(fn: (args: { stats: null }) => Promise<void>) {
        afterBuild = fn;
      },
    } as never);
    await afterBuild!({ stats: null });
    const emit = await readEmit(root);
    expect(emit.libraries).toEqual(["@arco-design/web-react", "antd"]);
    expect(emit.ruleIds).toContain("config/transform-import-share-conflict");
  });

  it("does not invoke function-form Rsbuild transformImport (documented skip)", async () => {
    const root = await projectRoot("rsbuild-transform-fn", "rsbuild-plugin");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          moduleFederation: {
            name: "rsbuild_transform_fn",
            filename: "remoteEntry.js",
            shared: sharedAntdArco,
          },
          mode: "ci",
          output: { formats: ["json"] },
          rules: quietRules,
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let invoked = false;
    let afterBuild: ((args: { stats: null }) => Promise<void>) | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      getRsbuildConfig() {
        return {
          source: {
            transformImport: () => {
              invoked = true;
              return antdArcoTransformImport;
            },
          },
        };
      },
      onAfterBuild(fn: (args: { stats: null }) => Promise<void>) {
        afterBuild = fn;
      },
    } as never);
    await afterBuild!({ stats: null });
    expect(invoked).toBe(false);
    const emit = await readEmit(root);
    expect(emit.libraries).toBeUndefined();
    expect(emit.ruleIds).not.toContain("config/transform-import-share-conflict");
  });

  it("records transformImport: false as an empty observed list", async () => {
    const root = await projectRoot("rsbuild-transform-false", "rsbuild-plugin");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          moduleFederation: {
            name: "rsbuild_transform_false",
            filename: "remoteEntry.js",
            shared: sharedAntdArco,
          },
          mode: "ci",
          output: { formats: ["json"] },
          rules: quietRules,
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let afterBuild: ((args: { stats: null }) => Promise<void>) | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      getRsbuildConfig() {
        return { source: { transformImport: false } };
      },
      onAfterBuild(fn: (args: { stats: null }) => Promise<void>) {
        afterBuild = fn;
      },
    } as never);
    await afterBuild!({ stats: null });
    const emit = await readEmit(root);
    expect(emit.libraries).toEqual([]);
    expect(emit.ruleIds).not.toContain("config/transform-import-share-conflict");
  });

  it("emits config/transform-import-share-conflict from Modern getNormalizedConfig", async () => {
    const root = await projectRoot("modern-antd", "modern-js");
    const plugin = moduleFederationDoctorPlugin({
      root,
      moduleFederation: {
        name: "modern_antd",
        filename: "remoteEntry.js",
        shared: sharedAntdArco,
      },
      mode: "ci",
      output: { formats: ["json"] },
      rules: quietRules,
    });
    const registered: Array<{ apply: (compiler: CompilerLike) => void }> = [];
    await plugin.setup({
      getAppContext: () => ({
        appDirectory: root,
        bundlerType: "rspack",
        isProd: true,
      }),
      getNormalizedConfig() {
        return { source: { transformImport: antdArcoTransformImport } };
      },
      modifyBundlerChain(handler) {
        const chain: BundlerChainLike = {
          plugin() {
            return {
              use(value: unknown) {
                registered.push(value as { apply: (compiler: CompilerLike) => void });
                return this;
              },
            };
          },
        };
        handler(chain, { env: "production", target: "web" });
      },
    });
    const taps: Array<
      (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      options: { output: { path: path.join(root, "dist") } },
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
    } as CompilerLike;
    registered[0]!.apply(compiler);
    await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });
    const emit = await readEmit(root);
    expect(emit.libraries).toEqual(["@arco-design/web-react", "antd"]);
    expect(emit.ruleIds).toContain("config/transform-import-share-conflict");
  });

  it("skips when Modern stub APIs omit public config (documented skip)", async () => {
    const root = await projectRoot("modern-stub", "modern-js");
    const plugin = moduleFederationDoctorPlugin({
      root,
      moduleFederation: {
        name: "modern_stub",
        filename: "remoteEntry.js",
        shared: sharedAntdArco,
      },
      mode: "ci",
      output: { formats: ["json"] },
      rules: quietRules,
    });
    const registered: Array<{ apply: (compiler: CompilerLike) => void }> = [];
    await plugin.setup({
      getAppContext: () => ({
        appDirectory: root,
        bundlerType: "rspack",
        isProd: true,
      }),
      modifyBundlerChain(handler) {
        const chain: BundlerChainLike = {
          plugin() {
            return {
              use(value: unknown) {
                registered.push(value as { apply: (compiler: CompilerLike) => void });
                return this;
              },
            };
          },
        };
        handler(chain);
      },
    });
    const taps: Array<
      (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      options: { output: { path: path.join(root, "dist") } },
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
    } as CompilerLike;
    registered[0]!.apply(compiler);
    await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });
    const emit = await readEmit(root);
    expect(emit.libraries).toBeUndefined();
    expect(emit.ruleIds).not.toContain("config/transform-import-share-conflict");
  });
});
