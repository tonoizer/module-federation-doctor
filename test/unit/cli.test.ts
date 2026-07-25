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
      roots: [],
      globs: [],
      workspace: false,
      ci: true,
      formats: ["terminal", "json", "sarif"],
    });
  });

  it("parses federation globs", () => {
    expect(parseArgs(["federation", ".mf/doctor/**/project.json"])).toEqual({
      command: "federation",
      patterns: [".mf/doctor/**/project.json"],
      roots: [],
      globs: [],
      workspace: false,
      ci: false,
    });
  });

  it("parses workspace auto-discovery and federation --workspace", () => {
    expect(parseArgs(["workspace", "apps", "packages"])).toEqual({
      command: "workspace",
      patterns: [],
      roots: ["apps", "packages"],
      globs: [],
      workspace: true,
      ci: false,
    });
    expect(
      parseArgs([
        "federation",
        "--workspace",
        "examples/mixed-federation",
        "--glob",
        "**/.mf/doctor/project.json",
        "--format",
        "json,sarif",
      ]),
    ).toEqual({
      command: "federation",
      patterns: [],
      roots: ["examples/mixed-federation"],
      globs: ["**/.mf/doctor/project.json"],
      workspace: true,
      ci: false,
      formats: ["json", "sarif"],
    });
    expect(parseArgs(["federation", "apps", "--workspace"])).toEqual({
      command: "federation",
      patterns: [],
      roots: ["apps"],
      globs: [],
      workspace: true,
      ci: false,
    });
  });

  it("parses runtime trace and project globs", () => {
    expect(
      parseArgs([
        "runtime",
        "./trace.json",
        ".mf/doctor/**/project.json",
        "--format",
        "terminal,json",
      ]),
    ).toEqual({
      command: "runtime",
      trace: "./trace.json",
      patterns: [".mf/doctor/**/project.json"],
      roots: [],
      globs: [],
      workspace: false,
      ci: false,
      formats: ["terminal", "json"],
    });
  });

  it("rejects unknown options including retired --ui", () => {
    expect(() => parseArgs(["check", "--ui"])).toThrow("Unknown option: --ui");
    expect(() => parseArgs(["probe", "https://example.com/mf-manifest.json", "--ui"])).toThrow(
      "Unknown option: --ui",
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
      roots: [],
      globs: [],
      workspace: false,
      ci: false,
      timeoutMs: 5000,
      maxBytes: 100000,
      remoteEntry: true,
    });
    expect(() => parseArgs(["check", "--format", "xml"])).toThrow("Unknown output format");
    expect(() => parseArgs(["check", "--format", "html"])).toThrow("Unknown output format");
    expect(parseArgs(["rules", "config/name-required"])).toEqual({
      command: "rules",
      ruleId: "config/name-required",
      patterns: [],
      roots: [],
      globs: [],
      workspace: false,
      ci: false,
    });
  });

  it("runs the workspace federation gate with fixture exit codes", async () => {
    const repository = path.resolve(import.meta.dirname, "../..");
    const previous = process.cwd();
    process.chdir(repository);
    try {
      await expect(main(["workspace", "fixtures/workspaces/clean"])).resolves.toBe(0);
      await expect(
        main(["federation", "--workspace", "fixtures/workspaces/conflict"]),
      ).resolves.toBe(1);
      await expect(main(["workspace", "fixtures/manifests"])).resolves.toBe(2);
      await expect(
        main([
          "federation",
          "--workspace",
          "examples/showcase/federation/version-conflict",
          "--glob",
          "*.project.json",
        ]),
      ).resolves.toBe(1);
    } finally {
      process.chdir(previous);
    }
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

  it("lists rule guidance and rejects an unknown rule", async () => {
    await expect(main(["rules", "config/name-required"])).resolves.toBe(0);
    await expect(main(["rules", "not/a-rule"])).resolves.toBe(2);
  });
});
