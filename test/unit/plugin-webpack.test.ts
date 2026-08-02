import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rspackDoctor, webpackDoctor } from "../../src/plugin.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("webpack adapter", () => {
  it("hooks afterEmit and records compilation assets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-webpack-hook-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
    await fs.mkdir(path.join(root, "dist"));
    await fs.writeFile(path.join(root, "dist", "remoteEntry.js"), "window.remote = {};\n");
    await fs.writeFile(
      path.join(root, "dist", "mf-manifest.json"),
      JSON.stringify({
        id: "webpack_hook",
        name: "webpack_hook",
        metaData: { remoteEntry: { name: "remoteEntry.js", path: "" } },
        exposes: [],
        shared: [],
        remotes: [],
      }),
    );
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "webpack-hook",
        dependencies: { "@module-federation/enhanced": "1.0.0" },
      }),
    );

    const taps: Array<
      (compilation: {
        assets: Record<string, unknown>;
        warnings: Error[];
        errors: Error[];
      }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      name: "web",
      options: {
        name: "web",
        mode: "production",
        target: "web",
        output: { path: path.join(root, "dist") },
      },
      hooks: {
        afterEmit: {
          tapPromise(
            _name: string,
            fn: (compilation: {
              assets: Record<string, unknown>;
              warnings: Error[];
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
          name: "webpack_hook",
          filename: "remoteEntry.js",
          exposes: { "./Widget": "./src/Widget.ts" },
          shared: {},
        },
        mode: "ci",
        output: { formats: [] },
        rules: {
          "artifact/remote-entry-missing": "off",
          "artifact/types-missing": "off",
          "artifact/expose-missing": "off",
          "doctor/partial-analysis": "off",
        },
      },
      {
        framework: "webpack",
        versions: { unplugin: "3.3.0" },
        webpack: { compiler },
      } as never,
    );
    const plugin = Array.isArray(raw) ? raw[0]! : raw;

    expect(typeof plugin.webpack).toBe("function");
    plugin.webpack!(compiler as never);
    expect(taps).toHaveLength(1);

    const compilation = {
      assets: { "remoteEntry.js": {}, "mf-manifest.json": {} },
      name: "web",
      fullHash: "abc123",
      warnings: [] as Error[],
      errors: [] as Error[],
    };
    await taps[0]!(compilation);

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      bundler: { name: string };
      capabilities: { emittedAssets: boolean };
      artifacts: { emittedAssets: string[] };
      builds: Array<{
        compilerName?: string;
        compilationName?: string;
        hash?: string;
        outputRoot?: string;
        emittedAssets: string[];
        artifacts: Array<{ path: string; buildId?: string; source: string }>;
        effectiveMode?: string;
        target?: string;
        targetKind?: string;
      }>;
    };
    expect(project.bundler.name).toBe("webpack");
    expect(project.capabilities.emittedAssets).toBe(true);
    expect(project.artifacts.emittedAssets).toEqual(
      expect.arrayContaining(["dist/remoteEntry.js", "dist/mf-manifest.json"]),
    );
    expect(project.builds).toHaveLength(1);
    expect(project.builds[0]).toMatchObject({
      compilerName: "web",
      compilationName: "web",
      hash: "abc123",
      outputRoot: "dist",
      emittedAssets: ["dist/mf-manifest.json", "dist/remoteEntry.js"],
      effectiveMode: "production",
      target: "web",
      targetKind: "web",
    });
    expect(project.builds[0]?.artifacts).toEqual([
      expect.objectContaining({
        path: "dist/mf-manifest.json",
        buildId: "webpack-build-1",
        source: "emitted",
      }),
    ]);
    expect(compilation.errors).toEqual([]);
  });

  it("keeps rspack compiler identity and output scope in the same build contract", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-rspack-hook-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "dist"));
    await fs.writeFile(path.join(root, "dist", "remoteEntry.js"), "window.remote = {};\n");
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "rspack-hook",
        dependencies: { "@module-federation/enhanced": "1.0.0" },
      }),
    );

    type Compilation = {
      assets: Record<string, unknown>;
      errors: Error[];
      name?: string;
      hash?: string;
    };
    const taps: Array<(compilation: Compilation) => Promise<void>> = [];
    const compiler = {
      context: root,
      name: "server",
      options: {
        name: "server",
        mode: "development",
        target: "node",
        output: { path: path.join(root, "dist") },
      },
      hooks: {
        afterEmit: {
          tapPromise(_name: string, fn: (compilation: Compilation) => Promise<void>) {
            taps.push(fn);
          },
        },
      },
    };
    const raw = rspackDoctor.raw(
      {
        root,
        moduleFederation: { name: "rspack_hook", exposes: {}, shared: {} },
        mode: "ci",
        output: { formats: [] },
        rules: { "doctor/partial-analysis": "off" },
      },
      { framework: "rspack", versions: { unplugin: "3.3.0" }, rspack: { compiler } } as never,
    );
    const plugin = Array.isArray(raw) ? raw[0]! : raw;
    plugin.rspack!(compiler as never);
    await taps[0]!({
      assets: { "remoteEntry.js": {} },
      name: "server",
      hash: "rspack-hash",
      errors: [],
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { builds: Array<Record<string, unknown>> };
    expect(project.builds[0]).toMatchObject({
      adapter: "rspack",
      bundler: "rspack",
      compilerName: "server",
      compilationName: "server",
      hash: "rspack-hash",
      outputRoot: "dist",
      effectiveMode: "development",
      target: "node",
      targetKind: "node",
    });
  });
});
