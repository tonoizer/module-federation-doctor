import fs from "node:fs/promises";
import path from "node:path";
import { ruleGuidance, type RuleCategory } from "./rule-guidance.js";
import type { DoctorFinding, DoctorReport, Severity } from "./types.js";
import { stableStringify } from "./utils.js";

/** Same origin as reporters.DOCTOR_DOCS_ORIGIN (avoid circular import). */
const DOCTOR_DOCS_ORIGIN = "https://mfdoctor.kevinbeier.com";

const SEVERITY_RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };
const CATEGORY_RANK: Record<RuleCategory, number> = {
  correctness: 4,
  security: 4,
  reliability: 3,
  performance: 2,
  tooling: 1,
};

const MAX_EVIDENCE_KEYS = 8;
const MAX_EVIDENCE_VALUE_CHARS = 120;
const MAX_PROMPT_FINDINGS = 3;

export interface AgentPromptOptions {
  /** Override the verify command printed at the end. */
  verifyCommand?: string;
}

/**
 * Rank for top-N selection: severity first, then guidance category impact,
 * then fingerprint for stability. Higher is more urgent.
 */
export function findingPriority(finding: DoctorFinding): number {
  const severity = SEVERITY_RANK[finding.severity] ?? 0;
  const category = ruleGuidance[finding.ruleId]?.category;
  const impact = category ? (CATEGORY_RANK[category] ?? 0) : 0;
  return severity * 10 + impact;
}

/** Non-suppressed findings ordered for agent handoff (highest priority first). */
export function selectTopFindings(
  findings: DoctorFinding[],
  limit = MAX_PROMPT_FINDINGS,
): DoctorFinding[] {
  return [...findings]
    .filter((finding) => !finding.suppressed)
    .sort((left, right) => {
      const delta = findingPriority(right) - findingPriority(left);
      if (delta !== 0) return delta;
      return left.fingerprint.localeCompare(right.fingerprint);
    })
    .slice(0, Math.max(0, limit));
}

function boundEvidence(evidence: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(evidence).sort(([a], [b]) => a.localeCompare(b))) {
    if (lines.length >= MAX_EVIDENCE_KEYS) {
      lines.push(`- … (${Object.keys(evidence).length - MAX_EVIDENCE_KEYS} more keys omitted)`);
      break;
    }
    let rendered: string;
    if (value === undefined) rendered = "undefined";
    else if (value === null) rendered = "null";
    else if (typeof value === "string") rendered = value;
    else {
      try {
        rendered = JSON.stringify(value) ?? String(value);
      } catch {
        rendered = String(value);
      }
    }
    if (rendered.length > MAX_EVIDENCE_VALUE_CHARS)
      rendered = `${rendered.slice(0, MAX_EVIDENCE_VALUE_CHARS)}…`;
    lines.push(`- ${key}: ${rendered}`);
  }
  return lines;
}

function locationLine(finding: DoctorFinding): string | undefined {
  if (!finding.location) return undefined;
  const { path: filePath, line, column } = finding.location;
  if (line !== undefined && column !== undefined) return `${filePath}:${line}:${column}`;
  if (line !== undefined) return `${filePath}:${line}`;
  return filePath;
}

function docsUrl(finding: DoctorFinding): string {
  const docPath = finding.documentation?.startsWith("/")
    ? finding.documentation
    : `/rules/${finding.ruleId}`;
  return `${DOCTOR_DOCS_ORIGIN}${docPath}`;
}

/**
 * Build a stable, copy-paste markdown prompt for exactly one finding.
 * Patterns only — no licensed React Doctor source. Does not suggest suppressions.
 */
export function buildAgentPrompt(finding: DoctorFinding, options: AgentPromptOptions = {}): string {
  const guidance = ruleGuidance[finding.ruleId];
  const fix = finding.suggestion ?? guidance?.fix ?? "Address this finding, then re-run MFDoctor.";
  const impact = guidance?.impact ?? "This finding affects Module Federation correctness or DX.";
  const sources = guidance?.sources ?? [];
  const verify = options.verifyCommand ?? "mfdoctor check";
  const location = locationLine(finding);
  const evidenceLines = boundEvidence(finding.evidence ?? {});

  const lines = [
    `# Fix: ${finding.ruleId}`,
    "",
    "Fix exactly this MFDoctor finding. Do not change unrelated rules.",
    "Do not suggest suppressions or baseline entries unless the user asks.",
    "",
    "## Finding",
    `- Rule: \`${finding.ruleId}\``,
    `- Severity: ${finding.severity}`,
    `- Project: ${finding.project}`,
    `- Fingerprint: \`${finding.fingerprint}\``,
    ...(location ? [`- Location: \`${location}\``] : []),
    `- Message: ${finding.message}`,
    "",
    "## Impact",
    impact,
    "",
    "## Fix",
    fix,
    "",
    "## Evidence",
    ...(evidenceLines.length > 0 ? evidenceLines : ["- (none)"]),
    "",
    "## Docs",
    `- MFDoctor: ${docsUrl(finding)}`,
    ...sources.map((source) => `- Source: ${source}`),
    "",
    "## Verify",
    "```bash",
    verify,
    "```",
    "",
  ];
  return lines.join("\n");
}

/** Format top findings as a terminal handoff block (after score). */
export function formatTopAgentPrompts(
  findings: DoctorFinding[],
  options: AgentPromptOptions & { limit?: number } = {},
): string {
  const top = selectTopFindings(findings, options.limit ?? MAX_PROMPT_FINDINGS);
  if (top.length === 0) return "";
  const blocks = [
    `Agent prompts (top ${top.length})`,
    ...top.map((finding, index) => {
      const prompt = buildAgentPrompt(finding, options);
      return `\n--- prompt ${index + 1}/${top.length} ---\n${prompt.trimEnd()}`;
    }),
  ];
  return blocks.join("\n");
}

export function findPromptTarget(
  findings: DoctorFinding[],
  selector: string,
): DoctorFinding | undefined {
  const exactFingerprint = findings.find((finding) => finding.fingerprint === selector);
  if (exactFingerprint) return exactFingerprint;
  const byRule = findings.filter((finding) => finding.ruleId === selector && !finding.suppressed);
  if (byRule.length === 0) {
    return findings.find((finding) => finding.ruleId === selector);
  }
  return selectTopFindings(byRule, 1)[0];
}

/**
 * Resolve a diagnostics dump directory that must stay inside `root`.
 * Rejects absolute escapes and `..` traversal outside the workspace root.
 */
export function resolveDiagnosticsDir(root: string, diagnosticsDir: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, diagnosticsDir);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(
      `--diagnostics-dir must stay inside the project root (${resolvedRoot}); got ${diagnosticsDir}`,
    );
  }
  return resolved;
}

function safePromptFilename(finding: DoctorFinding, index: number): string {
  const safeRule = finding.ruleId.replaceAll(/[^a-zA-Z0-9._-]+/g, "-");
  const shortFp = finding.fingerprint.slice(0, 8);
  return `${String(index + 1).padStart(2, "0")}-${safeRule}-${shortFp}.md`;
}

export interface DiagnosticsDumpResult {
  directory: string;
  promptFiles: string[];
  summaryPath: string;
  reportPath: string;
}

/**
 * Write a bounded agent handoff dump: report.json, prompts/*.md, summary.md.
 * No secrets, env dumps, or node_modules trees — report paths stay as stored.
 */
export async function writeDiagnosticsDump(
  report: DoctorReport,
  diagnosticsDir: string,
  options: AgentPromptOptions & { limit?: number } = {},
): Promise<DiagnosticsDumpResult> {
  const promptsDir = path.join(diagnosticsDir, "prompts");
  // Replace prior dump contents so agents never read stale prompt files.
  await fs.rm(promptsDir, { recursive: true, force: true });
  await fs.mkdir(promptsDir, { recursive: true });
  const reportPath = path.join(diagnosticsDir, "report.json");
  await fs.writeFile(reportPath, stableStringify(report, 2) + "\n");

  const top = selectTopFindings(report.findings, options.limit ?? MAX_PROMPT_FINDINGS);
  const promptFiles: string[] = [];
  for (const [index, finding] of top.entries()) {
    const name = safePromptFilename(finding, index);
    const filePath = path.join(promptsDir, name);
    await fs.writeFile(filePath, buildAgentPrompt(finding, options));
    promptFiles.push(path.join("prompts", name));
  }

  const scoreLine =
    report.summary.score === null || report.summary.score === undefined
      ? "Score: n/a (partial analysis)"
      : `Score: ${report.summary.score}/100 (${report.summary.scoreLabel ?? "n/a"})`;

  const summaryLines = [
    "# MFDoctor — agent diagnostics",
    "",
    scoreLine,
    `${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info` +
      (report.summary.suppressed ? `, ${report.summary.suppressed} suppressed` : ""),
    "",
    "## Top findings",
    ...(top.length === 0
      ? ["- (none)"]
      : top.map(
          (finding, index) =>
            `${index + 1}. \`${finding.ruleId}\` (${finding.severity}) — ${finding.message}`,
        )),
    "",
    "## Prompt files",
    ...(promptFiles.length === 0 ? ["- (none)"] : promptFiles.map((file) => `- \`${file}\``)),
    "",
    "Re-run: `mfdoctor check`",
    "",
  ];
  const summaryPath = path.join(diagnosticsDir, "summary.md");
  await fs.writeFile(summaryPath, summaryLines.join("\n"));

  return { directory: diagnosticsDir, promptFiles, summaryPath, reportPath };
}
