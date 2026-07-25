import { describe, expect, it } from "vitest";
import {
  appendModuleFederationDoctor,
  pluginModuleFederationDoctor,
  type BundlerChainLike,
} from "../../src/modern.js";
import { moduleFederationDoctorPlugin } from "../../src/rspack.js";
import type { CompilerLike } from "../../src/plugin.js";

describe("modern.js adapter", () => {
  it("registers afterEmit Doctor via modifyBundlerChain without client hooks", async () => {
    const plugin = pluginModuleFederationDoctor({
      moduleFederation: { name: "modern_fixture" },
    });
    expect(plugin.name).toBe("@module-federation/doctor");
    expect(typeof plugin.setup).toBe("function");

    const registered: Array<{ name: string; plugin: { name?: string; apply?: unknown } }> = [];
    await plugin.setup({
      getAppContext: () => ({ bundlerType: "rspack", appDirectory: "/tmp/mfdoctor-modern" }),
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
        handler(chain);
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
});
