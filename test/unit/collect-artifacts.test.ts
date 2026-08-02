import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addBuildFacts, collectProjectFacts } from "../../src/collect.js";
import { resolveOptions } from "../../src/config.js";
import { analyzeBuild } from "../../src/engine.js";
import { writeReports } from "../../src/reporters.js";
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
    expect(facts.capabilities.manifest).toBe(true);
  });

  it("clears stale manifest capability when no current output emitted one", async () => {
    const root = await fixture({
      "dist/stale/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }), ["dist/current"]);
    await addBuildFacts(facts, [], root, undefined, [
      viteOutput({
        outputRoot: "dist/current",
        emittedAssets: [],
        sourceHook: "closeBundle",
      }),
    ]);
    expect(facts.artifacts.manifest).toBeUndefined();
    expect(facts.capabilities.manifest).toBe(false);
  });

  it.each([
    "../shared/remoteEntry.js",
    "/shared/remoteEntry.js",
    "..\\shared\\remoteEntry.js",
    "C:\\shared\\remoteEntry.js",
  ])("does not size manifest asset path escaping its output: %s", async (asset) => {
    const root = await fixture({
      "out/a/mf-manifest.json": JSON.stringify({
        metaData: { remoteEntry: { name: asset, path: "" } },
        exposes: [],
        shared: [],
      }),
      "out/shared/remoteEntry.js": "this must not be borrowed",
    });
    const facts = await collectProjectFacts(await resolveOptions({ root }));
    await addBuildFacts(facts, ["out/a/mf-manifest.json"], root, undefined, [
      viteOutput({
        outputRoot: "out/a",
        emittedAssets: ["mf-manifest.json"],
        sourceHook: "closeBundle",
      }),
    ]);
    expect(facts.artifacts.assetSizes?.["out/shared/remoteEntry.js"]).toBeUndefined();
  });

  it("uses the current output root for bare manifest budget assets", async () => {
    const root = await fixture({
      "out/a/mf-manifest.json": JSON.stringify({
        metaData: { remoteEntry: { name: "remoteEntry.js", path: "" } },
        exposes: [],
        shared: [],
      }),
      "out/a/remoteEntry.js": "small",
      "out/b/mf-manifest.json": JSON.stringify({
        metaData: { remoteEntry: { name: "remoteEntry.js", path: "" } },
        exposes: [],
        shared: [],
      }),
      "out/b/remoteEntry.js": "1234567890",
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
    expect(result.facts.artifacts.assetSizes?.["out/a/remoteEntry.js"]).toBe(5);
    expect(result.facts.artifacts.assetSizes?.["out/b/remoteEntry.js"]).toBe(10);
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
