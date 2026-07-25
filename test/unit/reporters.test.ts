import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";

describe("reporters", () => {
  it("writes portable JSON, SARIF, and a safe offline HTML report", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-report-"));
    try {
      await fs.writeFile(path.join(root, "package.json"), '{"name":"report-fixture"}');
      const output = path.join(root, "out");
      const result = await analyze({
        root,
        mode: "ci",
        output: { directory: output, formats: ["json", "sarif", "html"] },
      });
      const project = JSON.parse(await fs.readFile(path.join(output, "project.json"), "utf8"));
      const report = JSON.parse(await fs.readFile(path.join(output, "report.json"), "utf8"));
      const sarif = JSON.parse(await fs.readFile(path.join(output, "results.sarif"), "utf8"));
      const html = await fs.readFile(path.join(output, "report.html"), "utf8");
      const ui = JSON.parse(await fs.readFile(path.join(output, "ui-data.json"), "utf8"));
      expect(project.project.root).toBe(".");
      expect(report.findings[0].fingerprint).toHaveLength(64);
      expect(sarif.version).toBe("2.1.0");
      expect(ui.schemaVersion).toBe(1);
      expect(ui.graphs.remotes).toBeTruthy();
      expect(html).toContain("Content-Security-Policy");
      expect(html.includes('id="report-data"') || html.includes("__MF_DOCTOR_UI__")).toBe(true);
      expect(html).not.toMatch(/<(?:img|script)[^>]+src=["']https?:/);
      expect(result.exitCode).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
