import { describe, expect, it, vi } from "vitest";
import {
  appendModuleFederationDoctor,
  pluginModuleFederationDoctor,
  type BundlerChainLike,
} from "../../src/modern.js";
import { moduleFederationDoctorPlugin } from "../../src/rspack.js";
import { compilerBuildOutput, type CompilerLike } from "../../src/plugin.js";

describe("modern.js adapter", () => {
  it("registers afterEmit Doctor via modifyBundlerChain without client hooks", async () => {
    const plugin = pluginModuleFederationDoctor({
      moduleFederation: { name: "modern_fixture" },
    });
    expect(plugin.name).toBe("@module-federation/doctor");
    expect(typeof plugin.setup).toBe("function");

    const registered: Array<{ name: string; plugin: { name?: string; apply?: unknown } }> = [];
    await plugin.setup({
      getAppContext: () => ({
        packageName: "modern-fixture",
        command: "build",
        metaName: "fixture-meta",
        bundlerType: "rspack",
        isProd: true,
        appDirectory: "/tmp/mfdoctor-modern",
      }),
      modifyBundlerChain(handler) {
        const chain: BundlerChainLike = {
          plugin(name: string) {
            return {
              use(value: unknown) {
                registered.push({
                  name,
                  plugin: value as { name?: string; apply?: unknown },
                });
                return this;
              },
            };
          },
        };
        handler(chain, { env: "production", target: "web" });
      },
    });

    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).toBe("module-federation-doctor");
    expect(registered[0]?.plugin.name).toBe("ModuleFederationDoctor");
    expect(typeof registered[0]?.plugin.apply).toBe("function");

    const taps: Array<{ name: string }> = [];
    const compiler = {
      context: "/tmp/mfdoctor-modern",
      hooks: {
        afterEmit: {
          tapPromise(name: string) {
            taps.push({ name });
          },
        },
        compilation: {
          tap() {
            throw new Error("must not tap compilation");
          },
        },
        emit: {
          tapPromise() {
            throw new Error("must not tap emit");
          },
        },
      },
    } as CompilerLike & {
      hooks: CompilerLike["hooks"] & {
        compilation: { tap: () => void };
        emit: { tapPromise: () => void };
      };
    };
    (registered[0]!.plugin.apply as (c: typeof compiler) => void)(compiler);
    expect(taps).toEqual([{ name: "ModuleFederationDoctor" }]);
  });

  it("escape hatch appendModuleFederationDoctor uses the public rspack adapter", () => {
    const registered: Array<[string, unknown]> = [];
    appendModuleFederationDoctor(
      {
        plugin(name) {
          return {
            use(value) {
              registered.push([name, value]);
              return this;
            },
          };
        },
      },
      { moduleFederation: { name: "escape" } },
    );
    expect(registered).toHaveLength(1);
    expect(registered[0]?.[0]).toBe("module-federation-doctor");
    // Public Rspack entry factory — escape hatch must not invent a private plugin.
    expect(typeof moduleFederationDoctorPlugin).toBe("function");
    expect(registered[0]?.[1]).toMatchObject({ apply: expect.any(Function) });
  });

  it("records immutable public context and falls back to Modern utils", () => {
    const modernContext = Object.freeze({
      packageName: "modern-fixture",
      command: "build",
      metaName: "fixture-meta",
      bundlerType: "rspack",
      isProd: true,
      env: "production",
      target: "web",
    });
    const output = compilerBuildOutput(
      {
        context: "/tmp/mfdoctor-modern",
        options: { output: { path: "/tmp/mfdoctor-modern/dist" } },
        hooks: { afterEmit: { tapPromise() {} } },
      },
      { assets: { "remoteEntry.js": {} }, errors: [] },
      "modern",
      modernContext,
    );
    expect(Object.isFrozen(output.modernContext)).toBe(true);
    expect(output).toMatchObject({
      effectiveMode: "production",
      target: "web",
      targetKind: "web",
      modernContext,
      emittedAssets: ["remoteEntry.js"],
      outputRoot: "dist",
    });

    const publicOptions = compilerBuildOutput(
      {
        context: "/tmp/mfdoctor-modern",
        options: {
          mode: "development",
          target: "node",
          output: { path: "/tmp/mfdoctor-modern/dist" },
        },
        hooks: { afterEmit: { tapPromise() {} } },
      },
      { assets: {}, errors: [] },
      "modern",
      modernContext,
    );
    expect(publicOptions).toMatchObject({
      effectiveMode: "development",
      target: "node",
      targetKind: "node",
    });
  });

  it("warns when modifyBundlerChain is missing instead of silently no-oping", async () => {
    const plugin = pluginModuleFederationDoctor({
      moduleFederation: { name: "modern_fixture" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await plugin.setup({
        getAppContext: () => ({ bundlerType: "rspack", appDirectory: "/tmp/mfdoctor-modern" }),
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("modifyBundlerChain is missing");
    } finally {
      warn.mockRestore();
    }
  });
});
