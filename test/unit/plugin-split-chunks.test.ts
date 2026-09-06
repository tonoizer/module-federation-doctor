import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UnpluginContextMeta, UnpluginOptions } from "unplugin";
import { rsbuildDoctor, rspackDoctor, webpackDoctor } from "../../src/plugin.js";
import type { RuleSetting } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const quietRules = {
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "artifact/expose-missing": "off",
  "config/plugin-package-mismatch": "off",
  "doctor/partial-analysis": "off",
} satisfies Record<string, RuleSetting>;

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
        "@module-federation/enhanced": "1.0.0",
        "@module-federation/rsbuild-plugin": "1.0.0",
      },
    }),
  );
  return root;
}

function asSinglePlugin(value: UnpluginOptions | UnpluginOptions[]): UnpluginOptions {
  expect(Array.isArray(value)).toBe(false);
  return value as UnpluginOptions;
}

describe("splitChunks adapter facts", () => {
  it("records webpack cacheGroups and reports the MF runtime advisory", async () => {
    const root = await makeRoot("webpack-split-chunks");
    const taps: Array<
      (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      options: {
        mode: "production",
        output: { path: path.join(root, "dist") },
        optimization: {
          splitChunks: {
            chunks: "all",
            cacheGroups: {
              "mf-runtime": { name: "mf-runtime", test: /mf-/ },
            },
          },
        },
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
    const raw = webpackDoctor.raw(
      {
        root,
        moduleFederation: {
          name: "webpack_split",
          filename: "remoteEntry.js",
          exposes: { "./Widget": "./src/Widget.ts" },
          shared: {},
        },
        mode: "ci",
        output: { formats: ["json"] },
        rules: quietRules,
      },
      { framework: "webpack", versions: { unplugin: "3.3.0" }, webpack: { compiler } } as never,
    );
    asSinglePlugin(raw).webpack!(compiler as never);
    await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { splitChunks?: { chunks?: string; cacheGroups?: Array<{ name: string }> } } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };

    expect(project.bundler.splitChunks).toEqual({
      chunks: "all",
      cacheGroups: [{ name: "mf-runtime", chunkName: "mf-runtime", test: "mf-" }],
    });
    expect(
      report.findings.some((finding) => finding.ruleId === "config/split-chunks-mf-runtime"),
    ).toBe(true);
  });

  it("skips the advisory when webpack optimization is unobserved", async () => {
    const root = await makeRoot("webpack-split-chunks-skip");
    const taps: Array<
      (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      options: { mode: "production", output: { path: path.join(root, "dist") } },
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
    const raw = webpackDoctor.raw(
      {
        root,
        moduleFederation: { name: "webpack_split", exposes: {}, shared: {} },
        mode: "ci",
        output: { formats: ["json"] },
        rules: quietRules,
      },
      { framework: "webpack", versions: { unplugin: "3.3.0" }, webpack: { compiler } } as never,
    );
    asSinglePlugin(raw).webpack!(compiler as never);
    await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { splitChunks?: unknown } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };
    expect(project.bundler.splitChunks).toBeUndefined();
    expect(
      report.findings.some((finding) => finding.ruleId === "config/split-chunks-mf-runtime"),
    ).toBe(false);
  });

  it("records rspack cacheGroups the same way", async () => {
    const root = await makeRoot("rspack-split-chunks");
    const taps: Array<
      (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      options: {
        mode: "production",
        output: { path: path.join(root, "dist") },
        optimization: {
          splitChunks: { cacheGroups: { remoteEntry: { name: "remoteEntry" } } },
        },
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
    const raw = rspackDoctor.raw(
      {
        root,
        moduleFederation: {
          name: "rspack_split",
          filename: "remoteEntry.js",
          exposes: {},
          shared: {},
        },
        mode: "ci",
        output: { formats: ["json"] },
        rules: quietRules,
      },
      { framework: "rspack", versions: { unplugin: "3.3.0" }, rspack: { compiler } } as never,
    );
    asSinglePlugin(raw).rspack!(compiler as never);
    await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });

    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };
    expect(
      report.findings.some((finding) => finding.ruleId === "config/split-chunks-mf-runtime"),
    ).toBe(true);
  });

  it("records Rsbuild performance.chunkSplit.override cacheGroups", async () => {
    const root = await makeRoot("rsbuild-split-chunks");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          root,
          bundler: "rsbuild",
          mode: "ci",
          output: { formats: ["json"] },
          moduleFederation: {
            name: "rsbuild_split",
            filename: "remoteEntry.js",
            exposes: { "./Widget": "./src/Widget.ts" },
            shared: {},
          },
          rules: quietRules,
        },
        { framework: "rsbuild", versions: { unplugin: "0.0.0" } } as UnpluginContextMeta,
      ),
    );
    let afterBuild:
      | ((args: { stats: { toJson: (options: { assets: boolean }) => unknown } }) => Promise<void>)
      | undefined;
    plugin.rsbuild?.setup?.({
      context: { rootPath: root },
      getNormalizedConfig: () => ({
        performance: {
          chunkSplit: {
            override: { cacheGroups: { "mf-runtime": { name: "mf-runtime" } } },
          },
        },
      }),
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
    ) as { bundler: { splitChunks?: { cacheGroups?: Array<{ name: string }> } } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };
    expect(project.bundler.splitChunks?.cacheGroups).toEqual([
      { name: "mf-runtime", chunkName: "mf-runtime" },
    ]);
    expect(
      report.findings.some((finding) => finding.ruleId === "config/split-chunks-mf-runtime"),
    ).toBe(true);
  });
});
