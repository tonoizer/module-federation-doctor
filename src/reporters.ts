import fs from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { writeFileAtomic as writeFileAtomicBase } from "./atomic-write.js";
import { policyFails } from "./baseline.js";
import { resolvePrintLog, resolveQuiet, resolvePrompt } from "./config.js";
import { formatTopAgentPrompts } from "./agent-prompt.js";
import { doctorRuleDocUrl } from "./docs-url.js";
import { ruleGuidance } from "./rule-guidance.js";
import type {
  DoctorFinding,
  DoctorPrintLog,
  DoctorReport,
  OutputFormat,
  ProjectFacts,
} from "./types.js";
import { stableStringify } from "./utils.js";

/** Atomically replace a report artifact; previous contents stay if the write fails. */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await writeFileAtomicBase(filePath, contents, {
    errorMessage: (resolved) => `Unable to atomically write report file: ${resolved}`,
  });
}

/** Hosts allowed when printing official Module Federation source links. */
const OFFICIAL_SOURCE_HOSTS = new Set(["module-federation.io", "www.module-federation.io"]);

export interface TerminalReportOptions {
  /** When true (default), omit output on complete successful zero findings. */
  quiet?: boolean;
  printLog?: DoctorPrintLog;
  /**
   * When false, omit the health score footer.
   * Defaults to true when omitted.
   */
  score?: boolean;
  /**
   * When false, omit top-N agent prompts after the score footer.
   * Defaults to true locally and false in CI when omitted.
   * Skipped automatically for quiet empty success.
   */
  prompt?: boolean;
  /** Effective policy used for the current analysis and exit-code decision. */
  policy?: {
    failOn: "never" | "warning" | "error";
    failOnSuppressed?: boolean;
  };
}

/** Destination controls for report artifacts and stdout JSON. */
export interface ReportDestinationOptions extends TerminalReportOptions {
  /**
   * When false, skip writing report artifacts to disk.
   * Defaults to true.
   */
  write?: boolean;
  /**
   * When true, emit the JSON report on stdout.
   * Terminal findings move to stderr so stdout stays pipe-clean.
   * Agent prompts are omitted from that stdout stream.
   */
  stdoutJson?: boolean;
}

function emitStdoutJson(formats: OutputFormat[], options: ReportDestinationOptions): boolean {
  if (options.stdoutJson) return true;
  return options.write === false && formats.includes("json");
}

function writeJsonFile(formats: OutputFormat[], options: ReportDestinationOptions): boolean {
  if (!formats.includes("json")) return false;
  if (options.write === false) return false;
  // `--output -` replaces the report.json destination with stdout.
  if (options.stdoutJson) return false;
  return true;
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

interface TerminalAnalysisStatus {
  incomplete: boolean;
  known: boolean;
  reasons: string[];
}

function terminalAnalysisStatus(report: DoctorReport): TerminalAnalysisStatus {
  const partialFinding = report.findings.some(
    (finding) => finding.ruleId === "doctor/partial-analysis" && !finding.suppressed,
  );
  if (report.status) {
    const reasons: string[] = [...report.status.incompleteReasons];
    if (partialFinding && reasons.length === 0) reasons.push("doctor/partial-analysis");
    return {
      incomplete: !report.status.complete || reasons.length > 0 || partialFinding,
      known: true,
      reasons,
    };
  }
  if (partialFinding)
    return { incomplete: true, known: true, reasons: ["doctor/partial-analysis"] };
  return { incomplete: false, known: false, reasons: [] };
}

function hasBlockingError(report: DoctorReport): boolean {
  return report.findings.some((finding) => finding.severity === "error" && !finding.suppressed);
}

function formatFindingSummary(report: DoctorReport): string {
  const suppressed =
    report.summary.suppressed && report.summary.suppressed > 0
      ? `, ${report.summary.suppressed} suppressed`
      : "";
  return `${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info${suppressed}`;
}

function formatPolicyResult(policyFailed: boolean): string {
  return policyFailed ? pc.red("Policy: failed") : pc.green("Policy: passed");
}

function formatAnalysisStatus(status: TerminalAnalysisStatus): string {
  if (!status.known) return pc.dim("Analysis: status unavailable (legacy report)");
  if (!status.incomplete) return pc.green("Analysis: complete");
  const reasons = status.reasons.length > 0 ? ` (${status.reasons.join(", ")})` : "";
  return pc.yellow(`Analysis: incomplete${reasons}`);
}

function formatNextAction(
  report: DoctorReport,
  status: TerminalAnalysisStatus,
  policyFailed: boolean,
): string {
  if (policyFailed && status.incomplete)
    return "Next action: Fix the policy errors, then rebuild with the mfdoctor adapter and rerun the check.";
  if (policyFailed) return "Next action: Fix the policy errors, then rerun the check.";
  if (status.incomplete)
    return "Next action: Rebuild with the mfdoctor adapter and rerun the check to complete analysis.";
  if (report.summary.warnings > 0)
    return "Next action: Review the warnings and rerun the check after making any changes.";
  return "Next action: No action required.";
}

function formatScoreFooter(
  report: DoctorReport,
  status: TerminalAnalysisStatus,
): string | undefined {
  if (status.incomplete)
    return pc.dim(
      report.summary.score === null || report.summary.score === undefined
        ? "Score: n/a (partial analysis)"
        : "Score: n/a (analysis incomplete)",
    );

  const { score, scoreLabel } = report.summary;
  if (score === undefined || score === null || !scoreLabel) return undefined;
  const displayLabel =
    hasBlockingError(report) && scoreLabel === "Great" ? "Needs work" : scoreLabel;
  const text = `Score: ${score}/100 (${displayLabel})`;
  if (displayLabel === "Great") return pc.green(text);
  if (displayLabel === "OK") return pc.yellow(text);
  return pc.red(text);
}

function formatLocation(finding: DoctorFinding): string {
  const location = finding.location;
  if (!location) return "";
  if (location.line === undefined) return location.path;
  return `${location.path}:${location.line}${
    location.column === undefined ? "" : `:${location.column}`
  }`;
}

/**
 * Format the single end-of-build mfdoctor findings block for humans and agents.
 * Returns an empty string when quiet success applies to complete zero findings.
 */
export function formatTerminalReport(
  report: DoctorReport,
  options: TerminalReportOptions = {},
): string {
  const quiet = resolveQuiet(options);
  const printLog = resolvePrintLog(options);
  const showScore = options.score !== false;
  const status = terminalAnalysisStatus(report);
  const policyFailed = policyFails(
    report.findings,
    options.policy?.failOn ?? "error",
    options.policy?.failOnSuppressed ?? false,
  );
  if (report.findings.length === 0) {
    if (!status.incomplete && (quiet || !printLog.success)) return "";
    const lines = [
      pc.bold("mfdoctor"),
      formatPolicyResult(policyFailed),
      formatAnalysisStatus(status),
      formatNextAction(report, status, policyFailed),
      formatFindingSummary(report),
    ];
    if (showScore) {
      const footer = formatScoreFooter(report, status);
      if (footer) lines.push(footer);
    }
    lines.push(pc.green("mfdoctor: no findings."));
    return lines.join("\n");
  }

  const lines: string[] = [
    pc.bold("mfdoctor"),
    formatPolicyResult(policyFailed),
    formatAnalysisStatus(status),
    formatNextAction(report, status, policyFailed),
    formatFindingSummary(report),
  ];
  if (showScore) {
    const footer = formatScoreFooter(report, status);
    if (footer) lines.push(footer);
  }
  lines.push("");

  let project = "";
  const emittedDetails = new Set<string>();
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
    const location = finding.location ? ` ${formatLocation(finding)}` : "";
    const suppressed = finding.suppressed ? pc.dim(" [suppressed]") : "";
    lines.push(`  ${icon} ${finding.ruleId}${location}${suppressed}`);
    lines.push(`    ${finding.message}`);
    const suggestion = suggestionFor(finding);
    const sources = officialSources(finding.ruleId);
    const detailKey = [
      finding.project,
      finding.ruleId,
      suggestion ?? "",
      doctorRuleDocUrl(finding),
      ...sources,
    ].join("\u0000");
    if (!emittedDetails.has(detailKey)) {
      if (suggestion) lines.push(`    fix: ${suggestion}`);
      lines.push(`    docs: ${doctorRuleDocUrl(finding)}`);
      for (const source of sources) {
        lines.push(`    source: ${source}`);
      }
      emittedDetails.add(detailKey);
    }
  }
  if (resolvePrompt(options)) {
    const prompts = formatTopAgentPrompts(report.findings);
    if (prompts) lines.push("", prompts);
  }
  return lines.join("\n");
}

function writeTerminal(
  report: DoctorReport,
  options: TerminalReportOptions = {},
  stream: NodeJS.WritableStream = process.stdout,
): void {
  const text = formatTerminalReport(report, options);
  if (text) stream.write(text + "\n");
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
        tool: { driver: { name: "mfdoctor", rules } },
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

async function writeReportFormats(
  report: DoctorReport,
  directory: string,
  formats: OutputFormat[],
  options: ReportDestinationOptions = {},
): Promise<void> {
  const write = options.write !== false;
  const jsonOnStdout = emitStdoutJson(formats, options);
  if (jsonOnStdout) process.stdout.write(stableStringify(report, 2) + "\n");
  if (writeJsonFile(formats, options))
    await writeFileAtomic(path.join(directory, "report.json"), stableStringify(report, 2) + "\n");
  if (write && formats.includes("sarif"))
    await writeFileAtomic(
      path.join(directory, "results.sarif"),
      stableStringify(sarif(report), 2) + "\n",
    );
  if (formats.includes("terminal")) {
    // Keep the JSON stdout stream free of agent prompts and terminal noise.
    writeTerminal(
      report,
      jsonOnStdout ? { ...options, prompt: false } : options,
      jsonOnStdout ? process.stderr : process.stdout,
    );
  }
}

export async function writeReports(
  facts: ProjectFacts,
  report: DoctorReport,
  directory: string,
  formats: OutputFormat[],
  options: ReportDestinationOptions = {},
): Promise<void> {
  const write = options.write !== false;
  if (write) {
    await fs.mkdir(directory, { recursive: true });
    const persistedFacts =
      facts.schemaVersion === 1
        ? (() => {
            const { canonicalConfig: _rootCanonicalConfig, analysis, ...legacyFacts } = facts;
            return {
              ...legacyFacts,
              ...(analysis && (analysis.status !== "complete" || analysis.exceeded.length > 0)
                ? { analysis }
                : {}),
              artifacts: { ...facts.artifacts, records: undefined },
              ...(facts.federationInstances
                ? {
                    federationInstances: facts.federationInstances.map((instance) => {
                      const { canonicalConfig: _instanceCanonicalConfig, ...persistedInstance } =
                        instance;
                      return {
                        ...persistedInstance,
                        artifacts: { ...instance.artifacts, records: undefined },
                      };
                    }),
                  }
                : {}),
            };
          })()
        : facts;
    await writeFileAtomic(
      path.join(directory, "project.json"),
      stableStringify(persistedFacts, 2) + "\n",
    );
  }
  await writeReportFormats(report, directory, formats, options);
}

export async function writeFederationReports(
  report: DoctorReport,
  directory: string,
  formats: OutputFormat[],
  options: ReportDestinationOptions = {},
): Promise<void> {
  if (options.write !== false) await fs.mkdir(directory, { recursive: true });
  await writeReportFormats(report, directory, formats, options);
}
