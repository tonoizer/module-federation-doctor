import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, parseArgs } from "../../src/cli.js";

const roots: string[] = [];

async function temporaryProject(config: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-cli-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"cli-test"}');
  await fs.writeFile(path.join(root, "mfdoctor.config.ts"), config);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("CLI arguments", () => {
  it("parses check flags over config", () => {
    expect(parseArgs(["check", "app", "--ci", "--format", "terminal,json,sarif"])).toEqual({
      command: "check",
      root: "app",
      patterns: [],
      ci: true,
      formats: ["terminal", "json", "sarif"],
      ui: false,
    });
  });

  it("parses federation globs", () => {
    expect(parseArgs(["federation", ".mf/doctor/**/project.json"])).toEqual({
      command: "federation",
      patterns: [".mf/doctor/**/project.json"],
      ci: false,
      ui: false,
    });
  });

  it("parses --ui and --ui-port for check and federation", () => {
    expect(parseArgs(["check", "--ui", "--ui-port", "51205"])).toEqual({
      command: "check",
      patterns: [],
      ci: false,
      ui: true,
      uiPort: 51205,
    });
    expect(parseArgs(["federation", "a.json", "--ui"])).toEqual({
      command: "federation",
      patterns: ["a.json"],
      ci: false,
      ui: true,
    });
    expect(() => parseArgs(["probe", "https://example.com/mf-manifest.json", "--ui"])).toThrow(
      "--ui is only supported",
    );
  });

  it("parses probe safety flags and rejects unknown report formats", () => {
    expect(
      parseArgs([
        "probe",
        "https://example.com/mf-manifest.json",
        "--timeout",
        "5000",
        "--max-bytes",
        "100000",
        "--remote-entry",
      ]),
    ).toEqual({
      command: "probe",
      url: "https://example.com/mf-manifest.json",
      patterns: [],
      ci: false,
      timeoutMs: 5000,
      maxBytes: 100000,
      remoteEntry: true,
      ui: false,
    });
    expect(() => parseArgs(["check", "--format", "xml"])).toThrow("Unknown output format");
    expect(parseArgs(["rules", "config/name-required"])).toEqual({
      command: "rules",
      ruleId: "config/name-required",
      patterns: [],
      ci: false,
      ui: false,
    });
  });

  it("loads a TypeScript config and returns exit 0 for a clean check", async () => {
    const root = await temporaryProject(
      'export default { output: { formats: [] }, rules: { "doctor/partial-analysis": "off" } };',
    );
    await expect(main(["check", root])).resolves.toBe(0);
  });

  it("falls back to the official module-federation config file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-cli-mf-config-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"cli-mf-config-test"}');
    await fs.writeFile(
      path.join(root, "module-federation.config.ts"),
      'export default { name: "", manifest: true };',
    );
    await expect(main(["check", root, "--ci", "--format", "json"])).resolves.toBe(1);
  });

  it("returns exit 1 for findings that meet CI policy", async () => {
    const root = await temporaryProject(
      'export default { moduleFederation: { name: "" }, output: { formats: [] }, rules: { "doctor/partial-analysis": "off", "config/plugin-package-mismatch": "off" } };',
    );
    await expect(main(["check", root, "--ci"])).resolves.toBe(1);
  });

  it("returns exit 2 for invalid config", async () => {
    const root = await temporaryProject("export default { this is not valid");
    await expect(main(["check", root])).resolves.toBe(2);
  });

  it("writes html when --ui is set without holding the server", async () => {
    const root = await temporaryProject(
      'export default { output: { formats: ["json"] }, rules: { "doctor/partial-analysis": "off" } };',
    );
    const previous = process.env.MFDOCTOR_UI_NO_HOLD;
    process.env.MFDOCTOR_UI_NO_HOLD = "1";
    try {
      await expect(main(["check", root, "--ui", "--format", "json"])).resolves.toBe(0);
      const html = await fs.readFile(path.join(root, ".mf/doctor/report.html"), "utf8");
      const ui = JSON.parse(await fs.readFile(path.join(root, ".mf/doctor/ui-data.json"), "utf8"));
      expect(html).toContain("Module Federation Doctor");
      expect(ui.graphs).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.MFDOCTOR_UI_NO_HOLD;
      else process.env.MFDOCTOR_UI_NO_HOLD = previous;
    }
  });

  it("lists rule guidance and rejects an unknown rule", async () => {
    await expect(main(["rules", "config/name-required"])).resolves.toBe(0);
    await expect(main(["rules", "not/a-rule"])).resolves.toBe(2);
  });
});
