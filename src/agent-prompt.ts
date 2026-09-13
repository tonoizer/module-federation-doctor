import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { doctorRuleDocUrl } from "./docs-url.js";
import {
  boundSafeEvidence,
  buildFindingRepairContext,
  findingRuleFamily,
  MAX_REPAIR_EVIDENCE_KEYS,
  type FindingRepairContextV1,
} from "./finding-details.js";
import { ruleGuidance, type RuleCategory } from "./rule-guidance.js";
import type { DoctorFinding, DoctorReport, Severity } from "./types.js";
import { stableStringify } from "./utils.js";

const SEVERITY_RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };
const CATEGORY_RANK: Record<RuleCategory, number> = {
  correctness: 4,
  security: 4,
  reliability: 3,
  performance: 2,
  tooling: 1,
};

/** Default top-N for terminal prompts and diagnostics dumps. */
export const DEFAULT_PROMPT_FINDINGS = 3;
/**
 * Hard cap for `--diagnostics-prompts` / `diagnosticsPromptLimit` dumps.
 * Keeps agent handoff artifacts bounded (no unbounded write).
 */
export const MAX_DIAGNOSTICS_PROMPT_FINDINGS = 25;

/** Env override for diagnostics dump prompt count (CLI flag wins). */
export const DIAGNOSTICS_PROMPTS_ENV = "MFDOCTOR_DIAGNOSTICS_PROMPTS";

export const VERIFICATION_PLAN_SCHEMA_VERSION = 1;
export const UNKNOWN_AGENT_VALUE = "unknown";

/** Analysis surfaces that have different safe verification follow-ups. */
export type AgentAnalysisKind = "check" | "workspace" | "federation" | "runtime" | "unknown";

export type VerificationFollowUpKind = "workspace" | "federation" | "runtime" | "none";

export interface VerificationFollowUp {
  kind: VerificationFollowUpKind;
  required: boolean;
  /** Absent commands are rendered as `unknown`; no build command is invented. */
  command: string;
  reason: string;
}

/**
 * Context retained by an analysis caller. Every field is optional so existing
 * callers and reports remain source-compatible; the built plan is explicit.
 */
export interface AgentAnalysisContext {
  analysisKind?: AgentAnalysisKind;
  projectDirectory?: string;
  reportPath?: string;
  requiredArtifacts?: readonly string[];
  rebuildRequired?: boolean;
  rebuildReason?: string;
  buildCommand?: string;
  followUp?: Partial<VerificationFollowUp>;
  completeness?: "complete" | "partial" | "unknown";
  completenessConditions?: readonly string[];
  /** Runtime input path when the original operation was `runtime`. */
  tracePath?: string;
  /** Compatibility aliases for callers that already name the operation. */
  workspaceFollowUp?: string;
  federationFollowUp?: string;
}

export interface VerificationPlan {
  schemaVersion: 1;
  analysisKind: AgentAnalysisKind;
  projectDirectory: string;
  reportPath: string;
  requiredArtifacts: string[];
  rebuildRequired: boolean;
  rebuildReason: string;
  /** `unknown` is intentional when the caller did not supply a build command. */
  buildCommand: string;
  followUp: VerificationFollowUp;
  completeness: "complete" | "partial" | "unknown";
  completenessConditions: string[];
}

export interface AgentPromptOptions {
  /** Override the verify command printed at the end. */
  verifyCommand?: string;
  /** Original analysis context, when the caller has it. */
  analysisContext?: AgentAnalysisContext;
  /** Short alias accepted for integrations that call this simply `context`. */
  context?: AgentAnalysisContext;
  /** Reuse a plan retained by a caller or a previous diagnostics dump. */
  verificationPlan?: VerificationPlan;
  /** Finding location in the saved report (RFC 6901 JSON Pointer). */
  jsonPointer?: string;
  /** Optional direct metadata overrides for simple integrations. */
  reportPath?: string;
  projectDirectory?: string;
}

/**
 * Resolve how many prompts a diagnostics dump may write.
 * Defaults to {@link DEFAULT_PROMPT_FINDINGS}; clamps to
 * {@link MAX_DIAGNOSTICS_PROMPT_FINDINGS}. Rejects non-integers and values below 1.
 */
export function resolveDiagnosticsPromptLimit(value?: number | string): number {
  if (value === undefined || value === "") return DEFAULT_PROMPT_FINDINGS;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `--diagnostics-prompts must be an integer between 1 and ${MAX_DIAGNOSTICS_PROMPT_FINDINGS}.`,
    );
  }
  if (parsed > MAX_DIAGNOSTICS_PROMPT_FINDINGS) {
    throw new Error(
      `--diagnostics-prompts exceeds the dump budget of ${MAX_DIAGNOSTICS_PROMPT_FINDINGS} (got ${parsed}).`,
    );
  }
  return parsed;
}

/**
 * Resolve diagnostics dump limit from explicit value, then env, else default.
 * Explicit `value` (CLI / DoctorOptions) wins over {@link DIAGNOSTICS_PROMPTS_ENV}.
 */
export function resolveDiagnosticsPromptLimitFromEnv(
  value?: number | string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (value !== undefined && value !== "") return resolveDiagnosticsPromptLimit(value);
  const raw = env[DIAGNOSTICS_PROMPTS_ENV];
  if (raw === undefined || raw === "") return DEFAULT_PROMPT_FINDINGS;
  return resolveDiagnosticsPromptLimit(raw);
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
  limit = DEFAULT_PROMPT_FINDINGS,
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function reportContext(report: DoctorReport): AgentAnalysisContext {
  const candidate = report as DoctorReport & {
    analysisContext?: unknown;
    context?: unknown;
  };
  return (asRecord(candidate.analysisContext) ??
    asRecord(candidate.context) ??
    {}) as AgentAnalysisContext;
}

function analysisKindFor(
  report: DoctorReport,
  finding: DoctorFinding | undefined,
  context: AgentAnalysisContext,
): AgentAnalysisKind {
  if (context.analysisKind) return context.analysisKind;
  const family = finding ? findingRuleFamily(finding.ruleId) : "";
  if (family === "runtime" || finding?.project === "runtime") return "runtime";
  if (
    family === "workspace" ||
    finding?.project === "workspace" ||
    asRecord(finding?.details)?.workspaceDiagnostics !== undefined
  )
    return "workspace";
  if (family === "federation") return "federation";
  const reportKind = asRecord(report)?.analysisKind;
  if (
    reportKind === "check" ||
    reportKind === "workspace" ||
    reportKind === "federation" ||
    reportKind === "runtime" ||
    reportKind === "unknown"
  )
    return reportKind;
  return "check";
}

function defaultRequiredArtifacts(
  kind: AgentAnalysisKind,
  context: AgentAnalysisContext,
): string[] {
  if (context.requiredArtifacts) return uniqueStrings(context.requiredArtifacts);
  const reportArtifact = nonEmpty(context.reportPath) ?? ".mf/doctor/report.json";
  if (kind === "workspace" || kind === "federation") {
    return uniqueStrings([".mf/doctor/**/project.json", reportArtifact]);
  }
  if (kind === "runtime") {
    return uniqueStrings([
      context.tracePath?.trim() || ".mf/observability/latest.json (or supplied trace)",
      ".mf/doctor/**/project.json",
      reportArtifact,
    ]);
  }
  if (kind === "check")
    return uniqueStrings([reportArtifact, ".mf/doctor/project.json (post-emit adapter facts)"]);
  return [];
}

function incompleteReasonText(report: DoctorReport): string | undefined {
  const reasons = report.status?.incompleteReasons ?? [];
  return reasons.length > 0 ? reasons.join(", ") : undefined;
}

function defaultRebuildRequired(
  kind: AgentAnalysisKind,
  report: DoctorReport,
  context: AgentAnalysisContext,
): boolean {
  if (context.rebuildRequired !== undefined) return context.rebuildRequired;
  if (kind === "check") return true;
  if (kind === "workspace" || kind === "federation") {
    if (!report.status) return true;
    return (
      report.status?.incompleteReasons.includes("missing-emit") === true ||
      report.status?.incompleteReasons.includes("missing-stats") === true
    );
  }
  return false;
}

function defaultRebuildReason(kind: AgentAnalysisKind, rebuildRequired: boolean): string {
  if (kind === "check")
    return "A check is config/static analysis; rebuild with the MFDoctor adapter before claiming emitted-artifact or federation coverage.";
  if (kind === "workspace" || kind === "federation") {
    if (rebuildRequired)
      return "Post-emit project facts are missing or their completeness is unknown; rebuild with the MFDoctor adapter before the federation gate.";
    return "The report records no missing post-emit facts; keep the existing project artifacts and re-run the federation gate after the fix.";
  }
  if (rebuildRequired)
    return "The current project facts are missing post-emit evidence required for verification.";
  if (kind === "runtime")
    return "Runtime correlation consumes an existing trace and local project facts; it does not require a rebuild for this repair step.";
  return "Existing post-emit project facts are available; rebuild is not required for this repair step.";
}

function defaultFollowUp(
  kind: AgentAnalysisKind,
  context: AgentAnalysisContext,
): VerificationFollowUp {
  const explicit = context.followUp;
  const defaultKind: VerificationFollowUpKind =
    kind === "check" || kind === "workspace"
      ? "workspace"
      : kind === "federation"
        ? "federation"
        : kind === "runtime"
          ? "runtime"
          : "none";
  const followUpKind = explicit?.kind ?? defaultKind;
  const legacyCommand =
    kind === "workspace"
      ? context.workspaceFollowUp
      : kind === "federation"
        ? context.federationFollowUp
        : undefined;
  const command =
    nonEmpty(explicit?.command) ??
    nonEmpty(legacyCommand) ??
    (followUpKind === "workspace"
      ? "mfdoctor workspace"
      : followUpKind === "runtime"
        ? "mfdoctor runtime <trace.json>"
        : UNKNOWN_AGENT_VALUE);
  const required = explicit?.required ?? kind !== "unknown";
  const reason =
    nonEmpty(explicit?.reason) ??
    (followUpKind === "workspace" && kind === "check"
      ? "Run the post-emit workspace gate after the narrow fix; mfdoctor check alone is not a green claim."
      : followUpKind === "workspace"
        ? "Re-run the workspace gate after the narrow fix so every project and federation edge is checked."
        : followUpKind === "federation"
          ? "Re-run the federation operation against the same explicit project facts after the narrow fix."
          : followUpKind === "runtime"
            ? "Re-run runtime correlation with the same supplied trace and local project facts after the narrow fix."
            : "The analysis surface is unknown; establish the intended operation before verifying.");
  return { kind: followUpKind, required, command, reason };
}

function defaultCompletenessConditions(kind: AgentAnalysisKind, report: DoctorReport): string[] {
  const current = incompleteReasonText(report);
  const statusCondition = report.status
    ? current
      ? `report.status.complete is true and incompleteReasons is empty (currently: ${current}).`
      : "report.status.complete is true and incompleteReasons is empty."
    : "A current report.status with complete: true is available; older reports do not prove completeness.";
  if (kind === "check")
    return [
      "The narrow finding fix is applied and no non-suppressed findings remain.",
      statusCondition,
      "A post-emit MFDoctor adapter build has produced the required project/artifact facts.",
      "The workspace/federation follow-up passes.",
    ];
  if (kind === "workspace" || kind === "federation")
    return [
      "Every intended project has a valid post-emit .mf/doctor/project.json.",
      statusCondition,
      "The same workspace/federation operation completes without incomplete evidence.",
      "No non-suppressed findings remain.",
    ];
  if (kind === "runtime")
    return [
      "The supplied Observability trace is loaded successfully.",
      "Matched local project facts are available for the required runtime attribution.",
      "Runtime correlation completes without incomplete evidence or actionable findings.",
    ];
  return [
    "The intended analysis operation and its required evidence are explicit.",
    "No non-suppressed findings remain.",
  ];
}

/** Build a versioned, explicit verification plan without guessing a build command. */
export function buildVerificationPlan(
  report: DoctorReport,
  context: AgentAnalysisContext = {},
  finding?: DoctorFinding,
): VerificationPlan {
  const original = { ...reportContext(report), ...context };
  const representativeFinding =
    finding ?? selectTopFindings(report.findings, 1)[0] ?? report.findings[0];
  const kind = analysisKindFor(report, representativeFinding, original);
  const rebuildRequired = defaultRebuildRequired(kind, report, original);
  const completeness =
    original.completeness ??
    (report.status ? (report.status.complete ? "complete" : "partial") : "unknown");
  const requiredArtifacts = defaultRequiredArtifacts(kind, original);
  const completenessConditions = uniqueStrings(
    original.completenessConditions ?? defaultCompletenessConditions(kind, report),
  );
  return {
    schemaVersion: VERIFICATION_PLAN_SCHEMA_VERSION,
    analysisKind: kind,
    projectDirectory: nonEmpty(original.projectDirectory) ?? UNKNOWN_AGENT_VALUE,
    reportPath: nonEmpty(original.reportPath) ?? UNKNOWN_AGENT_VALUE,
    requiredArtifacts,
    rebuildRequired,
    rebuildReason: nonEmpty(original.rebuildReason) ?? defaultRebuildReason(kind, rebuildRequired),
    buildCommand: nonEmpty(original.buildCommand) ?? UNKNOWN_AGENT_VALUE,
    followUp: defaultFollowUp(kind, original),
    completeness,
    completenessConditions:
      completenessConditions.length > 0
        ? completenessConditions
        : defaultCompletenessConditions(kind, report),
  };
}

/** Alias used by integrations that describe the plan as an agent handoff. */
export const createVerificationPlan = buildVerificationPlan;

/** Render the plan as stable Markdown for prompts and diagnostics summaries. */
export function renderVerificationPlan(plan: VerificationPlan): string {
  const followUpCommand =
    plan.followUp.command === UNKNOWN_AGENT_VALUE
      ? "unknown (operation is known, but no exact command was supplied)"
      : `\`${plan.followUp.command}\``;
  const buildCommand =
    plan.buildCommand === UNKNOWN_AGENT_VALUE
      ? "unknown (not provided; do not invent one)"
      : `\`${plan.buildCommand}\``;
  return [
    "## Verification plan",
    `- Analysis kind: \`${plan.analysisKind}\``,
    `- Project directory: \`${plan.projectDirectory}\``,
    `- Report path: \`${plan.reportPath}\``,
    "- Required artifacts:",
    ...(plan.requiredArtifacts.length > 0
      ? plan.requiredArtifacts.map((artifact) => `  - \`${artifact}\``)
      : ["  - (none explicitly supplied)"]),
    `- Rebuild required: ${plan.rebuildRequired ? "yes" : "no"} — ${plan.rebuildReason}`,
    `- Build command: ${buildCommand}`,
    `- Follow-up (${plan.followUp.kind}, ${plan.followUp.required ? "required" : "not required"}): ${followUpCommand}`,
    `  ${plan.followUp.reason}`,
    `- Completeness: \`${plan.completeness}\``,
    "- Complete when:",
    ...plan.completenessConditions.map((condition) => `  - ${condition}`),
  ].join("\n");
}

function boundEvidence(evidence: Record<string, unknown>, projectDirectory?: string): string[] {
  const bounded = boundSafeEvidence(evidence, projectDirectory);
  const lines = Object.entries(bounded).map(([key, value]) => `- ${key}: ${value}`);
  const omitted = Math.max(0, Object.keys(evidence).length - MAX_REPAIR_EVIDENCE_KEYS);
  if (omitted > 0) lines.push(`- … (${omitted} more keys omitted)`);
  return lines;
}

function promptContext(options: AgentPromptOptions): AgentAnalysisContext {
  return {
    ...options.context,
    ...options.analysisContext,
    ...(nonEmpty(options.projectDirectory) ? { projectDirectory: options.projectDirectory } : {}),
    ...(nonEmpty(options.reportPath) ? { reportPath: options.reportPath } : {}),
  };
}

function planForPrompt(finding: DoctorFinding, options: AgentPromptOptions): VerificationPlan {
  if (options.verificationPlan) return options.verificationPlan;
  // A prompt can be built from a single finding without loading a report. The
  // synthetic envelope only supplies the report fields needed for defaults;
  // all operation/build facts still come from the caller's retained context.
  const report: DoctorReport = {
    schemaVersion: 1,
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: true,
      stats: true,
      emittedAssets: true,
      installedVersions: true,
    },
    summary: { projects: 1, info: 0, warnings: 0, errors: 0 },
    findings: [finding],
  };
  return buildVerificationPlan(report, promptContext(options), finding);
}

function locationLine(finding: DoctorFinding): string | undefined {
  if (!finding.location) return undefined;
  const { path: filePath, line, column } = finding.location;
  if (line !== undefined && column !== undefined) return `${filePath}:${line}:${column}`;
  if (line !== undefined) return `${filePath}:${line}`;
  return filePath;
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
  const plan = planForPrompt(finding, options);
  const projectDirectory =
    plan.projectDirectory === UNKNOWN_AGENT_VALUE ? undefined : plan.projectDirectory;
  const reportPath = plan.reportPath === UNKNOWN_AGENT_VALUE ? undefined : plan.reportPath;
  const repairContext: FindingRepairContextV1 = buildFindingRepairContext(finding, {
    ...(projectDirectory ? { projectDirectory } : {}),
    ...(reportPath ? { reportPath } : {}),
    ...(options.jsonPointer ? { jsonPointer: options.jsonPointer } : {}),
  });
  const verify =
    options.verifyCommand ??
    (plan.analysisKind === "check"
      ? "mfdoctor check"
      : plan.followUp.command === UNKNOWN_AGENT_VALUE
        ? UNKNOWN_AGENT_VALUE
        : plan.followUp.command);
  const location = locationLine(finding);
  const evidenceLines = boundEvidence(finding.evidence ?? {}, projectDirectory);
  const detailLines = repairContext.details
    ? Object.entries(repairContext.details).map(([key, value]) => `- ${key}: ${value}`)
    : [];

  const lines = [
    `# Fix: ${finding.ruleId}`,
    "",
    "Fix exactly this MFDoctor finding. Do not change unrelated rules.",
    "Do not suggest suppressions or baseline entries unless the user asks.",
    "",
    renderVerificationPlan(plan),
    "",
    "## Repair context",
    `- Rule family: \`${repairContext.ruleFamily}\``,
    `- Fingerprint: \`${repairContext.fingerprint}\``,
    `- Report path: \`${repairContext.reportPath ?? UNKNOWN_AGENT_VALUE}\``,
    `- JSON pointer: \`${repairContext.jsonPointer ?? UNKNOWN_AGENT_VALUE}\``,
    ...(repairContext.detailsSchema
      ? [`- Details schema: \`${repairContext.detailsSchema}\``]
      : []),
    ...(detailLines.length > 0 ? ["- Bounded details:", ...detailLines] : []),
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
    `- MFDoctor: ${doctorRuleDocUrl(finding)}`,
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
  const top = selectTopFindings(findings, options.limit ?? DEFAULT_PROMPT_FINDINGS);
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
  verificationPlanPath: string;
}

/**
 * Write a bounded agent handoff dump: report.json, prompts/*.md, summary.md.
 * Prompt count defaults to {@link DEFAULT_PROMPT_FINDINGS}; pass `limit` (or
 * resolve via {@link resolveDiagnosticsPromptLimit}) to dump more, up to
 * {@link MAX_DIAGNOSTICS_PROMPT_FINDINGS}. No secrets, env dumps, or
 * node_modules trees — report paths stay as stored.
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
  await writeFileAtomic(reportPath, stableStringify(report, 2) + "\n");

  const limit = resolveDiagnosticsPromptLimit(options.limit ?? DEFAULT_PROMPT_FINDINGS);
  const top = selectTopFindings(report.findings, limit);

  const plan = options.verificationPlan
    ? { ...options.verificationPlan, reportPath }
    : buildVerificationPlan(report, {
        ...promptContext(options),
        reportPath,
      });
  const verificationPlanPath = path.join(diagnosticsDir, "verification-plan.json");
  await writeFileAtomic(verificationPlanPath, stableStringify(plan, 2) + "\n");

  const promptFiles: string[] = [];
  for (const [index, finding] of top.entries()) {
    const name = safePromptFilename(finding, index);
    const filePath = path.join(promptsDir, name);
    const findingIndex = report.findings.indexOf(finding);
    const jsonPointer =
      options.jsonPointer ?? (findingIndex >= 0 ? `/findings/${findingIndex}` : undefined);
    await writeFileAtomic(
      filePath,
      buildAgentPrompt(finding, {
        ...options,
        verificationPlan: plan,
        ...(jsonPointer ? { jsonPointer } : {}),
      }),
    );
    promptFiles.push(path.join("prompts", name));
  }

  const scoreLine =
    report.summary.score === null || report.summary.score === undefined
      ? "Score: n/a (partial analysis)"
      : `Score: ${report.summary.score}/100 (${report.summary.scoreLabel ?? "n/a"})`;

  const eligible = report.findings.filter((finding) => !finding.suppressed).length;
  const findingsHeading =
    top.length > 0 && eligible > top.length
      ? `## Top findings (${top.length} of ${eligible}, dump budget ${limit})`
      : "## Top findings";

  const summaryLines = [
    "# MFDoctor — agent diagnostics",
    "",
    scoreLine,
    `${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info` +
      (report.summary.suppressed ? `, ${report.summary.suppressed} suppressed` : ""),
    "",
    findingsHeading,
    ...(top.length === 0
      ? ["- (none)"]
      : top.map(
          (finding, index) =>
            `${index + 1}. \`${finding.ruleId}\` (${finding.severity}) — ${finding.message}`,
        )),
    "",
    "## Prompt files",
    ...(promptFiles.length === 0 ? ["- (none)"] : promptFiles.map((file) => `- \`${file}\``)),
    `- Plan: \`${path.relative(diagnosticsDir, verificationPlanPath)}\``,
    "",
    renderVerificationPlan(plan),
    "",
    `Re-run: ${
      plan.followUp.command === UNKNOWN_AGENT_VALUE
        ? "unknown (no exact operation command was supplied)"
        : `\`${plan.followUp.command}\``
    }`,
    "",
  ];
  const summaryPath = path.join(diagnosticsDir, "summary.md");
  await writeFileAtomic(summaryPath, summaryLines.join("\n"));

  return { directory: diagnosticsDir, promptFiles, summaryPath, reportPath, verificationPlanPath };
}
