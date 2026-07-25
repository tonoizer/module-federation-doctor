import fs from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import type { DoctorReport, OutputFormat, ProjectFacts } from "./types.js";
import { stableStringify } from "./utils.js";

function terminal(report: DoctorReport): string {
  if (report.findings.length === 0) return pc.green("Module Federation Doctor: no findings.");
  const lines: string[] = [];
  let project = "";
  for (const finding of report.findings) {
    if (finding.project !== project) {
      project = finding.project;
      lines.push(pc.bold(`\n${project}`));
    }
    const icon =
      finding.severity === "error"
        ? pc.red("error")
        : finding.severity === "warning"
          ? pc.yellow("warning")
          : pc.blue("info");
    const location = finding.location ? ` ${finding.location.path}` : "";
    const suppressed = finding.suppressed ? pc.dim(" [suppressed]") : "";
    lines.push(`  ${icon} ${finding.ruleId}${location}${suppressed}\n    ${finding.message}`);
  }
  const suppressed =
    report.summary.suppressed && report.summary.suppressed > 0
      ? `, ${report.summary.suppressed} suppressed`
      : "";
  lines.push(
    `\n${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info${suppressed}`,
  );
  return lines.join("\n");
}

function sarif(report: DoctorReport): Record<string, unknown> {
  const rules = [...new Set(report.findings.map((item) => item.ruleId))].sort().map((id) => ({
    id,
    helpUri: `https://github.com/tonoizer/module-federation-doctor/blob/main/apps/docs/docs/rules/${id}.md`,
  }));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: { driver: { name: "Module Federation Doctor", rules } },
        results: report.findings.map((finding) => ({
          ruleId: finding.ruleId,
          level:
            finding.severity === "warning"
              ? "warning"
              : finding.severity === "error"
                ? "error"
                : "note",
          message: { text: finding.message },
          partialFingerprints: { primaryLocationLineHash: finding.fingerprint },
          ...(finding.suppressed
            ? {
                suppressions: [
                  {
                    kind: "external",
                    justification:
                      finding.suppressionReason ?? "Matched checked-in fingerprint baseline",
                  },
                ],
              }
            : {}),
          ...(finding.location
            ? {
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: finding.location.path },
                      region: {
                        ...(finding.location.line ? { startLine: finding.location.line } : {}),
                        ...(finding.location.column
                          ? { startColumn: finding.location.column }
                          : {}),
                      },
                    },
                  },
                ],
              }
            : {}),
        })),
      },
    ],
  };
}

export async function writeReports(
  facts: ProjectFacts,
  report: DoctorReport,
  directory: string,
  formats: OutputFormat[],
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "project.json"), stableStringify(facts, 2) + "\n");
  if (formats.includes("json"))
    await fs.writeFile(path.join(directory, "report.json"), stableStringify(report, 2) + "\n");
  if (formats.includes("sarif"))
    await fs.writeFile(
      path.join(directory, "results.sarif"),
      stableStringify(sarif(report), 2) + "\n",
    );
  if (formats.includes("terminal")) process.stdout.write(terminal(report) + "\n");
}

export async function writeFederationReports(
  _projects: ProjectFacts[],
  report: DoctorReport,
  directory: string,
  formats: OutputFormat[],
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  if (formats.includes("json"))
    await fs.writeFile(path.join(directory, "report.json"), stableStringify(report, 2) + "\n");
  if (formats.includes("sarif"))
    await fs.writeFile(
      path.join(directory, "results.sarif"),
      stableStringify(sarif(report), 2) + "\n",
    );
  if (formats.includes("terminal")) process.stdout.write(terminal(report) + "\n");
}
