import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReleaseFiles } from "../../scripts/generate-release-files.mjs";

describe("release file generation", () => {
  it("writes a checksum and manifest for one package tarball", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mfdoctor-release-files-"));
    try {
      const outputDir = path.join(root, "release-files");
      const packagePath = path.join(root, "package.json");
      await mkdir(outputDir);
      await writeFile(packagePath, JSON.stringify({ name: "example", version: "1.2.3" }));
      const packageBytes = Buffer.from("package tarball");
      await writeFile(path.join(outputDir, "example-1.2.3.tgz"), packageBytes);

      const manifest = await createReleaseFiles({
        outputDir,
        packagePath,
        tag: "1.2.3",
        commit: "abc123",
      });

      const sha256 = createHash("sha256").update(packageBytes).digest("hex");
      expect(manifest).toMatchObject({
        name: "example",
        version: "1.2.3",
        tag: "1.2.3",
        commit: "abc123",
        packageFile: "example-1.2.3.tgz",
        sha256,
      });
      expect(await readFile(path.join(outputDir, "SHA256SUMS"), "utf8")).toBe(
        `${sha256}  example-1.2.3.tgz\n`,
      );
      expect(
        JSON.parse(await readFile(path.join(outputDir, "release-manifest.json"), "utf8")),
      ).toEqual(manifest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a v-prefixed or mismatched release tag", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mfdoctor-release-files-"));
    try {
      const outputDir = path.join(root, "release-files");
      const packagePath = path.join(root, "package.json");
      await mkdir(outputDir);
      await writeFile(packagePath, JSON.stringify({ name: "example", version: "1.2.3" }));
      await writeFile(path.join(outputDir, "example-1.2.3.tgz"), "package tarball");

      await expect(
        createReleaseFiles({ outputDir, packagePath, tag: "v1.2.3", commit: "abc123" }),
      ).rejects.toThrow("plain semver");
      await expect(
        createReleaseFiles({ outputDir, packagePath, tag: "1.2.4", commit: "abc123" }),
      ).rejects.toThrow("does not match");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps release automation attached to GitHub releases without publishing npm", async () => {
    const workflow = await readFile(path.resolve(".github/workflows/release-files.yml"), "utf8");

    expect(workflow).toContain("types: [published]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("description: Existing plain-semver GitHub release tag");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("contents: write");
    expect(workflow.indexOf("Verify release tag")).toBeLessThan(
      workflow.indexOf("uses: ./.github/actions/setup-vp"),
    );
    expect(workflow).toContain("git rev-parse HEAD");
    expect(workflow).toContain("GH_REPO: ${{ github.repository }}");
    expect(workflow).not.toContain("GITHUB_SHA");
    expect(workflow).toContain("gh release upload");
    expect(workflow).not.toContain("npm publish");
  });
});
