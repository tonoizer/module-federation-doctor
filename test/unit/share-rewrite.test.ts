import { describe, expect, it } from "vitest";
import {
  findShareRewriteOverlaps,
  observeResolveAlias,
  observeSourceTransformImportFromConfigs,
  observeTransformImportLibraries,
  rewriteOverlapsShareKey,
} from "../../src/share-rewrite.js";

describe("share-rewrite helper", () => {
  it("matches exact and trailing-slash prefix shares", () => {
    expect(rewriteOverlapsShareKey("react", "react")).toBe(true);
    expect(rewriteOverlapsShareKey("react/jsx-runtime", "react/")).toBe(true);
    expect(rewriteOverlapsShareKey("react", "react/")).toBe(true);
    expect(rewriteOverlapsShareKey("lodash", "react")).toBe(false);
  });

  it("returns overlapping rewrite targets and honors allowlists", () => {
    expect(findShareRewriteOverlaps(["react", "lodash"], ["react", "vue"], ["react"])).toEqual([]);
    expect(findShareRewriteOverlaps(["lodash"], ["lodash", "react/"])).toEqual(["lodash"]);
    expect(findShareRewriteOverlaps(["react/jsx-runtime"], ["react/"])).toEqual([
      "react/jsx-runtime",
    ]);
  });
});

describe("observeResolveAlias", () => {
  it("extracts webpack object and array string entries", () => {
    expect(observeResolveAlias({ react: "./src/shims/react.ts", lodash: false })).toEqual({
      aliases: { react: "./src/shims/react.ts" },
      functionAlias: false,
    });
    expect(
      observeResolveAlias([{ name: "vue", alias: "./src/shims/vue.ts" }, { name: "skip" }]),
    ).toEqual({
      aliases: { vue: "./src/shims/vue.ts" },
      functionAlias: false,
    });
  });

  it("extracts Vite find/replacement arrays and skips functions", () => {
    expect(observeResolveAlias([{ find: "react", replacement: "./src/shims/react.ts" }])).toEqual({
      aliases: { react: "./src/shims/react.ts" },
      functionAlias: false,
    });
    expect(observeResolveAlias(() => ({}))).toEqual({ aliases: {}, functionAlias: true });
    expect(observeResolveAlias([() => ({}), { find: "vue", replacement: "./vue.ts" }])).toEqual({
      aliases: { vue: "./vue.ts" },
      functionAlias: true,
    });
    expect(observeResolveAlias(undefined)).toBeUndefined();
  });
});

describe("observeTransformImportLibraries", () => {
  it("reads string and libraryName entries and sorts uniquely", () => {
    expect(
      observeTransformImportLibraries([
        { libraryName: "antd", libraryDirectory: "es", style: true },
        "@arco-design/web-react",
        { libraryName: "antd" },
      ]),
    ).toEqual(["@arco-design/web-react", "antd"]);
  });

  it("treats false as observed empty and skips functions", () => {
    expect(observeTransformImportLibraries(false)).toEqual([]);
    expect(observeTransformImportLibraries(() => [{ libraryName: "antd" }])).toBeUndefined();
    expect(observeTransformImportLibraries(undefined)).toBeUndefined();
    expect(observeTransformImportLibraries({ libraryName: "antd" })).toBeUndefined();
  });
});

describe("observeSourceTransformImportFromConfigs", () => {
  it("reads public source.transformImport and prefers the first defined config", () => {
    expect(
      observeSourceTransformImportFromConfigs({
        source: { transformImport: [{ libraryName: "antd" }] },
      }),
    ).toEqual(["antd"]);
    expect(observeSourceTransformImportFromConfigs({ source: {} })).toBeUndefined();
    expect(
      observeSourceTransformImportFromConfigs(
        { source: { transformImport: false } },
        { source: { transformImport: [{ libraryName: "antd" }] } },
      ),
    ).toEqual([]);
    expect(
      observeSourceTransformImportFromConfigs(undefined, {
        source: { transformImport: [{ libraryName: "@arco-design/web-react" }] },
      }),
    ).toEqual(["@arco-design/web-react"]);
  });
});
