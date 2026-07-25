import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { webpackDoctor } from "../../src/plugin.js";

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
    };
    expect(project.bundler.name).toBe("webpack");
    expect(project.capabilities.emittedAssets).toBe(true);
    expect(project.artifacts.emittedAssets).toEqual(
      expect.arrayContaining(["remoteEntry.js", "mf-manifest.json"]),
    );
    expect(compilation.errors).toEqual([]);
  });
});
