import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parseArgs } from "../../src/cli.js";
import { CI_PROVIDER_ENV_KEYS } from "../../src/config.js";
import reportFixture from "../../examples/evidence/v1-report.json";
import v2ConflictFixture from "../../examples/evidence/v2-conflict.json";
import { migrateDoctorReport } from "../../src/evidence-reader.js";

const roots: string[] = [];

async function temporaryProject(config: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-cli-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"cli-test"}');
  await fs.writeFile(path.join(root, "mfdoctor.config.ts"), config);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function captureStdout(run: () => Promise<number>): Promise<{ code: number; text: string }> {
  const chunks: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await run();
    return { code, text: chunks.join("") };
  } finally {
    process.stdout.write = write;
  }
}

function stubLocalEnv(): void {
  vi.stubEnv("CI", "");
  for (const key of CI_PROVIDER_ENV_KEYS) vi.stubEnv(key, "");
}

describe("CLI arguments", () => {
  it("parses --verbose for quiet-success opt-out", () => {
    expect(parseArgs(["check", "--verbose"])).toEqual({
      command: "check",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: true,
      score: true,
      prompt: true,
      forcePrompt: false,
    });
  });

  it("parses --no-score to hide the terminal health score", () => {
    expect(parseArgs(["check", "--no-score"])).toEqual({
      command: "check",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: false,
      prompt: true,
      forcePrompt: false,
    });
  });

  it("parses --no-prompt and --prompt / --finding / --diagnostics-dir", () => {
    expect(parseArgs(["check", "--no-prompt"])).toEqual({
      command: "check",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: false,
      forcePrompt: false,
    });
    expect(parseArgs(["check", "--prompt", "--no-prompt"])).toEqual({
      command: "check",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: false,
      forcePrompt: false,
    });
    expect(parseArgs(["check", "--prompt", "--diagnostics-dir", ".mf/doctor/diagnostics"])).toEqual(
      {
        command: "check",
        patterns: [],
        roots: [],
        globs: [],
        urls: [],
        workspace: false,
        ci: false,
        verbose: false,
        score: true,
        prompt: true,
        forcePrompt: true,
        diagnosticsDir: ".mf/doctor/diagnostics",
      },
    );
    expect(
      parseArgs([
        "check",
        "--diagnostics-dir",
        ".mf/doctor/diagnostics",
        "--diagnostics-prompts",
        "10",
      ]),
    ).toEqual({
      command: "check",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
      diagnosticsDir: ".mf/doctor/diagnostics",
      diagnosticsPromptLimit: 10,
    });
    expect(() => parseArgs(["check", "--diagnostics-prompts", "99"])).toThrow(/dump budget of 25/);
    expect(
      parseArgs(["prompt", "--finding", "config/name-required", ".mf/doctor/report.json"]),
    ).toEqual({
      command: "prompt",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
      finding: "config/name-required",
      reportPath: ".mf/doctor/report.json",
    });
  });

  it("parses check flags over config", () => {
    expect(parseArgs(["check", "app", "--ci", "--format", "terminal,json,sarif"])).toEqual({
      command: "check",
      root: "app",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: true,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
      formats: ["terminal", "json", "sarif"],
    });
  });

  it("parses baseline flags and subcommands", () => {
    expect(parseArgs(["check", "--baseline", "./mfdoctor.baseline.json"])).toEqual({
      command: "check",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
      baseline: "./mfdoctor.baseline.json",
    });
    expect(
      parseArgs([
        "baseline",
        "generate",
        ".mf/doctor/report.json",
        "--out",
        "mfdoctor.baseline.json",
      ]),
    ).toEqual({
      command: "baseline",
      baselineAction: "generate",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
      reportPath: ".mf/doctor/report.json",
      outPath: "mfdoctor.baseline.json",
    });
    expect(() => parseArgs(["baseline"])).toThrow("baseline needs a subcommand");
  });

  it("parses federation globs", () => {
    expect(parseArgs(["federation", ".mf/doctor/**/project.json"])).toEqual({
      command: "federation",
      patterns: [".mf/doctor/**/project.json"],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
    });
  });

  it("parses workspace auto-discovery and federation --workspace", () => {
    expect(parseArgs(["workspace", "apps", "packages"])).toEqual({
      command: "workspace",
      patterns: [],
      roots: ["apps", "packages"],
      globs: [],
      urls: [],
      workspace: true,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
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
      urls: [],
      workspace: true,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
      formats: ["json", "sarif"],
    });
    expect(parseArgs(["federation", "apps", "--workspace"])).toEqual({
      command: "federation",
      patterns: [],
      roots: ["apps"],
      globs: [],
      urls: [],
      workspace: true,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
    });
  });

  it("parses an explicit federation group", () => {
    expect(parseArgs(["federation", "--workspace", "apps", "--group", "checkout"])).toEqual({
      command: "federation",
      patterns: [],
      roots: ["apps"],
      globs: [],
      urls: [],
      group: "checkout",
      workspace: true,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
    });
    expect(() => parseArgs(["federation", "--workspace", "--group"])).toThrow(
      "--group needs a group name",
    );
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
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
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
      urls: ["https://example.com/mf-manifest.json"],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
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
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
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

  it("writes a federation report when workspace discovery only has diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-cli-workspace-diagnostic-"));
    roots.push(root);
    const file = path.join(root, "apps", "broken", ".mf", "doctor", "project.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      '{"project":{"name":"broken","federationGroup":"selected"},"padding":"' +
        "x".repeat(20 * 1024),
    );

    const previous = process.cwd();
    process.chdir(root);
    try {
      await expect(
        main(["workspace", ".", "--group", "selected", "--format", "json"]),
      ).resolves.toBe(2);
    } finally {
      process.chdir(previous);
    }

    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf", "doctor", "report.json"), "utf8"),
    ) as { findings: Array<{ ruleId?: string; details?: { workspaceDiagnostics?: unknown[] } }> };
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "doctor/partial-analysis",
        details: expect.objectContaining({
          workspaceDiagnostics: expect.arrayContaining([
            expect.objectContaining({ kind: "invalid" }),
          ]),
        }),
      }),
    );
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

  it("generates a baseline and lets CI check pass when baselined", async () => {
    const root = await temporaryProject(
      'export default { moduleFederation: { name: "" }, output: { formats: ["json"] }, rules: { "doctor/partial-analysis": "off", "config/plugin-package-mismatch": "off" } };',
    );
    await expect(main(["check", root, "--ci"])).resolves.toBe(1);
    const reportPath = path.join(root, ".mf/doctor/report.json");
    const baselinePath = path.join(root, "mfdoctor.baseline.json");
    const cwd = process.cwd();
    process.chdir(root);
    try {
      await expect(main(["baseline", "generate", reportPath, "--out", baselinePath])).resolves.toBe(
        0,
      );
    } finally {
      process.chdir(cwd);
    }
    await expect(main(["check", root, "--ci", "--baseline", baselinePath])).resolves.toBe(0);
  });

  it("refuses baseline update when an existing file is corrupt", async () => {
    const root = await temporaryProject(
      'export default { output: { formats: ["json"] }, rules: { "doctor/partial-analysis": "off" } };',
    );
    await expect(main(["check", root])).resolves.toBe(0);
    const reportPath = path.join(root, ".mf/doctor/report.json");
    const baselinePath = path.join(root, "mfdoctor.baseline.json");
    await fs.writeFile(baselinePath, "{ not valid json");
    const cwd = process.cwd();
    process.chdir(root);
    try {
      await expect(main(["baseline", "update", reportPath, "--out", baselinePath])).resolves.toBe(
        2,
      );
      await expect(fs.readFile(baselinePath, "utf8")).resolves.toBe("{ not valid json");
    } finally {
      process.chdir(cwd);
    }
  });

  it("imports v1 and v2 report documents with identical baseline output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-report-import-"));
    roots.push(root);
    const v1Path = path.join(root, "v1-report.json");
    const v2Path = path.join(root, "v2-report.json");
    const v1Baseline = path.join(root, "v1-baseline.json");
    const v2Baseline = path.join(root, "v2-baseline.json");
    await fs.writeFile(v1Path, JSON.stringify(reportFixture));
    await fs.writeFile(v2Path, JSON.stringify(migrateDoctorReport(reportFixture as never)));

    const cwd = process.cwd();
    process.chdir(root);
    try {
      await expect(main(["baseline", "generate", v1Path, "--out", v1Baseline])).resolves.toBe(0);
      await expect(main(["baseline", "generate", v2Path, "--out", v2Baseline])).resolves.toBe(0);
      expect(JSON.parse(await fs.readFile(v2Baseline, "utf8"))).toEqual(
        JSON.parse(await fs.readFile(v1Baseline, "utf8")),
      );
    } finally {
      process.chdir(cwd);
    }
  });

  it("projects a real v2 evaluation graph into a v1 baseline report", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-v2-graph-import-"));
    roots.push(root);
    const reportPath = path.join(root, "v2-conflict.json");
    const baselinePath = path.join(root, "baseline.json");
    await fs.writeFile(reportPath, JSON.stringify(v2ConflictFixture));

    await expect(main(["baseline", "generate", reportPath, "--out", baselinePath])).resolves.toBe(
      0,
    );
    expect(JSON.parse(await fs.readFile(baselinePath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      entries: [
        {
          ruleId: "shared/version-conflict",
          project: "checkout",
        },
      ],
    });
  });

  it.each([
    ["malformed", "{ not valid json", "/"],
    ["future version", JSON.stringify({ schemaVersion: 2, findings: [] }), "/schemaVersion"],
    ["wrong kind", JSON.stringify({ schemaVersion: 1, project: {} }), "/"],
  ])(
    "rejects %s report imports with file and pointer details",
    async (_name, contents, pointer) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-report-reject-"));
      roots.push(root);
      const reportPath = path.join(root, "input.json");
      await fs.writeFile(reportPath, contents);
      const errors: string[] = [];
      const write = process.stderr.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        errors.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      try {
        await expect(main(["baseline", "generate", reportPath])).resolves.toBe(2);
      } finally {
        process.stderr.write = write;
      }
      expect(errors.join("")).toContain(reportPath);
      expect(errors.join("")).toContain(pointer);
    },
  );

  it("returns exit 2 for invalid config", async () => {
    const root = await temporaryProject("export default { this is not valid");
    await expect(main(["check", root])).resolves.toBe(2);
  });

  it("lists rule guidance and rejects an unknown rule", async () => {
    await expect(main(["rules", "config/name-required"])).resolves.toBe(0);
    await expect(main(["rules", "not/a-rule"])).resolves.toBe(2);
  });

  it("prints the versioned machine-readable CLI capabilities contract", async () => {
    expect(parseArgs(["capabilities"])).toEqual({
      command: "capabilities",
      patterns: [],
      roots: [],
      globs: [],
      urls: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
    });
    const chunks: string[] = [];
    const write = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await expect(main(["capabilities", "--format", "json"])).resolves.toBe(0);
    } finally {
      process.stdout.write = write;
    }
    const capabilities = JSON.parse(chunks.join("")) as {
      schemaVersion: number;
      package: { name: string; version: string };
      commands: Record<string, unknown>;
      formats: string[];
      exitCodes: Record<string, string>;
      nonInteractive: { commands: Record<string, string> };
      schemas: Record<string, string>;
      nonGoals: string[];
      completeness: Record<string, string>;
      githubAction: { name: string; uses: string; pinToTag: string };
      networkPolicy: { offlineByDefault: boolean; networkCommands: string[] };
      bundlerMatrix: {
        source: string;
        supported: string[];
        partial: string[];
      };
    };
    expect(capabilities.schemaVersion).toBe(1);
    expect(capabilities.package.name).toBe("@tonoizer/mfdoctor");
    expect(capabilities.package.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(capabilities.commands).toHaveProperty("check");
    expect(capabilities.commands).toHaveProperty("capabilities");
    expect(capabilities.formats).toEqual(["terminal", "json", "sarif"]);
    expect(capabilities.exitCodes).toMatchObject({ "0": "success", "1": "policy-fail" });
    expect(capabilities.nonInteractive.commands.discover).toBe("mfdoctor capabilities");
    expect(capabilities.schemas.capabilities).toBe("./schemas/capabilities.schema.json");
    expect(capabilities.nonGoals.length).toBeGreaterThan(0);
    expect(capabilities.completeness).toHaveProperty("check");
    expect(capabilities.githubAction.name).toBe("workspace-federation-gate");
    expect(capabilities.networkPolicy.offlineByDefault).toBe(true);
    expect(capabilities.networkPolicy.networkCommands).toEqual(["compare", "probe"]);
    expect(capabilities.commands).toHaveProperty("compare");
    expect(capabilities.bundlerMatrix.source).toBe("./fixtures/compatibility-matrix.json");
    expect(capabilities.bundlerMatrix.supported).toContain("vite");
    expect(capabilities.bundlerMatrix.partial).toContain("modern");
  });

  it("hides agent prompts in CI by default and keeps them locally", async () => {
    const root = await temporaryProject(`export default {
      moduleFederation: { remotes: { app: "http://example.com/remoteEntry.js" }, exposes: {}, shared: {} },
      output: { formats: ["terminal"] },
      failOn: "never",
      rules: { "doctor/partial-analysis": "off", "config/name-required": "error" },
    };`);

    stubLocalEnv();
    vi.stubEnv("CI", "true");
    const ciDefault = await captureStdout(() => main(["check", root]));
    expect(ciDefault.code).toBe(0);
    expect(ciDefault.text).toContain("config/name-required");
    expect(ciDefault.text).not.toContain("Agent prompts");

    const ciOptIn = await captureStdout(() => main(["check", root, "--prompt"]));
    expect(ciOptIn.code).toBe(0);
    expect(ciOptIn.text).toContain("Agent prompts");

    stubLocalEnv();
    const localDefault = await captureStdout(() => main(["check", root]));
    expect(localDefault.code).toBe(0);
    expect(localDefault.text).toContain("Agent prompts");
  });

  it("prints offline agent prompts from report.json and dumps diagnostics", async () => {
    const root = await temporaryProject(`export default {
      moduleFederation: { remotes: { app: "http://example.com/remoteEntry.js" }, exposes: {}, shared: {} },
      output: { formats: ["json", "terminal"] },
      failOn: "never",
      rules: { "doctor/partial-analysis": "off", "config/name-required": "error" },
    };`);
    await expect(
      main(["check", root, "--diagnostics-dir", ".mf/doctor/diagnostics", "--no-prompt"]),
    ).resolves.toBe(0);
    const reportPath = path.join(root, ".mf/doctor/report.json");
    const dumpDir = path.join(root, ".mf/doctor/diagnostics");
    await expect(fs.access(path.join(dumpDir, "summary.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dumpDir, "report.json"))).resolves.toBeUndefined();
    const defaultPrompts = await fs.readdir(path.join(dumpDir, "prompts"));
    expect(defaultPrompts.length).toBeLessThanOrEqual(3);

    await expect(
      main([
        "check",
        root,
        "--diagnostics-dir",
        ".mf/doctor/diagnostics",
        "--diagnostics-prompts",
        "10",
        "--no-prompt",
      ]),
    ).resolves.toBe(0);
    const widerPrompts = await fs.readdir(path.join(dumpDir, "prompts"));
    expect(widerPrompts.length).toBeGreaterThanOrEqual(defaultPrompts.length);
    expect(widerPrompts.length).toBeLessThanOrEqual(10);

    const cwd = process.cwd();
    process.chdir(root);
    try {
      await expect(main(["prompt", "--finding", "config/name-required", reportPath])).resolves.toBe(
        0,
      );
      await expect(main(["prompt", reportPath])).resolves.toBe(0);
    } finally {
      process.chdir(cwd);
    }
  });
});
