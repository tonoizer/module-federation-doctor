import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachAssetSizes, lookupAssetSize, sumAssetSizes } from "../../src/collect.js";
import type { ProjectFacts } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function baseFacts(): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: "fixture", root: "." },
    bundler: { name: "vite", mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: true,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: { emittedAssets: [] },
  };
}

describe("asset size collection", () => {
  it("resolves manifest assets next to mf-manifest.json", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-sizes-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "dist"));
    await fs.writeFile(path.join(root, "dist/remoteEntry.js"), Buffer.alloc(128));
    await fs.writeFile(path.join(root, "dist/Widget.js"), Buffer.alloc(64));
    await fs.writeFile(path.join(root, "dist/mf-manifest.json"), "{}");

    const facts = baseFacts();
    facts.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      remoteEntry: { name: "remoteEntry.js", path: "" },
      exposes: [{ key: "./Widget", assets: ["Widget.js"] }],
      shared: [],
    };

    await attachAssetSizes(facts, root);
    expect(lookupAssetSize(facts.artifacts.assetSizes, "remoteEntry.js")).toBe(128);
    expect(sumAssetSizes(facts.artifacts.assetSizes, ["Widget.js"])).toBe(64);
  });

  it("leaves assetSizes unset when no files exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-sizes-"));
    roots.push(root);
    const facts = baseFacts();
    facts.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      remoteEntry: { name: "remoteEntry.js", path: "" },
      exposes: [],
      shared: [],
    };
    await attachAssetSizes(facts, root);
    expect(facts.artifacts.assetSizes).toBeUndefined();
  });
});
