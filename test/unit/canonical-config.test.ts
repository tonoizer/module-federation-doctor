import { describe, expect, it } from "vitest";
import { readCanonicalModuleFederationConfig } from "../../src/canonical-config.js";

describe("canonical config boundary", () => {
  it("keeps collection order, duplicates, fallbacks, tuples, false, and extensions", () => {
    const config = readCanonicalModuleFederationConfig(
      {
        exposes: [
          ["./button", [{ import: ["./button", "./fallback"] }]],
          ["./button", "./again"],
        ],
        remotes: { cart: [{ external: ["cart@one", "cart@two"], type: "script" }] },
        shared: [
          ["react", { singleton: false, import: false, treeShaking: { usedExports: ["jsx"] } }],
        ],
        runtimePlugins: [["./plugin", { token: "not-persisted" }]],
        experiments: { asyncStartup: true },
        customExtension: { enabled: true },
      },
      { adapter: { name: "webpack", version: "5.0.0", packId: "webpack-5" }, target: "browser" },
    );

    expect(config?.contract.adapter.packId).toBe("webpack-5");
    expect(config?.declared.collections.exposes.map((entry) => entry.key)).toEqual([
      "./button",
      "./button",
    ]);
    expect(config?.declared.collections.remotes[0]?.value.value).toEqual([
      { external: ["cart@one", "cart@two"], type: "script" },
    ]);
    expect(config?.declared.collections.shared[0]?.value.value).toEqual({
      import: false,
      singleton: false,
      treeShaking: { usedExports: ["jsx"] },
    });
    expect(config?.extensions[0]?.path).toBe("/customExtension");
    expect(config?.effectiveByBuild).toEqual({});
  });

  it("does not apply defaults and marks executable values opaque", () => {
    const config = readCanonicalModuleFederationConfig({
      shared: { react: {} },
      runtimePlugins: [() => undefined],
    });
    expect(config?.declared.collections.shared[0]?.value.value).toEqual({});
    expect(
      config?.declared.fields.find((entry) => entry.key === "runtimePlugins")?.value.value,
    ).toEqual([{ kind: "opaque", valueType: "function" }]);
    expect(config?.diagnostics.some((diagnostic) => diagnostic.code === "opaque-value")).toBe(true);
  });

  it("returns partial diagnostics for a non-object root", () => {
    const config = readCanonicalModuleFederationConfig(null);
    expect(config?.declared.fields).toEqual([]);
    expect(config?.diagnostics[0]).toMatchObject({ code: "invalid-root", path: "/" });
  });

  it("does not invoke getters while reading object-shaped input", () => {
    let called = false;
    const config = readCanonicalModuleFederationConfig({
      get customExtension() {
        called = true;
        return { enabled: true };
      },
    });
    expect(called).toBe(false);
    expect(config?.declared.fields[0]?.value.value).toEqual({
      kind: "opaque",
      valueType: "undefined",
    });
  });
});
