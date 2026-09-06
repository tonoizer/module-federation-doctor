import { describe, expect, it } from "vitest";
import {
  classifyOutputPublicPath,
  collectViteModuleFederationPluginInstances,
  countModuleFederationPlugins,
  countViteFamilyFederationPlugins,
} from "../../src/plugin.js";

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
    (plugin as unknown as { name: string }).name = "ModuleFederationPlugin";
    expect(countModuleFederationPlugins({ options: { plugins: [plugin] } })).toBe(1);
  });

  it("counts public Vite/Rsbuild federation registrations without internal helpers", () => {
    const plugins = [
      { name: "module-federation-vite", _options: { name: "host", filename: "remoteEntry.js" } },
      { name: "vite:module-federation-config" },
      { name: "vite:module-federation-virtual-modules" },
      { name: "module-federation-doctor" },
      { name: "rsbuild:module-federation-enhanced" },
      { name: "rsbuild:module-federation-enhanced" },
    ];
    expect(countViteFamilyFederationPlugins(plugins)).toBe(3);
    expect(
      collectViteModuleFederationPluginInstances(plugins).map((item) => item.config.name),
    ).toEqual(["host"]);
  });

  it("counts nested Rsbuild plugin arrays and unnamed primary registrations", () => {
    expect(
      countViteFamilyFederationPlugins([
        [{ name: "rsbuild:module-federation-enhanced" }],
        { name: "rsbuild:module-federation-enhanced" },
        { name: "plugin-react" },
      ]),
    ).toBe(2);
  });

  it("classifies output.publicPath the way manifest generation does", () => {
    expect(classifyOutputPublicPath("https://cdn.example/")).toBe("string");
    expect(classifyOutputPublicPath("auto")).toBe("auto");
    expect(classifyOutputPublicPath(() => "/")).toBe("non-string");
    expect(classifyOutputPublicPath(undefined)).toBe("unknown");
  });
});
