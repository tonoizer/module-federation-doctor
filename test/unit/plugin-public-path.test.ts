import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UnpluginContextMeta, UnpluginOptions } from "unplugin";
import { rsbuildNormalizedConfig } from "../../fixtures/public-path-non-string/rsbuild.js";
import { viteFederationOptions } from "../../fixtures/public-path-non-string/vite.js";
import { rsbuildDoctor, viteDoctor } from "../../src/plugin.js";
import type { ModuleFederationConfigLike, RuleSetting } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

type VitePluginHooks = UnpluginOptions & {
  configResolved?: (config: unknown) => void;
  writeBundle?: (
    this: unknown,
    outputOptions?: { dir?: string; file?: string },
    bundle?: Record<string, unknown>,
  ) => Promise<void>;
  closeBundle?: (this: unknown) => Promise<void>;
};

function asSinglePlugin(value: UnpluginOptions | UnpluginOptions[]): UnpluginOptions {
  expect(Array.isArray(value)).toBe(false);
  return value as UnpluginOptions;
}

async function makeRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-${name}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "dist/remoteEntry.js"), "export {};\n");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name,
      dependencies: {
        "@module-federation/vite": "1.0.0",
        "@module-federation/rsbuild-plugin": "1.0.0",
      },
    }),
  );
  return root;
}

const quietRules = {
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "artifact/expose-missing": "off",
  "config/plugin-package-mismatch": "off",
  "vite/host-init-inject-ssr": "off",
  "vite/manual-chunks-conflict": "off",
  "vite/server-origin": "off",
  "vite/alias-share-bypass": "off",
  "vite/remote-hmr-dev": "off",
} satisfies Record<string, RuleSetting>;

describe("Vite/Rsbuild publicPath kind", () => {
  it("records a non-string Vite MF publicPath and reports the manifest rule", async () => {
    const root = await makeRoot("vite-public-path-fn");
    const raw = viteDoctor.raw(
      {
        root,
        bundler: "vite",
        mode: "ci",
        output: { formats: ["json"] },
        moduleFederation: viteFederationOptions as unknown as ModuleFederationConfigLike,
        rules: { ...quietRules, "doctor/partial-analysis": "off" },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = asSinglePlugin(raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "dist", write: true },
    });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "remoteEntry.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { outputPublicPathKind?: string } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.bundler.outputPublicPathKind).toBe("non-string");
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "artifact/public-path-non-string-manifest",
      ),
    ).toBe(true);
  });

  it("records Vite MF publicPath from a public plugin options object", async () => {
    const root = await makeRoot("vite-public-path-plugin");
    const raw = viteDoctor.raw(
      {
        root,
        bundler: "vite",
        mode: "ci",
        output: { formats: ["json"] },
        moduleFederation: {
          name: "public_path_non_string",
          filename: "remoteEntry.js",
          manifest: true,
          exposes: { "./Widget": "./src/Widget.ts" },
          shared: {},
        },
        rules: { ...quietRules, "doctor/partial-analysis": "off" },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = asSinglePlugin(raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "dist", write: true },
      plugins: [
        {
          name: "@module-federation/vite",
          options: viteFederationOptions,
        },
      ],
    });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "remoteEntry.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { outputPublicPathKind?: string } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.bundler.outputPublicPathKind).toBe("non-string");
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "artifact/public-path-non-string-manifest",
      ),
    ).toBe(true);
  });

  it("records an omitted Vite MF publicPath as unknown instead of skipping silently", async () => {
    const root = await makeRoot("vite-public-path-unknown");
    const raw = viteDoctor.raw(
      {
        root,
        bundler: "vite",
        mode: "ci",
        output: { formats: ["json"] },
        moduleFederation: {
          name: "public_path_unknown",
          filename: "remoteEntry.js",
          manifest: true,
          exposes: { "./Widget": "./src/Widget.ts" },
          shared: {},
        },
        rules: { ...quietRules, "doctor/partial-analysis": "off" },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = asSinglePlugin(raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "dist", write: true },
    });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "remoteEntry.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { outputPublicPathKind?: string } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.bundler.outputPublicPathKind).toBe("unknown");
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "artifact/public-path-non-string-manifest",
      ),
    ).toBe(false);
  });

  it("emits doctor/partial-analysis when Vite publicPath is unobserved", async () => {
    const root = await makeRoot("vite-public-path-unobserved");
    const raw = viteDoctor.raw(
      {
        root,
        bundler: "vite",
        mode: "ci",
        output: { formats: ["json"] },
        rules: { ...quietRules, "doctor/partial-analysis": "warning" },
      },
      { framework: "vite", versions: { unplugin: "3.3.0" } } as never,
    );
    const plugin = asSinglePlugin(raw) as VitePluginHooks;
    plugin.configResolved?.({
      root,
      mode: "production",
      build: { outDir: "dist", write: true },
      plugins: [],
    });
    await plugin.writeBundle!.call({}, { dir: path.join(root, "dist") }, { "remoteEntry.js": {} });
    await plugin.closeBundle!.call({});

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { outputPublicPathKind?: string } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string; evidence?: { missing?: string[] } }> };

    expect(project.bundler.outputPublicPathKind).toBeUndefined();
    const partial = report.findings.find((finding) => finding.ruleId === "doctor/partial-analysis");
    expect(partial?.evidence?.missing).toEqual(expect.arrayContaining(["outputPublicPath"]));
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "artifact/public-path-non-string-manifest",
      ),
    ).toBe(false);
  });

  it("records a non-string Rsbuild output.publicPath from public config", async () => {
    const root = await makeRoot("rsbuild-public-path-fn");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          bundler: "rsbuild",
          mode: "ci",
          output: { formats: ["json"] },
          moduleFederation: {
            name: "public_path_non_string",
            filename: "remoteEntry.js",
            manifest: true,
            exposes: { "./Widget": "./src/Widget.ts" },
            shared: {},
          },
          rules: { ...quietRules, "doctor/partial-analysis": "off" },
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let afterBuild:
      | ((args: { stats: { toJson: (options: { assets: boolean }) => unknown } }) => Promise<void>)
      | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      getNormalizedConfig: () => rsbuildNormalizedConfig,
      onAfterBuild(fn: typeof afterBuild) {
        afterBuild = fn;
      },
    } as never);

    await afterBuild!({
      stats: {
        toJson: () => ({
          name: "web",
          outputPath: path.join(root, "dist"),
          mode: "production",
          assets: [{ name: "remoteEntry.js" }],
        }),
      },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { outputPublicPathKind?: string } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.bundler.outputPublicPathKind).toBe("non-string");
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "artifact/public-path-non-string-manifest",
      ),
    ).toBe(true);
  });

  it("records Rsbuild publicPath from public stats when config accessors are absent", async () => {
    const root = await makeRoot("rsbuild-public-path-stats");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          bundler: "rsbuild",
          mode: "ci",
          output: { formats: ["json"] },
          moduleFederation: {
            name: "public_path_string",
            filename: "remoteEntry.js",
            manifest: true,
            exposes: { "./Widget": "./src/Widget.ts" },
            shared: {},
          },
          rules: { ...quietRules, "doctor/partial-analysis": "off" },
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let afterBuild:
      | ((args: { stats: { toJson: (options: { assets: boolean }) => unknown } }) => Promise<void>)
      | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      onAfterBuild(fn: typeof afterBuild) {
        afterBuild = fn;
      },
    } as never);

    await afterBuild!({
      stats: {
        toJson: () => ({
          name: "web",
          outputPath: path.join(root, "dist"),
          publicPath: "https://cdn.example/",
          mode: "production",
          assets: [{ name: "remoteEntry.js" }],
        }),
      },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { outputPublicPathKind?: string } };
    expect(project.bundler.outputPublicPathKind).toBe("string");
  });

  it("emits doctor/partial-analysis when Rsbuild publicPath is unobserved", async () => {
    const root = await makeRoot("rsbuild-public-path-unobserved");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          bundler: "rsbuild",
          mode: "ci",
          output: { formats: ["json"] },
          moduleFederation: {
            name: "public_path_unobserved",
            filename: "remoteEntry.js",
            manifest: true,
            exposes: { "./Widget": "./src/Widget.ts" },
            shared: {},
          },
          rules: { ...quietRules, "doctor/partial-analysis": "warning" },
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let afterBuild:
      | ((args: { stats: { toJson: (options: { assets: boolean }) => unknown } }) => Promise<void>)
      | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      onAfterBuild(fn: typeof afterBuild) {
        afterBuild = fn;
      },
    } as never);

    await afterBuild!({
      stats: {
        toJson: () => ({
          name: "web",
          outputPath: path.join(root, "dist"),
          mode: "production",
          assets: [{ name: "remoteEntry.js" }],
        }),
      },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { outputPublicPathKind?: string } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string; evidence?: { missing?: string[] } }> };

    expect(project.bundler.outputPublicPathKind).toBeUndefined();
    const partial = report.findings.find((finding) => finding.ruleId === "doctor/partial-analysis");
    expect(partial?.evidence?.missing).toEqual(expect.arrayContaining(["outputPublicPath"]));
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "artifact/public-path-non-string-manifest",
      ),
    ).toBe(false);
  });
});
