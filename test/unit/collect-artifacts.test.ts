import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProjectFacts } from "../../src/collect.js";
import { resolveOptions } from "../../src/config.js";

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
      "dist/z/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
      "dist/a/mf-manifest.json": "not json",
      "dist/mf-stats.json": JSON.stringify({ assets: [] }),
    });

    const facts = await collectProjectFacts(await resolveOptions({ root }));

    expect(facts.artifacts.records).toEqual([
      { kind: "manifest", path: "dist/a/mf-manifest.json", valid: false, source: "discovered" },
      { kind: "manifest", path: "dist/z/mf-manifest.json", valid: true, source: "discovered" },
      { kind: "stats", path: "dist/mf-stats.json", valid: true, source: "discovered" },
    ]);
    expect(facts.artifacts.manifest?.path).toBe("dist/a/mf-manifest.json");
    expect(facts.artifacts.stats?.path).toBe("dist/mf-stats.json");
  });

  it("collects configured custom names without scanning unrelated names", async () => {
    const root = await fixture({
      "build/custom-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
      "build/custom-stats.json": JSON.stringify({ assets: [] }),
      "build/mf-manifest.json": JSON.stringify({ metaData: {}, exposes: [], shared: [] }),
    });

    const facts = await collectProjectFacts(
      await resolveOptions({
        root,
        artifactNames: { manifest: ["custom-manifest.json"], stats: ["custom-stats.json"] },
      }),
    );

    expect(facts.artifacts.records).toEqual([
      {
        kind: "manifest",
        path: "build/custom-manifest.json",
        valid: true,
        source: "discovered",
      },
      { kind: "stats", path: "build/custom-stats.json", valid: true, source: "discovered" },
    ]);
  });
});
