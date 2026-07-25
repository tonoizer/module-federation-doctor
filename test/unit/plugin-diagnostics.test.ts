import { describe, expect, it } from "vitest";
import { classifyOutputPublicPath, countModuleFederationPlugins } from "../../src/plugin.js";

describe("compiler build diagnostics helpers", () => {
  it("counts Module Federation plugin instances by public name", () => {
    expect(
      countModuleFederationPlugins({
        options: {
          plugins: [
            { name: "ModuleFederationPlugin" },
            { name: "SomethingElse" },
            { name: "ModuleFederationPlugin" },
          ],
        },
      }),
    ).toBe(2);
  });

  it("counts RspackModuleFederationPlugin instances by public name", () => {
    expect(
      countModuleFederationPlugins({
        options: {
          plugins: [
            { name: "RspackModuleFederationPlugin" },
            { name: "ModuleFederationDoctor" },
            { name: "RspackModuleFederationPlugin" },
          ],
        },
      }),
    ).toBe(2);
  });

  it("falls back to constructor.name when instance .name is missing (native webpack)", () => {
    class ModuleFederationPlugin {
      readonly kind = "mf";
    }
    class UnrelatedPlugin {
      readonly kind = "other";
    }
    expect(
      countModuleFederationPlugins({
        options: {
          plugins: [
            new ModuleFederationPlugin(),
            new UnrelatedPlugin(),
            new ModuleFederationPlugin(),
          ],
        },
      }),
    ).toBe(2);
  });

  it("prefers instance .name over constructor.name", () => {
    class SomethingElse {
      readonly kind = "other";
    }
    const plugin = new SomethingElse();
    (plugin as { name: string }).name = "ModuleFederationPlugin";
    expect(countModuleFederationPlugins({ options: { plugins: [plugin] } })).toBe(1);
  });

  it("classifies output.publicPath the way manifest generation does", () => {
    expect(classifyOutputPublicPath("https://cdn.example/")).toBe("string");
    expect(classifyOutputPublicPath("auto")).toBe("auto");
    expect(classifyOutputPublicPath(() => "/")).toBe("non-string");
    expect(classifyOutputPublicPath(undefined)).toBe("unknown");
  });
});
