import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProjectFacts } from "../../src/collect.js";
import { resolveOptions } from "../../src/config.js";
import { analyze } from "../../src/engine.js";
import { writeReports } from "../../src/reporters.js";
import { validatePayload } from "../helpers/schema-contract.js";
import type { ArtifactRecord, ArtifactStats } from "../../src/types.js";

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
