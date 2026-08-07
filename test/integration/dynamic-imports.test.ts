import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../../src/engine.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("dynamic-import integration", () => {
  it("keeps shared/unused quiet when loadShare literals prove usage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-dyn-int-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"dyn-int"}');
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.copyFile(
      path.join(fixtures, "dynamic-imports/load-share.ts"),
      path.join(root, "src/app.ts"),
    );

    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "shared/singleton-risk": "off",
      },
      moduleFederation: {
        name: "dyn_int",
        shared: { react: { singleton: true } },
      },
    });

    expect(result.facts.imports.dynamicPackages).toContain("react");
    expect(result.report.findings.some((item) => item.ruleId === "shared/unused")).toBe(false);
  });

  it("reports partial-analysis for unresolved dynamics instead of unused", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-dyn-partial-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"dyn-partial"}');
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.copyFile(
      path.join(fixtures, "dynamic-imports/unresolved-load-share.ts"),
      path.join(root, "src/app.ts"),
    );

    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      rules: {
        "config/plugin-package-mismatch": "off",
        "shared/singleton-risk": "off",
      },
      moduleFederation: {
        name: "dyn_partial",
        shared: { lodash: { singleton: false } },
      },
    });

    expect(result.facts.imports.unresolvedDynamic.some((item) => item.api === "loadShare")).toBe(
      true,
    );
    expect(result.facts.analysis?.status).toBe("complete");
    expect(result.exitCode).toBe(0);
    expect(result.report.findings.some((item) => item.ruleId === "doctor/partial-analysis")).toBe(
      true,
    );
    expect(result.report.findings.some((item) => item.ruleId === "shared/unused")).toBe(false);
  });

  it("reports unreadable static-import source as unknown input", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-dyn-read-failure-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"dyn-read-failure"}');
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/app.ts"), 'import "./unreadable";\n');
    const unreadable = path.join(root, "src/unreadable.ts");
    await fs.writeFile(unreadable, "export const value = 1;\n");

    const originalReadFile = fs.readFile;
    const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
      if (path.resolve(String(file)) === unreadable) throw new Error("fixture read failed");
      return originalReadFile(file, options);
    });
    try {
      const result = await analyze({
        root,
        bundler: "vite",
        mode: "development",
        output: { formats: [] },
        rules: {
          "config/plugin-package-mismatch": "off",
          "shared/singleton-risk": "off",
        },
        moduleFederation: { name: "dyn_read_failure", shared: { react: { singleton: true } } },
      });

      expect(result.facts.imports.unresolvedDynamic).toEqual([]);
      expect(result.facts.imports.sourceReadFailures).toEqual(["src/unreadable.ts"]);
      expect(result.facts.analysis?.status).toBe("unknown");
      expect(result.exitCode).toBe(2);
      const finding = result.report.findings.find(
        (item) => item.ruleId === "doctor/partial-analysis",
      );
      expect(finding?.message).toMatch(/unreadable|unknown source input/i);
      expect(finding?.suggestion).toMatch(/unreadable|unknown source input/i);
      expect(finding?.evidence).toMatchObject({ sourceReadFailures: ["src/unreadable.ts"] });
      expect(finding?.details).toMatchObject({ sourceReadFailures: ["src/unreadable.ts"] });
      expect(finding?.message).not.toMatch(/dynamic import/i);
      expect(finding?.suggestion).not.toMatch(/dynamic import/i);
      expect(result.report.findings.some((item) => item.ruleId === "shared/unused")).toBe(false);
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("uses opt-in runtimeTrace during check without network", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-dyn-trace-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"dyn-trace"}');
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/app.ts"), "export {}\n");

    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      runtimeTrace: path.join(fixtures, "runtime-traces/healthy.json"),
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "shared/singleton-risk": "off",
      },
      moduleFederation: {
        name: "dyn_trace",
        shared: { react: { singleton: true } },
      },
    });

    expect(result.facts.imports.evidenceSources).toContain("runtime-trace");
    expect(result.facts.imports.packages).toContain("react");
    expect(result.report.findings.some((item) => item.ruleId === "shared/unused")).toBe(false);
  });
});
