import { describe, expect, it } from "vitest";
import {
  conflictingSplitChunksCacheGroups,
  extractCompilerSplitChunksFacts,
  extractRsbuildSplitChunksFacts,
  extractWebpackSplitChunksFacts,
  isMfRuntimeChunkToken,
} from "../../src/split-chunks.js";
import type { ProjectFacts } from "../../src/types.js";

function facts(overrides: Partial<ProjectFacts> = {}): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: "shop", root: "." },
    bundler: { name: "webpack", mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: {
      name: "shop",
      filename: "remoteEntry.js",
      exposes: {},
      remotes: {},
      shared: {},
    },
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: ["source"],
    },
    artifacts: { emittedAssets: [] },
    ...overrides,
  };
}

describe("splitChunks facts", () => {
  it("treats missing compiler optimization as unobserved", () => {
    expect(extractCompilerSplitChunksFacts(undefined)).toBeUndefined();
  });

  it("records observed optimization without inventing cacheGroups", () => {
    expect(extractCompilerSplitChunksFacts({})).toEqual({});
    expect(extractWebpackSplitChunksFacts({ chunks: "all" })).toEqual({ chunks: "all" });
    expect(extractWebpackSplitChunksFacts(false)).toEqual({});
  });

  it("serializes public cacheGroup name and regex test", () => {
    expect(
      extractWebpackSplitChunksFacts({
        chunks: "all",
        cacheGroups: {
          defaultVendors: { test: /[\\/]node_modules[\\/]/, priority: -10 },
          "mf-runtime": { name: "mf-runtime", test: /mf-/ },
          skip: false,
          fn: { name: () => "nope", test: () => true },
        },
      }),
    ).toEqual({
      chunks: "all",
      cacheGroups: [
        { name: "defaultVendors", test: String.raw`[\\/]node_modules[\\/]` },
        { name: "fn" },
        { name: "mf-runtime", chunkName: "mf-runtime", test: "mf-" },
      ],
    });
  });

  it("reads Rsbuild performance.chunkSplit.override and object tools.rspack", () => {
    expect(
      extractRsbuildSplitChunksFacts({
        performance: {
          chunkSplit: {
            strategy: "custom",
            override: {
              cacheGroups: { remoteEntry: { name: "remoteEntry", test: /remoteEntry/ } },
            },
          },
        },
        tools: {
          rspack: {
            optimization: {
              splitChunks: { cacheGroups: { "mf-shared": { name: "mf-shared" } } },
            },
          },
        },
      }),
    ).toEqual({
      cacheGroups: [
        { name: "mf-shared", chunkName: "mf-shared" },
        { name: "remoteEntry", chunkName: "remoteEntry", test: "remoteEntry" },
      ],
    });
  });

  it("skips function-form tools.rspack", () => {
    expect(
      extractRsbuildSplitChunksFacts({
        tools: { rspack: () => ({ optimization: { splitChunks: { chunks: "all" } } }) },
      }),
    ).toEqual({});
  });
});

describe("MF runtime cacheGroup matching", () => {
  it("recognizes mf-*, remoteEntry, and shared-runtime tokens", () => {
    expect(isMfRuntimeChunkToken("mf-runtime")).toBe(true);
    expect(isMfRuntimeChunkToken("mf_remote_runtime")).toBe(true);
    expect(isMfRuntimeChunkToken("mfRuntime")).toBe(true);
    expect(isMfRuntimeChunkToken("remoteEntry.js")).toBe(true);
    expect(isMfRuntimeChunkToken("__federation_shared_react")).toBe(true);
    expect(isMfRuntimeChunkToken("consume-shared")).toBe(true);
    expect(isMfRuntimeChunkToken("defaultVendors")).toBe(false);
    expect(isMfRuntimeChunkToken("app")).toBe(false);
  });

  it("conflicts on named MF groups and not on vendor groups", () => {
    const project = facts();
    expect(
      conflictingSplitChunksCacheGroups(
        {
          chunks: "all",
          cacheGroups: [{ name: "vendors", test: String.raw`[\\/]node_modules[\\/]` }],
        },
        project,
      ),
    ).toEqual([]);
    expect(
      conflictingSplitChunksCacheGroups(
        { cacheGroups: [{ name: "runtime", chunkName: "remoteEntry" }] },
        project,
      ).map((group) => group.name),
    ).toEqual(["runtime"]);
  });

  it("uses the observed MF filename as a runtime chunk name", () => {
    const project = facts();
    project.moduleFederation!.filename = "shopContainer.js";
    expect(
      conflictingSplitChunksCacheGroups(
        { cacheGroups: [{ name: "container", chunkName: "shopContainer" }] },
        project,
      ),
    ).toHaveLength(1);
  });
});
