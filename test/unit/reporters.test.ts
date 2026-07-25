import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeReports } from "../../src/reporters.js";
import type { DoctorReport, ProjectFacts } from "../../src/types.js";

describe("reporters", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("writes json and sarif reports", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-"));
    roots.push(output);
    const facts = {
      schemaVersion: 1,
      project: { name: "demo", root: "." },
      bundler: { name: "vite", mode: "development" },
      capabilities: {
        config: true,
        sourceImports: false,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: false,
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
    } satisfies ProjectFacts;
    const report = {
      schemaVersion: 1,
      capabilities: facts.capabilities,
      summary: { projects: 1, info: 0, warnings: 0, errors: 1, suppressed: 1 },
      findings: [
        {
          schemaVersion: 1,
          ruleId: "config/name-required",
          severity: "error",
          message: "name is required",
          project: "demo",
          evidence: {},
          documentation: "/rules/config/name-required",
          fingerprint: "abc",
          suppressed: true,
          suppressionReason: "legacy debt",
        },
      ],
    } satisfies DoctorReport;

    await writeReports(facts, report, output, ["json", "sarif"]);

    const json = JSON.parse(await fs.readFile(path.join(output, "report.json"), "utf8"));
    const sarif = JSON.parse(await fs.readFile(path.join(output, "results.sarif"), "utf8"));
    expect(json.findings[0].ruleId).toBe("config/name-required");
    expect(json.findings[0].suppressed).toBe(true);
    expect(sarif.runs[0].results[0].ruleId).toBe("config/name-required");
    expect(sarif.runs[0].results[0].suppressions).toEqual([
      { kind: "external", justification: "legacy debt" },
    ]);
    await expect(fs.access(path.join(output, "report.html"))).rejects.toThrow();
  });
});
