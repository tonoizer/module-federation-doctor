import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addBuildFacts, collectProjectFacts } from "../../src/collect.js";
import { resolveOptions } from "../../src/config.js";
import { analyze, analyzeBuild } from "../../src/engine.js";
import { writeReports } from "../../src/reporters.js";
import { AnalysisContentCache } from "../../src/analysis-cache.js";
import { validatePayload } from "../helpers/schema-contract.js";
import type { ArtifactRecord, ArtifactStats, BuildOutputInput } from "../../src/types.js";

const validManifestRecord = {
  kind: "manifest",
  path: "mf-manifest.json",
  valid: true,
  state: "valid",
  source: "discovered",
  manifest: { path: "mf-manifest.json", valid: true, exposes: [], shared: [] },
} satisfies ArtifactRecord;

const invalidManifestRecord = {
  ...validManifestRecord,
  stats: { path: "mf-stats.json", valid: true } satisfies ArtifactStats,
  // @ts-expect-error manifest records cannot carry stats payloads
} satisfies ArtifactRecord;

void invalidManifestRecord;

function viteOutput(partial: Omit<BuildOutputInput, "adapter" | "bundler">): BuildOutputInput {
  return { adapter: "vite", bundler: "vite", ...partial };
}

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-artifacts-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "artifacts" }));
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return root;
}

describe("artifact collection", () => {
  it("uses the deterministic fixture order when the file budget cuts a large tree", async () => {
    const root = path.resolve("fixtures/analysis-budgets/large");
    const facts = await collectProjectFacts(
      await resolveOptions({ root, analysisBudgets: { maxFiles: 3 } }),
    );

    expect(facts.imports.sourceFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(facts.analysis?.status).toBe("partial");
  });

  it("bounds source reads before parsing and keeps the v1 shape", async () => {
    const root = await fixture({
      "src/a.ts": 'import "first";\n',
      "src/b.ts": 'import "second";\n',
    });

    const facts = await collectProjectFacts(
      await resolveOptions({ root, analysisBudgets: { maxFiles: 1 } }),
    );

    expect(facts.imports.sourceFiles).toEqual(["src/a.ts"]);
    expect(facts.analysis?.status).toBe("partial");
    expect(facts.analysis?.exceeded).toEqual([{ kind: "files", limit: 1 }]);
    expect(facts).not.toHaveProperty("budget");
  });

  it("keeps a disappearing source file unresolved without aborting the scan", async () => {
    const root = await fixture({
      "src/race.ts": 'import "remote";\n',
      "src/kept.ts": 'import "kept";\n',
    });
    const originalReadFile = fs.readFile;
    vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
      if (String(file).endsWith(`${path.sep}src${path.sep}race.ts`)) {
        const error = new Error("file disappeared");
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      return originalReadFile(file, options);
    });

    const facts = await collectProjectFacts(await resolveOptions({ root }));

    expect(facts.imports.sourceFiles).toEqual(["src/kept.ts"]);
    expect(facts.imports.unresolvedDynamic).toEqual([]);
    expect(facts.imports.sourceReadFailures).toEqual(["src/race.ts"]);
    expect(facts.analysis?.status).toBe("unknown");
  });

  it("does not expose mutable artifact cache values to the next analysis", async () => {
    const root = await fixture({ "dist/mf-stats.json": JSON.stringify({ assets: ["first.js"] }) });
    const analysisCache = new AnalysisContentCache();
    const options = await resolveOptions({ root, analysisCache });
    const first = await collectProjectFacts(options);
    first.artifacts.stats!.data!.assets = ["mutated.js"];

    const second = await collectProjectFacts(options);
    expect(second.artifacts.stats!.data!.assets).toEqual(["first.js"]);
  });

  it("normalizes module federation config from the parsed manifest once", async () => {
    const manifest = JSON.stringify({
      id: "manifest-id",
      name: "manifest-name",
      metaData: {},
      exposes: [],
      shared: ["react", { name: "react-dom" }],
      remotes: [
        { name: "catalog", alias: "catalogAlias", entry: "https://example.test/catalog.js" },
        { federationContainerName: "checkoutContainer", entry: "https://example.test/checkout.js" },
      ],
    });
    const root = await fixture({ "dist/mf-manifest.json": manifest });
    const originalReadFile = fs.readFile;
    const reads: string[] = [];
    vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
      reads.push(String(file));
      return originalReadFile(file, options);
    });

    const facts = await collectProjectFacts(await resolveOptions({ root }));

    expect(facts.moduleFederation).toMatchObject({
      name: "manifest-name",
      shared: { react: expect.anything(), "react-dom": expect.anything() },
      remotes: {
        catalogAlias: { entry: "https://example.test/catalog.js" },
        checkoutContainer: { entry: "https://example.test/checkout.js" },
      },
    });
    expect(reads.filter((file) => file === path.join(root, "dist/mf-manifest.json"))).toHaveLength(
      1,
    );
  });

  it("bounds artifact parsing and reports omitted records as partial", async () => {
    const root = await fixture({
      "dist/a/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
      "dist/b/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });

    const facts = await collectProjectFacts(
      await resolveOptions({ root, analysisBudgets: { maxArtifacts: 1 } }),
    );

    expect(facts.artifacts.records).toHaveLength(1);
    expect(facts.artifacts.records?.[0]?.path).toBe("dist/a/mf-manifest.json");
    expect(facts.analysis?.status).toBe("partial");
    expect(facts.analysis?.exceeded).toEqual([{ kind: "artifacts", limit: 1 }]);
  });

  it("preflights artifact bytes before parsing", async () => {
    const contents = JSON.stringify({ metaData: {}, exposes: [], shared: [] });
    const root = await fixture({ "dist/mf-manifest.json": contents });
    const facts = await collectProjectFacts(
      await resolveOptions({
        root,
        analysisBudgets: { maxSerializedBytes: Buffer.byteLength(contents) - 1 },
      }),
    );

    expect(facts.artifacts.records).toEqual([]);
    expect(facts.analysis?.exceeded).toEqual([
      { kind: "serializedBytes", limit: contents.length - 1 },
    ]);
  });

  it("does not start artifact parsing after a wall-time cutoff", async () => {
    const root = await fixture({
      "dist/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });
    const facts = await collectProjectFacts(
      await resolveOptions({ root, analysisBudgets: { maxWallTimeMs: 0 } }),
    );

    expect(facts.artifacts.records).toEqual([]);
    expect(facts.analysis?.exceeded).toContainEqual({ kind: "wallTimeMs", limit: 0 });
  });

  it("reuses the bounded cache through source collection", async () => {
    const root = await fixture({ "src/a.ts": 'import "remote";\n' });
    const analysisCache = new AnalysisContentCache();
    const options = await resolveOptions({ root, analysisCache });
    const first = await collectProjectFacts(options);
    const second = await collectProjectFacts(options);

    expect(second.imports).toEqual(first.imports);
    expect(analysisCache.stats.hits).toBeGreaterThan(0);
  });

  it("returns exit code 2 when source collection is incomplete", async () => {
    const root = await fixture({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
    });
    const result = await analyze({
      root,
      analysisBudgets: { maxFiles: 1 },
      output: { formats: [] },
    });
    expect(result.exitCode).toBe(2);
    expect(result.report.findings).toContainEqual(
      expect.objectContaining({ ruleId: "doctor/partial-analysis" }),
    );
  });

  it("keeps duplicate and malformed artifacts as sorted records", async () => {
    const root = await fixture({
      "dist/z/mf-manifest.json": JSON.stringify({
        name: "z",
        metaData: {},
        exposes: [],
        shared: [],
      }),
      "dist/a/mf-manifest.json": JSON.stringify({
        name: "a",
        metaData: {},
        exposes: [],
        shared: [],
      }),
      "dist/b/mf-manifest.json": "not json",
      "dist/mf-stats.json": JSON.stringify({ assets: [] }),
    });

    const facts = await collectProjectFacts(await resolveOptions({ root }));

    expect(facts.artifacts.records).toHaveLength(4);
    expect(
      facts.artifacts.records?.map(({ kind, path: recordPath, valid }) => ({
        kind,
        path: recordPath,
        valid,
      })),
    ).toEqual([
      { kind: "manifest", path: "dist/a/mf-manifest.json", valid: true },
      { kind: "manifest", path: "dist/b/mf-manifest.json", valid: false },
      { kind: "manifest", path: "dist/z/mf-manifest.json", valid: true },
      { kind: "stats", path: "dist/mf-stats.json", valid: true },
    ]);
    expect(facts.artifacts.records?.[0]?.manifest?.name).toBe("a");
    expect(facts.artifacts.records?.[2]?.manifest?.name).toBe("z");
    expect(facts.artifacts.records?.[3]?.stats?.data).toEqual({ assets: [] });
    expect(facts.artifacts.manifest?.path).toBe("dist/a/mf-manifest.json");
    expect(facts.artifacts.stats?.path).toBe("dist/mf-stats.json");
  });

  it("collects configured custom names without scanning unrelated names", async () => {
    const root = await fixture({
      ".output/custom[manifest].json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
      "build/custom-stats.json": JSON.stringify({ assets: ["remote.js"] }),
      "build/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });

    const facts = await collectProjectFacts(
      await resolveOptions({
        root,
        artifactNames: {
          manifest: [".output/custom[manifest].json"],
          stats: ["custom-stats.json"],
        },
      }),
    );

    expect(
      facts.artifacts.records?.map(({ kind, path: recordPath, valid }) => ({
        kind,
        path: recordPath,
        valid,
      })),
    ).toEqual([
      { kind: "manifest", path: ".output/custom[manifest].json", valid: true },
      { kind: "stats", path: "build/custom-stats.json", valid: true },
    ]);
  });

  it("keeps one file as both kinds when configured twice", async () => {
    const root = await fixture({ "build/evidence.json": JSON.stringify({ assets: ["a.js"] }) });
    const facts = await collectProjectFacts(
      await resolveOptions({
        root,
        artifactNames: { manifest: ["evidence.json"], stats: ["evidence.json"] },
      }),
    );
    expect(facts.artifacts.records?.map((record) => record.kind)).toEqual(["manifest", "stats"]);
    expect(facts.artifacts.records?.[0]?.manifest?.path).toBe("build/evidence.json");
    expect(facts.artifacts.records?.[1]?.stats?.data).toEqual({ assets: ["a.js"] });
  });

  it.each(["../outside.json", "/tmp/outside.json", "C:\\\\outside.json"])(
    "rejects unsafe artifact name %s",
    async (name) => {
      const root = await fixture({});
      await expect(
        resolveOptions({ root, artifactNames: { manifest: [name] } }).then(collectProjectFacts),
      ).rejects.toThrow(/safe literal relative path|project root/);
    },
  );

  it("does not follow a symlink outside the project root", async () => {
    const root = await fixture({});
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-outside-"));
    roots.push(outside);
    await fs.writeFile(
      path.join(outside, "mf-manifest.json"),
      JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    );
    await fs.symlink(outside, path.join(root, "linked"), "dir");
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    expect(facts.artifacts.records).toEqual([]);
  });

  it("marks bounded output-root scans as partial emit evidence", async () => {
    const root = await fixture({
      "dist/remoteEntry.js": "export {};\n",
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    await addBuildFacts(facts, ["dist/remoteEntry.js"], root, undefined, [
      viteOutput({
        outputRoot: "dist",
        emittedAssets: ["remoteEntry.js"],
        emittedAssetsSource: "output-root-scan",
        sourceHook: "closeBundle",
      }),
    ]);
    expect(facts.builds?.[0]?.capabilities.emittedAssets).toMatchObject({
      state: "partial",
      source: "closeBundle",
    });
    expect(facts.capabilities.emittedAssets).toBe(false);
    expect(facts.artifacts.emittedAssets).toEqual(["dist/remoteEntry.js"]);
  });

  it("preserves legacy artifacts when structured build outputs are empty", async () => {
    const root = await fixture({
      "dist/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
      "dist/mf-stats.json": JSON.stringify({ assets: ["remoteEntry.js"] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));

    await addBuildFacts(facts, ["dist/remoteEntry.js"], root, undefined, []);

    expect(facts.artifacts.emittedAssets).toEqual(["dist/remoteEntry.js"]);
    expect(facts.capabilities.emittedAssets).toBe(true);
    expect(facts.artifacts.manifest).toMatchObject({ path: "dist/mf-manifest.json" });
    expect(facts.artifacts.stats).toMatchObject({ path: "dist/mf-stats.json" });
    expect(facts.capabilities).toMatchObject({ manifest: true, stats: true });
  });

  it("does not claim emitted assets when empty output evidence is reported", async () => {
    const root = await fixture({
      "dist/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
      "dist/mf-stats.json": JSON.stringify({ assets: ["remoteEntry.js"] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));

    await addBuildFacts(facts, [], root, undefined, []);

    expect(facts.artifacts.emittedAssets).toEqual([]);
    expect(facts.capabilities.emittedAssets).toBe(false);
    expect(facts.artifacts.manifest).toMatchObject({ path: "dist/mf-manifest.json" });
    expect(facts.artifacts.stats).toMatchObject({ path: "dist/mf-stats.json" });
  });

  it("preserves legacy projections when current outputs emit no assets or artifacts", async () => {
    const root = await fixture({
      "dist/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
      "dist/mf-stats.json": JSON.stringify({ assets: ["remoteEntry.js"] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    await addBuildFacts(facts, ["dist/remoteEntry.js"], root);

    await addBuildFacts(facts, [], root, undefined, [
      viteOutput({ outputRoot: "out", emittedAssets: [], sourceHook: "closeBundle" }),
    ]);

    expect(facts.artifacts.emittedAssets).toEqual(["dist/remoteEntry.js"]);
    expect(facts.capabilities.emittedAssets).toBe(false);
    expect(facts.artifacts.manifest).toMatchObject({ path: "dist/mf-manifest.json" });
    expect(facts.artifacts.stats).toMatchObject({ path: "dist/mf-stats.json" });
    expect(facts.capabilities).toMatchObject({ manifest: true, stats: true });
  });

  it("collects exact artifacts from a bounded node_modules output root", async () => {
    const outputRoot = "node_modules/.cache/framework/dist";
    const root = await fixture({
      [`${outputRoot}/mf-manifest.json`]: JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
      [`${outputRoot}/mf-stats.json`]: JSON.stringify({ assets: ["remoteEntry.js"] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }), [outputRoot]);
    await addBuildFacts(
      facts,
      [`${outputRoot}/mf-manifest.json`, `${outputRoot}/mf-stats.json`],
      root,
      undefined,
      [
        viteOutput({
          outputRoot,
          emittedAssets: ["mf-manifest.json", "mf-stats.json"],
          emittedAssetsSource: "output-root-scan",
          emittedAssetsComplete: true,
          sourceHook: "closeBundle",
        }),
      ],
    );
    expect(facts.artifacts.records?.map((record) => record.path)).toEqual([
      `${outputRoot}/mf-manifest.json`,
      `${outputRoot}/mf-stats.json`,
    ]);
    expect(facts.capabilities).toMatchObject({
      emittedAssets: true,
      manifest: true,
      stats: true,
    });
    expect(facts.builds?.[0]?.capabilities.emittedAssets.state).toBe("exact");
  });

  it("discovers custom nested artifacts inside a bounded output root", async () => {
    const outputRoot = "dist";
    const root = await fixture({
      [`${outputRoot}/manifestpath/mf-manifest.json`]: JSON.stringify({
        metaData: { remoteEntry: { name: "static/js/container.js", path: "" } },
        exposes: [],
        shared: [],
      }),
      [`${outputRoot}/manifestpath/mf-stats.json`]: JSON.stringify({ assets: [] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }), [outputRoot]);
    await addBuildFacts(
      facts,
      [`${outputRoot}/manifestpath/mf-manifest.json`, `${outputRoot}/manifestpath/mf-stats.json`],
      root,
      undefined,
      [
        viteOutput({
          outputRoot,
          emittedAssets: ["manifestpath/mf-manifest.json", "manifestpath/mf-stats.json"],
          emittedAssetsSource: "bundle",
          emittedAssetsComplete: true,
          sourceHook: "closeBundle",
        }),
      ],
    );
    expect(facts.artifacts.manifest?.path).toBe(`${outputRoot}/manifestpath/mf-manifest.json`);
    expect(facts.artifacts.stats?.path).toBe(`${outputRoot}/manifestpath/mf-stats.json`);
  });

  it("does not project an arbitrary nested manifest before build linkage", async () => {
    const outputRoot = "dist";
    const root = await fixture({
      [`${outputRoot}/client/mf-manifest.json`]: JSON.stringify({
        metaData: { remoteEntry: { name: "client.js", path: "" } },
        exposes: [],
        shared: [],
      }),
      [`${outputRoot}/server/mf-manifest.json`]: JSON.stringify({
        metaData: { remoteEntry: { name: "server.js", path: "" } },
        exposes: [],
        shared: [],
      }),
    });

    const facts = await collectProjectFacts(await resolveOptions({ root }), [outputRoot]);

    expect(facts.artifacts.records?.map((record) => record.path)).toEqual([
      `${outputRoot}/client/mf-manifest.json`,
      `${outputRoot}/server/mf-manifest.json`,
    ]);
    expect(facts.artifacts.manifest).toBeUndefined();
    expect(facts.capabilities.manifest).toBe(false);
  });

  it("requires exact relative asset matching for output artifact linkage", async () => {
    const root = await fixture({
      "dist/nested/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    await addBuildFacts(facts, ["dist/mf-manifest.json"], root, undefined, [
      viteOutput({
        outputRoot: "dist",
        emittedAssets: ["mf-manifest.json"],
        sourceHook: "closeBundle",
      }),
    ]);
    expect(facts.builds?.[0]?.artifacts).toEqual([]);
  });

  it("does not attach discovered artifacts to a write-disabled output", async () => {
    const root = await fixture({
      "dist/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    await addBuildFacts(facts, ["dist/mf-manifest.json"], root, undefined, [
      viteOutput({
        outputRoot: "dist",
        emittedAssets: ["mf-manifest.json"],
        buildWrite: false,
        sourceHook: "closeBundle",
      }),
    ]);
    expect(facts.builds?.[0]?.artifacts).toEqual([]);
    expect(facts.builds?.[0]?.emittedAssets).toEqual([]);
  });

  it("sizes same-named assets from their exact recorded output roots", async () => {
    const root = await fixture({
      "out/a/remoteEntry.js": "small",
      "out/b/remoteEntry.js": "this is larger",
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    await addBuildFacts(facts, ["out/a/remoteEntry.js", "out/b/remoteEntry.js"], root, undefined, [
      viteOutput({
        outputRoot: "out/a",
        emittedAssets: ["remoteEntry.js"],
        sourceHook: "closeBundle",
      }),
      viteOutput({
        outputRoot: "out/b",
        emittedAssets: ["remoteEntry.js"],
        sourceHook: "closeBundle",
      }),
    ]);
    expect(facts.artifacts.assetSizes?.["out/a/remoteEntry.js"]).toBe(5);
    expect(facts.artifacts.assetSizes?.["out/b/remoteEntry.js"]).toBe(14);
    expect(facts.artifacts.assetSizes?.["remoteEntry.js"]).toBeUndefined();
  });

  it("uses only current emitted artifacts for the legacy projection", async () => {
    const root = await fixture({
      "dist/stale/mf-manifest.json": "not json",
      "dist/current/mf-manifest.json": "not json",
      "dist/other/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }), [
      "dist/current",
      "dist/other",
    ]);
    await addBuildFacts(
      facts,
      ["dist/current/mf-manifest.json", "dist/other/mf-manifest.json"],
      root,
      undefined,
      [
        viteOutput({
          outputRoot: "dist/current",
          emittedAssets: ["mf-manifest.json"],
          sourceHook: "closeBundle",
        }),
        viteOutput({
          outputRoot: "dist/other",
          emittedAssets: ["mf-manifest.json"],
          sourceHook: "closeBundle",
        }),
      ],
    );
    expect(facts.artifacts.records?.map((record) => record.path)).toEqual([
      "dist/current/mf-manifest.json",
      "dist/other/mf-manifest.json",
    ]);
    expect(facts.artifacts.manifest?.valid).toBe(false);
  });

  it("canonicalizes set-like output arrays before ordering builds", async () => {
    const root = await fixture({
      "out/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    const outputs = [
      viteOutput({
        emittedAssets: ["remoteEntry.js", "mf-manifest.json"],
        federationInstanceIds: ["zeta", "alpha"],
        sourceHook: "first",
      }),
      viteOutput({
        emittedAssets: ["mf-manifest.json", "remoteEntry.js"],
        federationInstanceIds: ["alpha", "zeta"],
        sourceHook: "second",
      }),
    ];
    const originalArrays = outputs.map((output) => ({
      emittedAssets: output.emittedAssets.slice(),
      federationInstanceIds: output.federationInstanceIds?.slice(),
    }));

    await addBuildFacts(facts, ["out/mf-manifest.json"], root, undefined, outputs);

    expect(facts.builds?.map((build) => build.sourceHook)).toEqual(["first", "second"]);
    expect(facts.artifacts.emittedAssets).toEqual(["mf-manifest.json", "remoteEntry.js"]);
    expect(
      outputs.map((output) => ({
        emittedAssets: output.emittedAssets,
        federationInstanceIds: output.federationInstanceIds,
      })),
    ).toEqual(originalArrays);
  });

  it("orders outputs by complete metadata and projects the same primary build", async () => {
    const root = await fixture({});
    const outputs = [
      viteOutput({
        target: "server",
        targetKind: "node",
        buildWrite: false,
        effectiveMode: "production",
        engine: "rolldown",
        flavor: "rolldown-vite",
        emittedAssets: ["shared.js"],
        sourceHook: "same-hook",
      }),
      viteOutput({
        target: "browser",
        targetKind: "web",
        buildWrite: true,
        effectiveMode: "development",
        engine: "rollup",
        flavor: "vite",
        emittedAssets: ["shared.js"],
        sourceHook: "same-hook",
      }),
    ];
    const facts = await collectProjectFacts(await resolveOptions({ root }));

    await addBuildFacts(facts, [], root, undefined, outputs);

    expect(
      facts.builds?.map((build) => ({
        target: build.target,
        targetKind: build.targetKind,
        buildWrite: build.emittedAssets.length > 0,
        effectiveMode: build.effectiveMode,
        engine: build.engine,
        flavor: build.flavor,
      })),
    ).toEqual([
      {
        target: "server",
        targetKind: "node",
        buildWrite: false,
        effectiveMode: "production",
        engine: "rolldown",
        flavor: "rolldown-vite",
      },
      {
        target: "browser",
        targetKind: "web",
        buildWrite: true,
        effectiveMode: "development",
        engine: "rollup",
        flavor: "vite",
      },
    ]);
    expect(facts.artifacts.emittedAssets).toEqual(["shared.js"]);
  });

  it("keeps canonical numeric build ordering and legacy projection stable", async () => {
    const root = await fixture({});
    const outputs = Array.from({ length: 10 }, (_, index) => {
      const outputNumber = 10 - index;
      return viteOutput({
        outputRoot: `out/${String(outputNumber).padStart(2, "0")}`,
        emittedAssets: [`remote-${String(outputNumber).padStart(2, "0")}.js`],
        sourceHook: `hook-${String(outputNumber).padStart(2, "0")}`,
      });
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));

    await addBuildFacts(facts, [], root, undefined, outputs);

    expect(facts.builds?.map((build) => build.id)).toEqual([
      "vite-build-1",
      "vite-build-2",
      "vite-build-3",
      "vite-build-4",
      "vite-build-5",
      "vite-build-6",
      "vite-build-7",
      "vite-build-8",
      "vite-build-9",
      "vite-build-10",
    ]);
    expect(facts.builds?.map((build) => build.sourceHook)).toEqual(
      Array.from({ length: 10 }, (_, index) => `hook-${String(index + 1).padStart(2, "0")}`),
    );
    expect(facts.artifacts.emittedAssets).toEqual(
      Array.from(
        { length: 10 },
        (_, index) =>
          `out/${String(index + 1).padStart(2, "0")}/remote-${String(index + 1).padStart(2, "0")}.js`,
      ).sort(),
    );
  });

  it("uses the current output root for bare manifest budget assets", async () => {
    const root = await fixture({
      "out/a/mf-manifest.json": JSON.stringify({
        metaData: { remoteEntry: { name: "remoteEntry.js", path: "" } },
        exposes: [],
        shared: [],
      }),
      "out/a/remoteEntry.js": "1234567890",
      "out/b/mf-manifest.json": JSON.stringify({
        metaData: { remoteEntry: { name: "remoteEntry.js", path: "" } },
        exposes: [],
        shared: [],
      }),
      "out/b/remoteEntry.js": "small",
    });
    const result = await analyzeBuild(
      {
        root,
        bundler: "vite",
        mode: "ci",
        artifactNames: { manifest: ["mf-manifest.json"], stats: [] },
        output: { formats: [] },
        rules: {
          "performance/asset-budget": ["warning", { remoteEntryMaxBytes: 5 }],
          "artifact/remote-entry-missing": "off",
          "artifact/types-missing": "off",
          "config/plugin-package-mismatch": "off",
          "doctor/partial-analysis": "off",
        },
      },
      [
        "out/a/mf-manifest.json",
        "out/a/remoteEntry.js",
        "out/b/mf-manifest.json",
        "out/b/remoteEntry.js",
      ],
      undefined,
      [
        viteOutput({
          outputRoot: "out/a",
          emittedAssets: ["mf-manifest.json", "remoteEntry.js"],
          sourceHook: "closeBundle",
        }),
        viteOutput({
          outputRoot: "out/b",
          emittedAssets: ["mf-manifest.json", "remoteEntry.js"],
          sourceHook: "closeBundle",
        }),
      ],
    );
    expect(
      result.report.findings.some((finding) => finding.ruleId === "performance/asset-budget"),
    ).toBe(true);
    expect(result.facts.artifacts.assetSizes?.["out/a/remoteEntry.js"]).toBe(10);
    expect(result.facts.artifacts.assetSizes?.["out/b/remoteEntry.js"]).toBe(5);
    expect(result.facts.artifacts.assetSizes?.["remoteEntry.js"]).toBeUndefined();
  });

  it("does not let another output satisfy an exact remote-entry rule", async () => {
    const root = await fixture({
      "out/a/mf-manifest.json": JSON.stringify({
        metaData: { remoteEntry: { name: "remoteEntry.js", path: "" } },
        exposes: [],
        shared: [],
      }),
      "out/b/mf-manifest.json": JSON.stringify({
        metaData: { remoteEntry: { name: "remoteEntry.js", path: "" } },
        exposes: [],
        shared: [],
      }),
      "out/b/remoteEntry.js": "present",
    });
    const result = await analyzeBuild(
      {
        root,
        bundler: "vite",
        mode: "ci",
        artifactNames: { manifest: ["mf-manifest.json"], stats: [] },
        output: { formats: [] },
        rules: {
          "artifact/manifest-remote-entry-missing": "error",
          "artifact/types-missing": "off",
          "config/plugin-package-mismatch": "off",
          "doctor/partial-analysis": "off",
        },
      },
      ["out/a/mf-manifest.json", "out/b/mf-manifest.json", "out/b/remoteEntry.js"],
      undefined,
      [
        viteOutput({
          outputRoot: "out/a",
          emittedAssets: ["mf-manifest.json"],
          sourceHook: "closeBundle",
        }),
        viteOutput({
          outputRoot: "out/b",
          emittedAssets: ["mf-manifest.json", "remoteEntry.js"],
          sourceHook: "closeBundle",
        }),
      ],
    );
    expect(
      result.report.findings.some(
        (finding) => finding.ruleId === "artifact/manifest-remote-entry-missing",
      ),
    ).toBe(true);
  });

  it("keeps v1 project output compatible while exposing records to API callers", async () => {
    const root = await fixture({
      "dist/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    expect(facts.artifacts.records).toHaveLength(1);
    const output = path.join(root, "out");
    await writeReports(
      facts,
      {
        schemaVersion: 1,
        capabilities: facts.capabilities,
        summary: { projects: 1, info: 0, warnings: 0, errors: 0 },
        findings: [],
      },
      output,
      [],
    );
    const written = JSON.parse(await fs.readFile(path.join(output, "project.json"), "utf8")) as {
      artifacts: { records?: unknown };
    };
    expect(written.artifacts.records).toBeUndefined();
    await validatePayload("project.schema.json", written, "v1 project output");
  });
});
