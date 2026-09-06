import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("standalone Modern findings cell (BL-21)", () => {
  it("registers the Modern adapter with failOn never and keeps matrix status partial", async () => {
    const build = await fs.readFile(
      path.join(root, "examples/standalone-findings/modern/build.mjs"),
      "utf8",
    );
    expect(build).toContain('from "@tonoizer/mfdoctor/modern"');
    expect(build).toContain('failOn: "never"');
    expect(build).toContain("modifyBundlerChain");
    expect(build).not.toContain("@tonoizer/mfdoctor/rspack");

    const catalog = await fs.readFile(
      path.join(root, "scripts/demo-standalone-findings.mjs"),
      "utf8",
    );
    expect(catalog).toContain("fixtures/adapters/cases.json");

    const adapterCases = JSON.parse(
      await fs.readFile(path.join(root, "fixtures/adapters/cases.json"), "utf8"),
    ) as {
      emit: Array<{
        bundler: string;
        filter: string;
        ruleIds: string[];
        incompleteReasons?: string[];
      }>;
    };
    const modern = adapterCases.emit.find((cell) => cell.bundler === "modern");
    expect(modern?.filter).toBe("@mfdoctor-standalone/modern");
    expect(modern?.ruleIds).toEqual(
      expect.arrayContaining(["shared/version-unsatisfied", "shared/singleton-risk"]),
    );
    expect(modern?.incompleteReasons).toContain("partial-bundler");

    const matrix = JSON.parse(
      await fs.readFile(path.join(root, "fixtures/compatibility-matrix.json"), "utf8"),
    ) as { bundlers: Array<{ id: string; status: string }> };
    expect(matrix.bundlers.find((entry) => entry.id === "modern")?.status).toBe("partial");
  });
});
