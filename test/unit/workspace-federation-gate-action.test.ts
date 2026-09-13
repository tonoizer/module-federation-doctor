import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const actionDir = ".github/actions/workspace-federation-gate";
const ensureCli = path.join(actionDir, "ensure-cli.sh");
const requireSarif = path.join(actionDir, "require-sarif-upload.sh");
const reportStatus = path.join(actionDir, "report-status.sh");

function runScript(
  script: string,
  env: NodeJS.ProcessEnv,
  cwd?: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", [script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("workspace-federation-gate action", () => {
  it("wires ensure-cli, optional install, and loud SARIF failure", async () => {
    const action = await readFile(path.join(actionDir, "action.yml"), "utf8");

    expect(action).toContain("Ensure mfdoctor CLI");
    expect(action).toContain("ensure-cli.sh");
    expect(action).toContain("install:");
    expect(action).toContain("package-spec:");
    expect(action).toContain('default: "@tonoizer/mfdoctor"');
    expect(action).toContain("Require successful SARIF upload");
    expect(action).toContain("require-sarif-upload.sh");
    expect(action).toContain("id: upload-sarif");
    expect(action).toContain("continue-on-error: true");
    expect(action).toContain("MFDOCTOR_SARIF_OUTCOME: ${{ steps.upload-sarif.outcome }}");
    expect(action).toContain("require-complete:");
    expect(action).toContain("--require-complete");
    expect(action).toContain("policy-result:");
    expect(action).toContain("incomplete-reasons:");
    expect(action).toContain("report-status.sh");
  });

  it("docs pin the Action to a release tag, not @main", async () => {
    const docs = [
      "apps/docs/docs/cli.md",
      "apps/docs/locales/de/cli.md",
      "apps/docs/versions/1.0.0/en/cli.md",
      "apps/docs/versions/1.0.0/de/cli.md",
    ];
    for (const file of docs) {
      const content = await readFile(file, "utf8");
      expect(content, file).not.toMatch(/workspace-federation-gate@main\b/);
      expect(content, file).toMatch(/workspace-federation-gate@(?:v)?\d+\.\d+\.\d+/);
    }
  });

  it("ensure-cli.sh hard-fails when the CLI is missing", async () => {
    const result = runScript(ensureCli, {
      MFDOCTOR_CLI: "mfdoctor-definitely-missing-316",
      MFDOCTOR_INSTALL: "false",
    });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("mfdoctor CLI missing");
    expect(result.stdout + result.stderr).toContain("install: true");
  });

  it("ensure-cli.sh accepts a runnable multi-token CLI", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mfdoctor-gate-cli-"));
    try {
      const stub = path.join(dir, "stub-mfdoctor");
      await writeFile(stub, "#!/usr/bin/env bash\nexit 0\n");
      await chmod(stub, 0o755);
      const result = runScript(ensureCli, {
        MFDOCTOR_CLI: `bash ${stub}`,
        MFDOCTOR_INSTALL: "false",
      });
      expect(result.status).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("require-sarif-upload.sh fails loudly on upload failure", () => {
    const failure = runScript(requireSarif, {
      MFDOCTOR_UPLOAD_SARIF: "true",
      MFDOCTOR_SARIF_OUTCOME: "failure",
    });
    expect(failure.status).toBe(1);
    expect(failure.stdout + failure.stderr).toContain("security-events: write");
    expect(failure.stdout + failure.stderr).toContain('upload-sarif: "false"');

    const success = runScript(requireSarif, {
      MFDOCTOR_UPLOAD_SARIF: "true",
      MFDOCTOR_SARIF_OUTCOME: "success",
    });
    expect(success.status).toBe(0);

    const skipped = runScript(requireSarif, {
      MFDOCTOR_UPLOAD_SARIF: "true",
      MFDOCTOR_SARIF_OUTCOME: "skipped",
    });
    expect(skipped.status).toBe(0);

    const disabled = runScript(requireSarif, {
      MFDOCTOR_UPLOAD_SARIF: "false",
      MFDOCTOR_SARIF_OUTCOME: "failure",
    });
    expect(disabled.status).toBe(0);
  });

  it("reports policy and completeness independently, with strict opt-in", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mfdoctor-gate-status-"));
    try {
      const report = path.join(dir, "report.json");
      const output = path.join(dir, "github-output");
      const incomplete = {
        schemaVersion: 1,
        capabilities: { emittedAssets: false },
        status: { complete: false, incompleteReasons: ["missing-emit"] },
        summary: { projects: 1 },
        findings: [],
      };
      await writeFile(report, JSON.stringify(incomplete));

      const legacy = runScript(reportStatus, {
        MFDOCTOR_REPORT_JSON: report,
        MFDOCTOR_REQUIRE_COMPLETE: "false",
        GITHUB_OUTPUT: output,
      });
      expect(legacy.status).toBe(0);
      expect(await readFile(output, "utf8")).toContain("policy-result=pass");
      expect(await readFile(output, "utf8")).toContain("completeness=incomplete");
      expect(await readFile(output, "utf8")).toContain("incomplete-reasons=missing-emit");

      const strict = runScript(reportStatus, {
        MFDOCTOR_REPORT_JSON: report,
        MFDOCTOR_REQUIRE_COMPLETE: "true",
        GITHUB_OUTPUT: "",
      });
      expect(strict.status).toBe(1);
      expect(strict.stdout).toContain("complete=false");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not turn a policy failure into a completeness failure", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mfdoctor-gate-status-complete-"));
    try {
      const report = path.join(dir, "report.json");
      await writeFile(
        report,
        JSON.stringify({
          schemaVersion: 1,
          capabilities: { emittedAssets: true },
          status: { complete: true, incompleteReasons: [] },
          summary: { projects: 1 },
          findings: [{ severity: "error", suppressed: false }],
        }),
      );
      const result = runScript(reportStatus, {
        MFDOCTOR_REPORT_JSON: report,
        MFDOCTOR_REQUIRE_COMPLETE: "true",
        GITHUB_OUTPUT: "",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("policy-result=fail");
      expect(result.stdout).toContain("completeness=complete");
      expect(result.stdout).toContain("complete=true");
      expect(result.stdout).toContain("incomplete-reasons=\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats unknown report reason codes as invalid without writing arbitrary output", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mfdoctor-gate-status-invalid-"));
    try {
      const report = path.join(dir, "report.json");
      const output = path.join(dir, "github-output");
      await writeFile(
        report,
        JSON.stringify({
          capabilities: { emittedAssets: true },
          status: { complete: false, incompleteReasons: ["bad\nINJECTED=yes"] },
          summary: { projects: 1 },
          findings: [],
        }),
      );
      const result = runScript(reportStatus, {
        MFDOCTOR_REPORT_JSON: report,
        MFDOCTOR_REQUIRE_COMPLETE: "true",
        GITHUB_OUTPUT: output,
      });
      const contents = await readFile(output, "utf8");
      expect(result.status).toBe(1);
      expect(contents).toContain("incomplete-reasons=invalid-status");
      expect(contents).not.toContain("INJECTED=yes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
