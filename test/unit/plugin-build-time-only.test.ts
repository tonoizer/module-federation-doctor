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
  "buildStart",
  "moduleParsed",
] as const;

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
  it("vite adapter only registers writeBundle (no client injection hooks)", () => {
    const plugin = rawPlugin(viteDoctor.raw, "vite");
    expect(plugin.name).toBe("module-federation-doctor");
    expect(plugin.enforce).toBe("post");
    expect(typeof plugin.writeBundle).toBe("function");
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
        "docs: https://module-federation.github.io/rules/config/expose-key-invalid",
      );
      expect(out).toContain("source: https://module-federation.io/configure/exposes.html");
      // Single print path: rule id once as a finding line (docs URL also contains the id).
      expect(out.match(/^\s+error config\/expose-key-invalid/gm)?.length).toBe(1);
      expect(failed.threw).toBeTruthy();
    });
  }
});
