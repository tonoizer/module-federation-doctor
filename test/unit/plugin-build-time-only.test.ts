import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnpluginContextMeta, UnpluginOptions } from "unplugin";
import { rsbuildDoctor, rspackDoctor, viteDoctor, webpackDoctor } from "../../src/plugin.js";
import type { DoctorOptions, BundlerName } from "../../src/types.js";

/** Hooks that would inject or rewrite client modules / assets. */
const CLIENT_INJECTION_HOOKS = [
  "transform",
  "load",
  "resolveId",
  "banner",
  "footer",
  "intro",
  "outro",
  "renderChunk",
  "augmentChunkHash",
  "transformInclude",
  "loadInclude",
  "moduleParsed",
] as const;

/** Public fact-gathering hooks allowed before post-emit analysis. */
const VITE_FACT_GATHERING_HOOKS = ["config", "configResolved", "buildStart"] as const;

function asSinglePlugin(value: UnpluginOptions | UnpluginOptions[]): UnpluginOptions {
  expect(Array.isArray(value)).toBe(false);
  return value as UnpluginOptions;
}

function rawPlugin(
  factory: typeof viteDoctor.raw,
  framework: UnpluginContextMeta["framework"],
): UnpluginOptions {
  return asSinglePlugin(
    factory({}, { framework, versions: { unplugin: "0.0.0" } } as UnpluginContextMeta),
  );
}

async function fixtureRoot(bundler: BundlerName, kind: "clean" | "error"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-adapter-${bundler}-${kind}-`));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
  const federationPackage =
    bundler === "rspack" || bundler === "webpack"
      ? "enhanced"
      : bundler === "rsbuild"
        ? "rsbuild-plugin"
        : "vite";
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: `adapter-${bundler}-${kind}`,
      dependencies: { [`@module-federation/${federationPackage}`]: "1.0.0" },
    }),
  );
  return root;
}

function doctorOptions(root: string, kind: "clean" | "error"): DoctorOptions {
  return {
    root,
    mode: "ci",
    output: { formats: ["terminal"] },
    moduleFederation: {
      name: `adapter_${kind}`,
      ...(kind === "clean"
        ? { exposes: { "./Widget": "./src/Widget.ts" }, shared: {} }
        : { exposes: { Widget: "./src/missing.ts" }, shared: {} }),
      manifest: true,
    },
    rules: {
      "artifact/remote-entry-missing": "off",
      "artifact/types-missing": "off",
      "doctor/partial-analysis": "off",
      "config/plugin-package-mismatch": "off",
      "config/expose-path-missing": "off",
    },
  };
}

describe("build-time-only adapter contract", () => {
  it("vite adapter gathers facts then analyzes only on post-emit hooks", () => {
    const plugin = rawPlugin(viteDoctor.raw, "vite") as UnpluginOptions & {
      configResolved?: unknown;
      buildStart?: unknown;
      closeBundle?: unknown;
    };
    expect(plugin.name).toBe("module-federation-doctor");
    expect(plugin.enforce).toBe("post");
    for (const hook of VITE_FACT_GATHERING_HOOKS) {
      const value = plugin[hook as keyof typeof plugin];
      if (typeof value === "object" && value !== null) {
        expect(typeof (value as { handler?: unknown }).handler).toBe("function");
        if (hook === "config") expect((value as { order?: string }).order).toBe("pre");
      } else {
        expect(typeof value).toBe("function");
      }
    }
    expect(typeof plugin.writeBundle).toBe("function");
    expect(typeof plugin.closeBundle).toBe("function");
    for (const hook of CLIENT_INJECTION_HOOKS) {
      expect(plugin).not.toHaveProperty(hook);
    }
  });

  it("rspack adapter only taps afterEmit (no client injection hooks)", () => {
    const plugin = rawPlugin(rspackDoctor.raw, "rspack");
    expect(plugin.name).toBe("module-federation-doctor");
    expect(plugin.enforce).toBe("post");
    expect(typeof plugin.rspack).toBe("function");
    for (const hook of CLIENT_INJECTION_HOOKS) {
      expect(plugin).not.toHaveProperty(hook);
    }

    const taps: Array<{ name: string }> = [];
    const compiler = {
      context: "/tmp/mfdoctor-rspack",
      hooks: {
        afterEmit: {
          tapPromise(name: string, _fn: unknown) {
            taps.push({ name });
          },
        },
        // Forbidden emit-time injection surfaces must stay unused.
        compilation: {
          tap() {
            throw new Error("must not tap compilation");
          },
        },
        thisCompilation: {
          tap() {
            throw new Error("must not tap thisCompilation");
          },
        },
        emit: {
          tapPromise() {
            throw new Error("must not tap emit");
          },
        },
        make: {
          tapPromise() {
            throw new Error("must not tap make");
          },
        },
      },
    };
    plugin.rspack?.(compiler as never);
    expect(taps).toEqual([{ name: "ModuleFederationDoctor" }]);
  });

  it("webpack adapter only taps afterEmit (no client injection hooks)", () => {
    const plugin = rawPlugin(webpackDoctor.raw, "webpack");
    expect(plugin.name).toBe("module-federation-doctor");
    expect(plugin.enforce).toBe("post");
    expect(typeof plugin.webpack).toBe("function");
    for (const hook of CLIENT_INJECTION_HOOKS) {
      expect(plugin).not.toHaveProperty(hook);
    }

    const taps: Array<{ name: string }> = [];
    const compiler = {
      context: "/tmp/mfdoctor-webpack",
      hooks: {
        afterEmit: {
          tapPromise(name: string, _fn: unknown) {
            taps.push({ name });
          },
        },
        compilation: {
          tap() {
            throw new Error("must not tap compilation");
          },
        },
        thisCompilation: {
          tap() {
            throw new Error("must not tap thisCompilation");
          },
        },
        emit: {
          tapPromise() {
            throw new Error("must not tap emit");
          },
        },
        make: {
          tapPromise() {
            throw new Error("must not tap make");
          },
        },
      },
    };
    plugin.webpack?.(compiler as never);
    expect(taps).toEqual([{ name: "ModuleFederationDoctor" }]);
  });

  it("rsbuild adapter only uses onAfterBuild (no client injection hooks)", () => {
    const plugin = rawPlugin(rsbuildDoctor.raw, "rsbuild");
    expect(plugin.name).toBe("module-federation-doctor");
    expect(plugin.enforce).toBe("post");
    expect(plugin.rsbuild).toBeTruthy();
    for (const hook of CLIENT_INJECTION_HOOKS) {
      expect(plugin).not.toHaveProperty(hook);
    }

    const registered: string[] = [];
    const api = {
      context: { rootPath: "/tmp/mfdoctor-rsbuild" },
      onAfterBuild(fn: unknown) {
        registered.push("onAfterBuild");
        expect(typeof fn).toBe("function");
      },
      modifyBundlerChain() {
        throw new Error("must not modifyBundlerChain");
      },
      transform() {
        throw new Error("must not register transform");
      },
      processAssets() {
        throw new Error("must not processAssets");
      },
    };
    plugin.rsbuild?.setup?.(api as never);
    expect(registered).toEqual(["onAfterBuild"]);
  });

  it("keeps Rsbuild parent and child stats as separate build records", async () => {
    const root = await fixtureRoot("rsbuild", "clean");
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          ...doctorOptions(root, "clean"),
          output: { formats: ["json"] },
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
          name: "parent",
          outputPath: path.join(root, "dist"),
          mode: "production",
          assets: [{ name: "shared.js" }],
          children: [
            {
              name: "server",
              outputPath: path.join(root, "dist/server"),
              hash: "server-hash",
              target: "node",
              assets: [{ name: "shared.js" }],
            },
          ],
        }),
      },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{
        compilationName?: string;
        outputRoot?: string;
        emittedAssets: string[];
        hash?: string;
        target?: string;
        targetKind?: string;
      }>;
      artifacts: { emittedAssets: string[] };
      capabilities: { emittedAssets: boolean };
    };
    expect(project.builds).toHaveLength(2);
    expect(project.builds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          compilationName: "parent",
          outputRoot: "dist",
          emittedAssets: ["dist/shared.js"],
        }),
        expect.objectContaining({
          compilationName: "server",
          outputRoot: "dist/server",
          emittedAssets: ["dist/server/shared.js"],
          hash: "server-hash",
          target: "node",
          targetKind: "node",
        }),
      ]),
    );
    expect(project.artifacts.emittedAssets).toEqual(["dist/server/shared.js", "dist/shared.js"]);
    expect(project.capabilities.emittedAssets).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("traverses a real MultiStats wrapper and matches child artifacts", async () => {
    const root = await fixtureRoot("rsbuild", "clean");
    await fs.mkdir(path.join(root, "dist", "server"), { recursive: true });
    await fs.writeFile(
      path.join(root, "dist", "mf-manifest.json"),
      JSON.stringify({
        name: "adapter_clean",
        metaData: {},
        exposes: [{ name: "./Widget" }],
        shared: [],
      }),
    );
    await fs.writeFile(path.join(root, "dist", "mf-stats.json"), JSON.stringify({ assets: [] }));
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          ...doctorOptions(root, "clean"),
          output: { formats: ["json"] },
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
          outputPath: path.join(root, "..", "outside"),
          hash: "aggregate-hash",
          children: [
            {
              name: "client",
              outputPath: path.join(root, "dist"),
              assets: [
                { name: "dist/mf-manifest.json" },
                { name: "dist/mf-stats.json" },
                { name: "dist/shared.js" },
              ],
            },
            {
              name: "server",
              outputPath: path.join(root, "dist/server"),
              assets: [{ name: "dist/server/shared.js" }],
            },
          ],
        }),
      },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{
        compilationName?: string;
        outputRoot?: string;
        emittedAssets: string[];
        artifacts: Array<{ path: string }>;
      }>;
    };
    expect(project.builds).toHaveLength(2);
    expect(project.builds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          compilationName: "client",
          outputRoot: "dist",
          emittedAssets: ["dist/mf-manifest.json", "dist/mf-stats.json", "dist/shared.js"],
          artifacts: expect.arrayContaining([
            expect.objectContaining({ path: "dist/mf-manifest.json" }),
            expect.objectContaining({ path: "dist/mf-stats.json" }),
          ]),
        }),
        expect.objectContaining({
          compilationName: "server",
          outputRoot: "dist/server",
          emittedAssets: ["dist/server/shared.js"],
          artifacts: [],
        }),
      ]),
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it("uses the project root when child stats omit outputPath", async () => {
    const root = await fixtureRoot("rsbuild", "clean");
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(root, "dist", "mf-manifest.json"),
      JSON.stringify({
        name: "adapter_clean",
        metaData: {},
        exposes: [{ name: "./Widget" }],
        shared: [],
      }),
    );
    await fs.writeFile(path.join(root, "dist", "mf-stats.json"), JSON.stringify({ assets: [] }));
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          ...doctorOptions(root, "clean"),
          output: { formats: ["json"] },
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
          children: [
            {
              name: "client",
              assets: [{ name: "dist/mf-manifest.json" }, { name: "dist/mf-stats.json" }],
            },
          ],
        }),
      },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{
        outputRoot?: string;
        emittedAssets: string[];
        artifacts: Array<{ path: string }>;
      }>;
    };
    expect(project.builds).toEqual([
      expect.objectContaining({
        outputRoot: ".",
        emittedAssets: ["dist/mf-manifest.json", "dist/mf-stats.json"],
        artifacts: expect.arrayContaining([
          expect.objectContaining({ path: "dist/mf-manifest.json" }),
          expect.objectContaining({ path: "dist/mf-stats.json" }),
        ]),
      }),
    ]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("does not fall back to the project root for an unsafe outputPath", async () => {
    const root = await fixtureRoot("rsbuild", "clean");
    await fs.writeFile(
      path.join(root, "mf-manifest.json"),
      JSON.stringify({
        name: "stale-root-artifact",
        metaData: {},
        exposes: [],
        shared: [],
      }),
    );
    await fs.writeFile(path.join(root, "mf-stats.json"), JSON.stringify({ assets: [] }));
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          ...doctorOptions(root, "clean"),
          output: { formats: ["json"] },
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
          name: "client",
          outputPath: path.join(root, "..", "outside"),
          assets: [{ name: "mf-manifest.json" }, { name: "mf-stats.json" }],
        }),
      },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{
        outputRoot?: string;
        emittedAssets: string[];
        artifacts: Array<{ path: string }>;
      }>;
    };
    expect(project.builds).toEqual([
      expect.objectContaining({
        emittedAssets: ["mf-manifest.json", "mf-stats.json"],
        artifacts: [],
      }),
    ]);
    expect(project.builds[0]).not.toHaveProperty("outputRoot");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("treats an in-project symlink to an external outputPath as unsafe", async () => {
    const root = await fixtureRoot("rsbuild", "clean");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-rsbuild-outside-"));
    await fs.symlink(outside, path.join(root, "linked-output"), "dir");
    await fs.writeFile(path.join(root, "mf-manifest.json"), JSON.stringify({ metaData: {} }));
    const plugin = asSinglePlugin(
      rsbuildDoctor.raw(
        {
          ...doctorOptions(root, "clean"),
          output: { formats: ["json"] },
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
          name: "client",
          outputPath: path.join(root, "linked-output"),
          assets: [{ name: "mf-manifest.json" }],
        }),
      },
    });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as {
      builds: Array<{ outputRoot?: string; artifacts: Array<{ path: string }> }>;
    };
    expect(project.builds).toEqual([expect.objectContaining({ artifacts: [] })]);
    expect(project.builds[0]).not.toHaveProperty("outputRoot");
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
});

describe("adapter quiet success and failure terminal path", () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  for (const bundler of [
    { id: "vite" as const, factory: viteDoctor, framework: "vite" as const },
    { id: "rspack" as const, factory: rspackDoctor, framework: "rspack" as const },
    { id: "webpack" as const, factory: webpackDoctor, framework: "webpack" as const },
    { id: "rsbuild" as const, factory: rsbuildDoctor, framework: "rsbuild" as const },
  ]) {
    it(`${bundler.id}: quiet success prints nothing; failure prints one findings block`, async () => {
      const cleanRoot = await fixtureRoot(bundler.id, "clean");
      const errorRoot = await fixtureRoot(bundler.id, "error");
      roots.push(cleanRoot, errorRoot);

      const run = async (root: string, kind: "clean" | "error") => {
        const writes: string[] = [];
        const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
          writes.push(String(chunk));
          return true;
        });
        const options = doctorOptions(root, kind);
        options.bundler = bundler.id;
        const plugin = asSinglePlugin(
          bundler.factory.raw(options, {
            framework: bundler.framework,
            versions: { unplugin: "0.0.0" },
          } as UnpluginContextMeta),
        );

        try {
          if (bundler.id === "vite") {
            let threw: boolean | string = false;
            try {
              await (plugin.writeBundle as (this: unknown) => Promise<void>).call({});
              await (
                (
                  plugin as UnpluginOptions & {
                    closeBundle?: (this: unknown) => Promise<void>;
                  }
                ).closeBundle as (this: unknown) => Promise<void>
              ).call({});
            } catch (error) {
              threw = error instanceof Error ? error.message : String(error);
            }
            return { writes, threw };
          }
          if (bundler.id === "rsbuild") {
            let afterBuild: ((args: { stats: null }) => Promise<void>) | undefined;
            plugin.rsbuild?.setup?.({
              context: { rootPath: root },
              onAfterBuild(fn: (args: { stats: null }) => Promise<void>) {
                afterBuild = fn;
              },
            } as never);
            let threw: boolean | string = false;
            try {
              await afterBuild!({ stats: null });
            } catch (error) {
              threw = error instanceof Error ? error.message : String(error);
            }
            return { writes, threw };
          }
          // rspack / webpack
          let tap:
            | ((compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>)
            | undefined;
          const compiler = {
            context: root,
            hooks: {
              afterEmit: {
                tapPromise(
                  _name: string,
                  fn: (compilation: {
                    assets: Record<string, unknown>;
                    errors: Error[];
                  }) => Promise<void>,
                ) {
                  tap = fn;
                },
              },
            },
          };
          if (bundler.id === "rspack") plugin.rspack?.(compiler as never);
          else plugin.webpack?.(compiler as never);
          const compilation = { assets: { "remoteEntry.js": {} }, errors: [] as Error[] };
          let threw: boolean | string = false;
          try {
            await tap!(compilation);
          } catch (error) {
            threw = error instanceof Error ? error.message : String(error);
          }
          return { writes, threw, compilation };
        } finally {
          stdout.mockRestore();
        }
      };

      const clean = await run(cleanRoot, "clean");
      expect(clean.writes.join("")).not.toContain("Module Federation Doctor");
      expect(clean.threw).toBe(false);

      const failed = await run(errorRoot, "error");
      const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
      const out = failed.writes.join("").replace(ansi, "");
      expect(out).toContain("Module Federation Doctor");
      expect(out).toContain("config/expose-key-invalid");
      expect(out).toContain("error");
      expect(out).toContain(
        "docs: https://mfdoctor.kevinbeier.com/rules/config/expose-key-invalid",
      );
      expect(out).toContain("source: https://module-federation.io/configure/exposes.html");
      // Single print path: rule id once as a finding line (docs URL also contains the id).
      expect(out.match(/^\s+error config\/expose-key-invalid/gm)?.length).toBe(1);
      expect(failed.threw).toBeTruthy();
    });
  }
});
