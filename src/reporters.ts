import fs from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { resolvePrintLog, resolveQuiet } from "./config.js";
import { formatTopAgentPrompts } from "./agent-prompt.js";
import { ruleGuidance } from "./rule-guidance.js";
import type {
  DoctorFinding,
  DoctorPrintLog,
  DoctorReport,
  OutputFormat,
  ProjectFacts,
} from "./types.js";
import { stableStringify } from "./utils.js";

/** Published Doctor docs origin (Rspress site).
 * Matches the default SITE_ORIGIN in apps/docs/rspress.config.ts
 * (module-federation.github.io) until the package moves under the org. */
export const DOCTOR_DOCS_ORIGIN = "https://module-federation.github.io";

/** Hosts allowed when printing official Module Federation source links. */
const OFFICIAL_SOURCE_HOSTS = new Set(["module-federation.io", "www.module-federation.io"]);

export interface TerminalReportOptions {
  /** When true (default), omit output on zero findings. */
  quiet?: boolean;
  printLog?: DoctorPrintLog;
  /**
   * When false, omit the health score footer.
   * Defaults to true when omitted.
   */
  score?: boolean;
  /**
   * When false, omit top-N agent prompts after the score footer.
   * Defaults to true when omitted. Skipped automatically for quiet empty success.
   */
  prompt?: boolean;
}

function doctorRuleDocUrl(finding: DoctorFinding): string {
  const docPath = finding.documentation?.startsWith("/")
    ? finding.documentation
    : `/rules/${finding.ruleId}`;
  return `${DOCTOR_DOCS_ORIGIN}${docPath}`;
}

function isOfficialSourceUrl(urlString: string): boolean {
  try {
    return OFFICIAL_SOURCE_HOSTS.has(new URL(urlString).hostname);
  } catch {
    return false;
  }
}

function officialSources(ruleId: string): string[] {
  const sources = ruleGuidance[ruleId]?.sources ?? [];
  return sources.filter(isOfficialSourceUrl);
}

function suggestionFor(finding: DoctorFinding): string | undefined {
  if (finding.suggestion) return finding.suggestion;
  return ruleGuidance[finding.ruleId]?.fix;
}

function formatScoreFooter(report: DoctorReport): string | undefined {
  const { score, scoreLabel } = report.summary;
  if (score === undefined || score === null || !scoreLabel) return undefined;
  const text = `Score: ${score}/100 (${scoreLabel})`;
  if (score >= 75) return pc.green(text);
  if (score >= 50) return pc.yellow(text);
  return pc.red(text);
}

/**
 * Format the single end-of-build Doctor findings block for humans and agents.
 * Returns an empty string when quiet success applies (zero findings).
 */
export function formatTerminalReport(
  report: DoctorReport,
  options: TerminalReportOptions = {},
): string {
  const quiet = resolveQuiet(options);
  const printLog = resolvePrintLog(options);
  const showScore = options.score !== false;
  if (report.findings.length === 0) {
    if (quiet || !printLog.success) return "";
    const lines = [pc.green("Module Federation Doctor: no findings.")];
    if (showScore) {
      const footer = formatScoreFooter(report);
      if (footer) lines.push(footer);
    }
    return lines.join("\n");
  }

  const lines: string[] = [pc.bold("Module Federation Doctor")];
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
    lines.push(`  ${icon} ${finding.ruleId}${location}${suppressed}`);
    lines.push(`    ${finding.message}`);
    const suggestion = suggestionFor(finding);
    if (suggestion) lines.push(`    fix: ${suggestion}`);
    lines.push(`    docs: ${doctorRuleDocUrl(finding)}`);
    for (const source of officialSources(finding.ruleId)) {
      lines.push(`    source: ${source}`);
    }
  }
  const suppressed =
    report.summary.suppressed && report.summary.suppressed > 0
      ? `, ${report.summary.suppressed} suppressed`
      : "";
  lines.push(
    `\n${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info${suppressed}`,
  );
  if (showScore) {
    const footer = formatScoreFooter(report);
    if (footer) lines.push(footer);
    else if (report.summary.score === null) lines.push(pc.dim("Score: n/a (partial analysis)"));
  }
  if (options.prompt !== false) {
    const prompts = formatTopAgentPrompts(report.findings);
    if (prompts) lines.push("", prompts);
  }
  return lines.join("\n");
}

function writeTerminal(report: DoctorReport, options: TerminalReportOptions = {}): void {
  const text = formatTerminalReport(report, options);
  if (text) process.stdout.write(text + "\n");
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
  terminal: TerminalReportOptions = {},
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  const persistedFacts =
    facts.schemaVersion === 1
      ? (() => {
          const { analysis: _analysis, canonicalConfig: _canonicalConfig, ...legacyFacts } = facts;
          return { ...legacyFacts, artifacts: { ...facts.artifacts, records: undefined } };
        })()
      : facts;
  await fs.writeFile(
    path.join(directory, "project.json"),
    stableStringify(persistedFacts, 2) + "\n",
  );
  if (formats.includes("json"))
    await fs.writeFile(path.join(directory, "report.json"), stableStringify(report, 2) + "\n");
  if (formats.includes("sarif"))
    await fs.writeFile(
      path.join(directory, "results.sarif"),
      stableStringify(sarif(report), 2) + "\n",
    );
  if (formats.includes("terminal")) writeTerminal(report, terminal);
}

export async function writeFederationReports(
  _projects: ProjectFacts[],
  report: DoctorReport,
  directory: string,
  formats: OutputFormat[],
  terminal: TerminalReportOptions = {},
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  if (formats.includes("json"))
    await fs.writeFile(path.join(directory, "report.json"), stableStringify(report, 2) + "\n");
  if (formats.includes("sarif"))
    await fs.writeFile(
      path.join(directory, "results.sarif"),
      stableStringify(sarif(report), 2) + "\n",
    );
  if (formats.includes("terminal")) writeTerminal(report, terminal);
}
