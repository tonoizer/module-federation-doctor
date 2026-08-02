import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installedVersions } from "../../src/collect.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("installed dependency resolution", () => {
  it("follows the real Node lookup chain for hoisted packages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-deps-"));
    temporaryRoots.push(root);
    const app = path.join(root, "apps", "web");
    await fs.mkdir(path.join(root, "node_modules", "shared-package"), { recursive: true });
    await fs.mkdir(app, { recursive: true });
    await fs.writeFile(path.join(app, "package.json"), JSON.stringify({ name: "web" }));
    await fs.writeFile(
      path.join(root, "node_modules", "shared-package", "package.json"),
      JSON.stringify({ name: "shared-package", version: "4.5.6" }),
    );
    await fs.writeFile(path.join(root, "node_modules", "shared-package", "index.js"), "export {};");

    await expect(installedVersions(app, { "shared-package": "workspace:*" })).resolves.toEqual({
      "shared-package": "4.5.6",
    });
  });
});
