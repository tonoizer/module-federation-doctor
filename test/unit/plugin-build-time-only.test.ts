import { describe, expect, it } from "vitest";
import type { UnpluginContextMeta, UnpluginOptions } from "unplugin";
import { rsbuildDoctor, rspackDoctor, viteDoctor, webpackDoctor } from "../../src/plugin.js";

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
