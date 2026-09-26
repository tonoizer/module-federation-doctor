import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachAssetSizes, lookupAssetSize, sumAssetSizes } from "../../src/collect.js";
import type { ProjectFacts } from "../../src/types.js";

const roots: string[] = [];
const outsidePaths: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  await Promise.all(
    outsidePaths.splice(0).map((outside) => fs.rm(outside, { recursive: true, force: true })),
  );
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

  it("does not size a manifest asset that escapes the project root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-sizes-"));
    roots.push(root);
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
    outsidePaths.push(outside);
    await fs.writeFile(outside, Buffer.alloc(128));

    const facts = baseFacts();
    facts.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      remoteEntry: { name: `../../${path.basename(outside)}`, path: "" },
      exposes: [],
      shared: [],
    };

    await attachAssetSizes(facts, root);
    expect(facts.artifacts.assetSizes).toBeUndefined();
  });

  it("does not size an emitted asset that escapes an output root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-sizes-"));
    roots.push(root);
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
    outsidePaths.push(outside);
    await fs.writeFile(outside, Buffer.alloc(128));

    const facts = baseFacts();
    facts.artifacts.emittedAssets = [`../../${path.basename(outside)}`];

    await attachAssetSizes(facts, root, ["dist"]);
    expect(facts.artifacts.assetSizes).toBeUndefined();
  });

  it("does not size an in-root asset path that resolves through a symlink outside", async ({
    skip,
  }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-sizes-"));
    roots.push(root);
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside`);
    outsidePaths.push(outside);
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "remoteEntry.js"), Buffer.alloc(128));
    try {
      await fs.symlink(outside, path.join(root, "dist", "linked"), "junction");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") skip();
      throw error;
    }

    const facts = baseFacts();
    facts.artifacts.emittedAssets = ["dist/linked/remoteEntry.js"];

    await attachAssetSizes(facts, root, ["dist"]);
    expect(facts.artifacts.assetSizes).toBeUndefined();
  });

  it("preserves in-root output-root asset aliases", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-sizes-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "dist"));
    await fs.writeFile(path.join(root, "dist", "remoteEntry.js"), Buffer.alloc(128));
    const facts = baseFacts();
    facts.artifacts.emittedAssets = ["remoteEntry.js"];

    await attachAssetSizes(facts, root, ["dist"]);
    expect(lookupAssetSize(facts.artifacts.assetSizes, "dist/remoteEntry.js")).toBe(128);
    expect(lookupAssetSize(facts.artifacts.assetSizes, "remoteEntry.js")).toBe(128);
  });
});
