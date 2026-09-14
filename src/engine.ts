import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  applyBaseline,
  loadBaseline,
  policyFails,
  resolveBaselineOptions,
  summarizeFindings,
  type ResolvedBaselineOptions,
} from "./baseline.js";
import { addBuildFacts, collectProjectFacts, type BuildDiagnostics } from "./collect.js";
import { resolveOptions } from "./config.js";
import { compareV1Outputs } from "./evidence-parity.js";
import {
  migratedFederationEvidenceRuleIds,
  projectMigratedFederationFailures,
  runMigratedFederationRules,
  type MigratedFederationEvidenceRun,
} from "./evidence-federation-bridge.js";
import {
  migratedEvidenceRules,
  migratedEvidenceRuleIds,
  migratedRuntimeEvidenceRuleIds,
  projectMigratedFailures,
  runMigratedEvidenceRules,
  runMigratedRuntimeEvidenceRules,
  type MigratedEvidenceRun,
} from "./evidence-rule-bridge.js";
import { createEvidenceRolloutController } from "./evidence-rollout.js";
import {
  evaluateFederationWorkspaceOracle,
  type FederationOracleFinding,
} from "./federation-workspace-oracle.js";
import { writeDiagnosticsDump } from "./agent-prompt.js";
import { computeHealthScore } from "./health-score.js";
import { builtInRules, federationRuleMeta } from "./rules.js";
import { DEFAULT_ALWAYS_SHARED } from "./shared-policy.js";
import {
  createWorkspaceApplicationIdentity,
  workspaceProjectRoot,
  workspaceRootForProjects,
} from "./monorepo-identity.js";
import type { WorkspaceProjectDiagnostic } from "./workspace.js";
import type {
  AnalysisResult,
  BuildRecord,
  DoctorFinding,
  DoctorOptions,
  DoctorReport,
  DoctorRule,
  EvidenceAnalysisMetadata,
  FederationAnalysisResult,
  FederationInstanceFacts,
  OutputFormat,
  ProjectFacts,
  BuildOutputInput,
  ResolvedDoctorOptions,
  RuleSetting,
  Severity,
} from "./types.js";
import { FINDING_DETAILS_SCHEMAS } from "./finding-details.js";
import {
  compareCodePoint,
  deepFreeze,
  fingerprint,
  redact,
  relativePath,
  sortFindings,
} from "./utils.js";
import { writeFederationReports, writeReports } from "./reporters.js";
import { buildUiPayload, reportFromFindings } from "./ui-graph.js";
import {
  AnalysisBudgetTracker,
  resolveAnalysisBudgets,
  type AnalysisBudgetReport,
} from "./analysis-budgets.js";
import { mapBounded } from "./async-map.js";
import type { RuleExecutionState } from "./rule-contract.js";
import {
  computeRunStatus,
  isStrictlyComplete,
  markRunIncomplete,
  RUN_FAILURE_DETAILS_SCHEMA,
  RUN_FAILURE_ERROR_CODES,
  type RunFailureDetails,
  type RunFailurePhase,
} from "./run-status.js";

const ANALYSIS_FAILURE_RULE_ID = "doctor/analysis-failed";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function structuredExecutionState(
  state: RuleExecutionState,
  phase: RunFailurePhase,
  runId: string,
): RuleExecutionState {
  if (state.state !== "engine-error") return state;
  return {
    ...state,
    phase,
    errorCode: RUN_FAILURE_ERROR_CODES[phase],
    runId,
  } as RuleExecutionState;
}

function structureExecutionFailures(
  execution: readonly RuleExecutionState[],
  phase: RunFailurePhase,
  runId: string,
): RuleExecutionState[] {
  return execution.map((state) => structuredExecutionState(state, phase, runId));
}

function structureEvidenceRun<T extends { output: { execution: RuleExecutionState[] } }>(
  run: T,
  phase: RunFailurePhase,
  runId: string,
): T {
  return {
    ...run,
    output: {
      ...run.output,
      execution: structureExecutionFailures(run.output.execution, phase, runId),
    },
  } as T;
}

function runFailureFinding(
  root: string,
  project: string,
  details: RunFailureDetails,
  message: string,
  ruleId = ANALYSIS_FAILURE_RULE_ID,
  documentation?: string,
  federationInstanceId?: string,
): DoctorFinding {
  const safeMessage = redact(message, root) as string;
  const safeDetails = redact(details, root) as Record<string, unknown>;
  const base = {
    schemaVersion: 1 as const,
    ruleId,
    severity: "error" as const,
    message: safeMessage,
    project,
    ...(federationInstanceId ? { federationInstanceId } : {}),
    evidence: {
      phase: details.phase,
      errorCode: details.errorCode,
      ...(details.ruleId ? { ruleId: details.ruleId } : {}),
    },
    ...(documentation ? { documentation } : {}),
    suggestion: "Fix the reported failure, then re-run MFDoctor to collect the full report.",
  };
  return {
    ...base,
    fingerprint: fingerprint(base),
    detailsSchema: RUN_FAILURE_DETAILS_SCHEMA,
    details: safeDetails,
  };
}

function minimalFailureFacts(
  root: string,
  bundler: DoctorOptions["bundler"] = "unknown",
  mode: "development" | "ci" = "development",
): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: path.basename(root) || "unknown", root: "." },
    bundler: { name: bundler ?? "unknown", mode },
    capabilities: {
      config: false,
      sourceImports: false,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: false,
    },
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: { emittedAssets: [] },
  };
}

async function failureFacts(
  resolved: ResolvedDoctorOptions | undefined,
  existing: ProjectFacts | undefined,
  options: DoctorOptions,
): Promise<ProjectFacts> {
  if (existing) return existing;
  if (resolved) {
    try {
      return await collectProjectFacts({ ...resolved, include: [] });
    } catch {
      // Keep failure reporting independent from a second collection failure.
    }
  }
  const root = path.resolve(options.root ?? process.cwd());
  return minimalFailureFacts(root, options.bundler, options.mode);
}

async function persistFailureReport(
  directory: string,
  write: boolean,
  report: DoctorReport,
  formats: readonly OutputFormat[] = [],
): Promise<void> {
  if (!write) return;
  const sarifPath = path.join(directory, "results.sarif");
  try {
    await fs.mkdir(directory, { recursive: true });
    // A failed run must never leave a previous run's SARIF looking current. A
    // caller that requested SARIF gets a fresh failure document below; all
    // other callers get the stale artifact invalidated.
    await fs.rm(sarifPath, { force: true });
    await writeFederationReports(
      report,
      directory,
      ["json", ...(formats.includes("sarif") ? (["sarif"] as const) : [])],
      { write: true },
    );
  } catch (error) {
    await fs.rm(sarifPath, { force: true }).catch(() => undefined);
    process.stderr.write(
      `MFDoctor could not write the current failure report: ${errorMessage(error)}\n`,
    );
  }
}

export function isAnalysisIncomplete(analysis: AnalysisBudgetReport | undefined): boolean {
  return Boolean(analysis && (analysis.status !== "complete" || analysis.exceeded.length > 0));
}

function parseSetting(setting: RuleSetting | undefined, fallback: Severity) {
  if (!setting) return { severity: fallback, options: {} };
  if (setting === "off") return undefined;
  if (Array.isArray(setting)) return { severity: setting[0], options: setting[1] };
  return { severity: setting as Severity, options: {} };
}

async function runRule(
  rule: DoctorRule,
  facts: ProjectFacts,
  setting: RuleSetting | undefined,
  root: string,
  sharedPolicy?: ResolvedDoctorOptions["sharedPolicy"],
  recognizeMfToolkit?: boolean,
  runId: string = randomUUID(),
): Promise<DoctorFinding[]> {
  const resolved = parseSetting(setting, rule.meta.defaultSeverity);
  // Unknown bundler means detection failed. Keep shared rules running; Vite-only
  // (and other restricted) rules still skip via supportedBundlers on known names
  // and via their existing imperative bundler checks.
  if (
    !resolved ||
    (facts.bundler.name !== "unknown" && !rule.meta.supportedBundlers.includes(facts.bundler.name))
  )
    return [];
  const findings: DoctorFinding[] = [];
  const add = (
    value: Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">,
  ) => {
    const evidence = redact(value.evidence, root) as Record<string, unknown>;
    const location = value.location
      ? { ...value.location, path: redact(value.location.path, root) as string }
      : undefined;
    // Fingerprint inputs stay ruleId/project/location/evidence only (see utils.fingerprint).
    // detailsSchema/details are attached after hashing so baselines/SARIF stay stable.
    const base = {
      schemaVersion: 1 as const,
      ruleId: rule.meta.id,
      severity: resolved.severity,
      message: redact(value.message, root) as string,
      project: facts.project.name,
      ...(facts.federationInstanceId ? { federationInstanceId: facts.federationInstanceId } : {}),
      evidence,
      documentation: rule.meta.documentation,
      ...(location ? { location } : {}),
      ...(value.suggestion ? { suggestion: redact(value.suggestion, root) as string } : {}),
    };
    findings.push({
      ...base,
      fingerprint: fingerprint(base),
      ...(value.detailsSchema ? { detailsSchema: value.detailsSchema } : {}),
      ...(value.details ? { details: redact(value.details, root) as Record<string, unknown> } : {}),
    });
  };
  try {
    const returned = await rule.check({
      facts: deepFreeze(structuredClone(facts)),
      options: deepFreeze(resolved.options),
      root,
      ...(sharedPolicy ? { sharedPolicy: deepFreeze(sharedPolicy) } : {}),
      ...(recognizeMfToolkit !== undefined ? { recognizeMfToolkit } : {}),
      report: add,
    });
    if (Array.isArray(returned)) for (const finding of returned) add(finding);
  } catch (error) {
    // Keep every other rule's findings; never abort the suite on the first rule failure.
    findings.push(
      runFailureFinding(
        root,
        facts.project.name,
        {
          phase: "rule",
          errorCode: RUN_FAILURE_ERROR_CODES.rule,
          runId,
          ruleId: rule.meta.id,
          error: redact(errorMessage(error), root) as string,
        },
        `Rule "${rule.meta.id}" failed during analysis: ${errorMessage(error)}`,
        rule.meta.id,
        rule.meta.documentation,
        facts.federationInstanceId,
      ),
    );
  }
  return findings;
}

function factsForFederationInstance(
  facts: ProjectFacts,
  instance: FederationInstanceFacts,
): ProjectFacts {
  const scopedFacts = { ...facts };
  delete scopedFacts.canonicalConfig;
  delete scopedFacts.runtimePluginContracts;
  delete scopedFacts.builds;
  return {
    ...scopedFacts,
    federationInstanceId: instance.id,
    moduleFederation: instance.moduleFederation,
    capabilities: instance.capabilities,
    imports: instance.imports,
    artifacts: instance.artifacts,
    ...(instance.canonicalConfig ? { canonicalConfig: instance.canonicalConfig } : {}),
    ...(instance.runtimePluginContracts
      ? { runtimePluginContracts: instance.runtimePluginContracts }
      : {}),
    ...(instance.builds ? { builds: instance.builds } : {}),
  };
}

function ruleFacts(facts: ProjectFacts): ProjectFacts[] {
  return facts.federationInstances?.length
    ? facts.federationInstances.map((instance) => factsForFederationInstance(facts, instance))
    : [facts];
}

function migratedEvidenceScopes(
  facts: ProjectFacts,
): Array<{ facts: ProjectFacts; build?: BuildRecord }> {
  return ruleFacts(facts).flatMap((scopedFacts) =>
    scopedFacts.builds?.length
      ? scopedFacts.builds.map((build) => ({ facts: scopedFacts, build }))
      : [{ facts: scopedFacts }],
  );
}

function bridgeEngineErrors(
  settings: Readonly<Record<string, RuleSetting>>,
  error: unknown,
  root: string,
  runId: string,
): RuleExecutionState[] {
  const message = redact(errorMessage(error), root) as string;
  return migratedEvidenceRules
    .filter((rule) => settings[rule.meta.id] !== "off")
    .map(
      (rule) =>
        ({
          state: "engine-error" as const,
          rule: { id: rule.meta.id, version: rule.meta.version },
          reason: "Evidence bridge failed before rule evaluation.",
          error: message,
          phase: "evidence" as const,
          errorCode: RUN_FAILURE_ERROR_CODES.evidence,
          runId,
        }) as RuleExecutionState,
    );
}

async function legacyMigratedFallback(
  facts: ProjectFacts,
  settings: Readonly<Record<string, RuleSetting>>,
  root: string,
  sharedPolicy: ResolvedDoctorOptions["sharedPolicy"],
  recognizeMfToolkit: boolean | undefined,
  runId: string,
): Promise<DoctorFinding[]> {
  return (
    await Promise.all(
      builtInRules
        .filter((rule) => migratedEvidenceRuleIds.has(rule.meta.id))
        .map((rule) =>
          runRule(
            rule,
            facts,
            settings[rule.meta.id],
            root,
            sharedPolicy,
            recognizeMfToolkit,
            runId,
          ),
        ),
    )
  ).flat();
}

function reportFor(facts: ProjectFacts, findings: DoctorFinding[]): DoctorReport {
  const summary = summarizeFindings(findings);
  const health = computeHealthScore(findings);
  return {
    schemaVersion: 1,
    capabilities: facts.capabilities,
    status: computeRunStatus([facts]),
    summary: {
      projects: 1,
      info: summary.info,
      warnings: summary.warnings,
      errors: summary.errors,
      ...(summary.suppressed > 0 ? { suppressed: summary.suppressed } : {}),
      score: health.score,
      scoreLabel: health.scoreLabel,
    },
    findings,
  };
}

async function withBaseline(
  findings: DoctorFinding[],
  baseline: ResolvedBaselineOptions | undefined,
): Promise<{ findings: DoctorFinding[]; failOnSuppressed: boolean }> {
  if (!baseline) return { findings, failOnSuppressed: false };
  const file = await loadBaseline(baseline.path);
  const applied = applyBaseline(findings, file, { reportStale: baseline.reportStale });
  return {
    findings: sortFindings(applied.findings),
    failOnSuppressed: baseline.failOnSuppressed,
  };
}

async function runAnalysis(
  options: DoctorOptions = {},
  emittedAssets?: string[],
  diagnostics?: BuildDiagnostics,
  buildOutputs?: BuildOutputInput[],
): Promise<AnalysisResult> {
  const runId = randomUUID();
  let resolved: ResolvedDoctorOptions | undefined;
  let facts: ProjectFacts | undefined;
  let collectedFindings: DoctorFinding[] = [];
  try {
    const resolvedOptions = await resolveOptions(
      diagnostics?.moduleFederationInstances?.length
        ? { ...options, moduleFederationInstances: diagnostics.moduleFederationInstances }
        : options,
    );
    resolved = resolvedOptions;
    const boundedRoots = buildOutputs
      ? buildOutputs
          .filter((output) => output.buildWrite !== false)
          .map((output) => output.outputRoot)
          .filter((value): value is string => Boolean(value))
      : undefined;
    facts = await collectProjectFacts(resolvedOptions, boundedRoots);
    if (emittedAssets)
      await addBuildFacts(facts, emittedAssets, resolvedOptions.root, diagnostics, buildOutputs);
    const rolloutDefaults = createEvidenceRolloutController();
    const rollout = rolloutDefaults.emergencyLegacy
      ? rolloutDefaults
      : (options.evidenceRollout ?? rolloutDefaults);
    const rolloutMode = rollout.modeFor("rules");
    const scopedFacts = ruleFacts(facts);
    const legacyBuiltIns =
      rolloutMode === "v2-compat"
        ? builtInRules.filter((rule) => !migratedEvidenceRuleIds.has(rule.meta.id))
        : builtInRules;
    let legacyFindings = (
      await Promise.all(
        scopedFacts.flatMap((factsForRules) =>
          [...legacyBuiltIns, ...resolvedOptions.extends].map((rule) =>
            runRule(
              rule,
              factsForRules,
              resolvedOptions.rules[rule.meta.id],
              resolvedOptions.root,
              resolvedOptions.sharedPolicy,
              resolvedOptions.recognizeMfToolkit,
              runId,
            ),
          ),
        ),
      )
    ).flat();
    const migratedRuns: Array<{ facts: ProjectFacts; run: MigratedEvidenceRun }> = [];
    const migratedProjectionRuns: Array<{
      facts: ProjectFacts;
      run: MigratedEvidenceRun;
    }> = [];
    const migratedExecutionErrors: RuleExecutionState[] = [];
    let legacyRuntimeFindings: DoctorFinding[] = [];
    const bridgeBudget =
      rolloutMode === "legacy"
        ? undefined
        : new AnalysisBudgetTracker(resolvedOptions.analysisBudgets);
    if (rolloutMode !== "legacy") {
      for (const scope of migratedEvidenceScopes(facts)) {
        try {
          const run = structureEvidenceRun(
            await runMigratedEvidenceRules(
              scope.facts,
              resolvedOptions.rules,
              bridgeBudget,
              scope.build,
              {
                root: resolvedOptions.root,
                sharedPolicy: resolvedOptions.sharedPolicy,
                ...(resolvedOptions.recognizeMfToolkit !== undefined
                  ? { recognizeMfToolkit: resolvedOptions.recognizeMfToolkit }
                  : {}),
              },
            ),
            "evidence",
            runId,
          );
          migratedRuns.push({ facts: scope.facts, run });
          const needsLegacyFallback =
            run.output.execution.some((state) => state.state === "engine-error") ||
            isAnalysisIncomplete(run.output.analysis);
          if (rolloutMode === "v2-compat" && needsLegacyFallback) {
            legacyFindings = legacyFindings.concat(
              await legacyMigratedFallback(
                scope.facts,
                resolvedOptions.rules,
                resolvedOptions.root,
                resolvedOptions.sharedPolicy,
                resolvedOptions.recognizeMfToolkit,
                runId,
              ),
            );
          } else migratedProjectionRuns.push({ facts: scope.facts, run });
        } catch (error) {
          // A migrated graph is additive. A malformed or budget-clipped bridge
          // must not discard the complete legacy V1 result.
          migratedExecutionErrors.push(
            ...bridgeEngineErrors(resolvedOptions.rules, error, resolvedOptions.root, runId),
          );
          if (rolloutMode === "v2-compat") {
            legacyFindings = legacyFindings.concat(
              await legacyMigratedFallback(
                scope.facts,
                resolvedOptions.rules,
                resolvedOptions.root,
                resolvedOptions.sharedPolicy,
                resolvedOptions.recognizeMfToolkit,
                runId,
              ),
            );
          }
        }
      }
      if (resolvedOptions.runtimeTrace) {
        try {
          const { correlateRuntime, loadRuntimeTraceFile } = await import("./runtime-trace.js");
          const runtimeTraces = await loadRuntimeTraceFile(resolvedOptions.runtimeTrace);
          if (runtimeTraces.length > 0) {
            const runtimeProjects = scopedFacts.length > 0 ? scopedFacts : [facts];
            legacyRuntimeFindings = correlateRuntime(runtimeTraces, runtimeProjects);
            const run = structureEvidenceRun(
              await runMigratedRuntimeEvidenceRules(
                facts,
                runtimeProjects,
                runtimeTraces,
                resolvedOptions.rules,
                bridgeBudget,
                {
                  root: resolvedOptions.root,
                  sharedPolicy: resolvedOptions.sharedPolicy,
                  ...(resolvedOptions.recognizeMfToolkit !== undefined
                    ? { recognizeMfToolkit: resolvedOptions.recognizeMfToolkit }
                    : {}),
                },
              ),
              "evidence",
              runId,
            );
            migratedRuns.push({ facts, run });
            migratedProjectionRuns.push({ facts, run });
          }
        } catch (error) {
          migratedExecutionErrors.push(
            ...bridgeEngineErrors(resolvedOptions.rules, error, resolvedOptions.root, runId),
          );
        }
      }
    }
    const migratedFindings = sortFindings(
      migratedProjectionRuns.flatMap(({ facts: factsForEvidence, run }) =>
        projectMigratedFailures(
          run.output.evaluations,
          factsForEvidence,
          resolvedOptions.rules,
          resolvedOptions.root,
          run.graph.subjects,
        ),
      ),
    );
    const isProjectScopedFinding = (finding: DoctorFinding) => finding.project !== "runtime";
    const findingsForParity = (findings: readonly DoctorFinding[]) =>
      [...findings].sort(
        (left, right) =>
          left.ruleId.localeCompare(right.ruleId) || left.project.localeCompare(right.project),
      );
    const parity =
      rolloutMode === "shadow"
        ? compareV1Outputs(
            findingsForParity([
              ...legacyFindings.filter((finding) => migratedEvidenceRuleIds.has(finding.ruleId)),
              ...legacyRuntimeFindings.filter(
                (finding) =>
                  migratedRuntimeEvidenceRuleIds.has(finding.ruleId) &&
                  isProjectScopedFinding(finding),
              ),
            ]),
            findingsForParity(migratedFindings),
          )
        : undefined;
    const rawFindings = sortFindings(
      rolloutMode === "v2-compat" ? [...legacyFindings, ...migratedFindings] : legacyFindings,
    );
    collectedFindings = rawFindings;
    const { findings, failOnSuppressed } = await withBaseline(
      rawFindings,
      resolvedOptions.baseline,
    );
    collectedFindings = findings;
    const policyFailed = policyFails(findings, resolvedOptions.failOn, failOnSuppressed);
    // Write the full report before any caller decides to fail the build.
    // Terminal showcase is the single print path (adapters must not re-print).
    const report = reportFor(facts, findings);
    const safeFacts = redact(facts, resolvedOptions.root) as ProjectFacts;
    await writeReports(
      safeFacts,
      report,
      resolvedOptions.output.directory,
      resolvedOptions.output.formats,
      {
        quiet: resolvedOptions.quiet,
        printLog: resolvedOptions.printLog,
        score: resolvedOptions.score,
        prompt: resolvedOptions.prompt,
        policy: { failOn: resolvedOptions.failOn, failOnSuppressed },
        write: resolvedOptions.output.write,
        stdoutJson: resolvedOptions.output.stdout,
      },
    );
    if (resolvedOptions.diagnosticsDir)
      await writeDiagnosticsDump(report, resolvedOptions.diagnosticsDir, {
        limit: resolvedOptions.diagnosticsPromptLimit,
      });
    return {
      facts: safeFacts,
      report,
      exitCode:
        resolvedOptions.requireComplete && !isStrictlyComplete([facts], report.status)
          ? 1
          : isAnalysisIncomplete(facts.analysis)
            ? 2
            : policyFailed
              ? 1
              : 0,
      evidence: {
        rollout: { scope: "rules", mode: rolloutMode },
        evaluations: migratedRuns.flatMap(({ run }) => run.output.evaluations),
        execution: [
          ...migratedRuns.flatMap(({ run }) => run.output.execution),
          ...migratedExecutionErrors,
        ],
        ...(parity ? { parity } : {}),
      },
    };
  } catch (error) {
    const message = errorMessage(error);
    if (resolved?.output.formats.includes("terminal"))
      process.stderr.write(`MFDoctor could not complete: ${message}\n`);
    const failedFacts = await failureFacts(resolved, facts, options);
    const failureRoot = resolved?.root ?? path.resolve(options.root ?? process.cwd());
    const failureFinding = runFailureFinding(
      failureRoot,
      failedFacts.project.name,
      {
        phase: "analysis",
        errorCode: RUN_FAILURE_ERROR_CODES.analysis,
        runId,
        error: redact(message, failureRoot) as string,
      },
      `MFDoctor analysis failed: ${message}`,
    );
    const failureFindings = sortFindings([...collectedFindings, failureFinding]);
    const failureReport = reportFor(failedFacts, failureFindings);
    failureReport.status = markRunIncomplete(failureReport.status, "evidence-unknown");
    const fallbackRoot = path.resolve(options.root ?? process.cwd());
    await persistFailureReport(
      resolved?.output.directory ??
        path.resolve(fallbackRoot, options.output?.directory ?? ".mf/doctor"),
      resolved?.output.write ?? options.output?.write !== false,
      failureReport,
      resolved?.output.formats ?? options.output?.formats ?? [],
    );
    const safeFacts = redact(failedFacts, failureRoot) as ProjectFacts;
    return {
      facts: safeFacts,
      report: failureReport,
      exitCode: (resolved?.requireComplete ?? options.requireComplete) ? 1 : 2,
    };
  }
}

export async function analyze(options: DoctorOptions = {}): Promise<AnalysisResult> {
  return runAnalysis(options);
}

export async function analyzeBuild(
  options: DoctorOptions,
  emittedAssets: string[],
  diagnostics?: BuildDiagnostics,
  buildOutputs?: BuildOutputInput[],
): Promise<AnalysisResult> {
  return runAnalysis(options, emittedAssets, diagnostics, buildOutputs);
}

function pushFederationFinding(
  findings: DoctorFinding[],
  rules: Record<string, RuleSetting> | undefined,
  ruleId: (typeof federationRuleMeta)[number]["id"],
  project: string,
  message: string,
  evidence: Record<string, unknown>,
  typedDetails?: { detailsSchema: string; details: Record<string, unknown> },
): void {
  const meta = federationRuleMeta.find((rule) => rule.id === ruleId);
  const resolved = parseSetting(rules?.[ruleId], meta?.severity ?? "warning");
  if (!resolved || !meta) return;
  // Fingerprint excludes detailsSchema/details — never put schema version in evidence.
  const base = {
    schemaVersion: 1 as const,
    ruleId,
    severity: resolved.severity,
    project,
    message,
    evidence,
    documentation: `/rules/${ruleId}`,
    suggestion: meta.fix,
  };
  findings.push({
    ...base,
    fingerprint: fingerprint(base),
    ...(typedDetails?.detailsSchema ? { detailsSchema: typedDetails.detailsSchema } : {}),
    ...(typedDetails?.details ? { details: typedDetails.details } : {}),
  });
}

function pushOracleFederationFindings(
  findings: DoctorFinding[],
  rules: Record<string, RuleSetting> | undefined,
  oracleFindings: readonly FederationOracleFinding[],
): void {
  for (const finding of oracleFindings) {
    pushFederationFinding(
      findings,
      rules,
      finding.ruleId as (typeof federationRuleMeta)[number]["id"],
      finding.project,
      finding.message,
      finding.evidence,
      finding.detailsSchema
        ? { detailsSchema: finding.detailsSchema, details: finding.details ?? {} }
        : undefined,
    );
  }
}

function legacyFederationFindingsForGroup(
  projectGroup: ProjectFacts[],
  groupEvidenceIncomplete: boolean,
  rules: Record<string, RuleSetting> | undefined,
  alwaysShared: ReadonlySet<string>,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  pushOracleFederationFindings(
    findings,
    rules,
    evaluateFederationWorkspaceOracle({
      projectGroup,
      groupEvidenceIncomplete,
      alwaysShared,
    }),
  );
  return findings;
}

function federationBridgeEngineErrors(
  settings: Readonly<Record<string, RuleSetting>>,
  error: unknown,
  root: string,
  runId: string,
): RuleExecutionState[] {
  const message = redact(errorMessage(error), root) as string;
  return [...migratedFederationEvidenceRuleIds]
    .filter((id) => settings[id] !== "off")
    .map(
      (id) =>
        ({
          state: "engine-error" as const,
          rule: { id, version: "1" },
          reason: "Federation evidence bridge failed before rule evaluation.",
          error: message,
          phase: "evidence" as const,
          errorCode: RUN_FAILURE_ERROR_CODES.evidence,
          runId,
        }) as RuleExecutionState,
    );
}

function aggregateWorkspaceSourceReadFailures(
  entries: Array<{ file: string; project: ProjectFacts }>,
  workspaceRoot: string,
): string[] {
  const failures = new Set<string>();
  for (const entry of entries) {
    const projectRoot = path.resolve(
      workspaceProjectRoot(entry.file),
      entry.project.project.root || ".",
    );
    for (const failure of entry.project.imports?.sourceReadFailures ?? []) {
      if (typeof failure !== "string") continue;
      const safePath = redact(
        relativePath(workspaceRoot, path.resolve(projectRoot, failure)),
      ) as string;
      failures.add(safePath);
    }
  }
  return [...failures].sort();
}

function hasIncompleteProjectAnalysis(project: ProjectFacts): boolean {
  return Boolean(
    isAnalysisIncomplete(project.analysis) ||
    project.imports.sourceScope === "partial" ||
    project.federationInstances?.some((instance) => instance.imports.sourceScope === "partial"),
  );
}

function hasPackageCapableUnresolvedDynamic(project: ProjectFacts): boolean {
  return (project.imports?.unresolvedDynamic ?? []).some((item) =>
    ["import", "loadShare", "loadShareSync"].includes(item.api),
  );
}

function pushWorkspacePartialFinding(
  findings: DoctorFinding[],
  message: string,
  evidence: Record<string, unknown>,
  details: Record<string, unknown>,
): void {
  const fingerprintBase = {
    schemaVersion: 1 as const,
    ruleId: "doctor/partial-analysis",
    severity: "warning" as const,
    project: "workspace",
    message,
    evidence,
    documentation: "/rules/doctor/partial-analysis",
  };
  const finding = {
    ...fingerprintBase,
    detailsSchema: FINDING_DETAILS_SCHEMAS.DOCTOR_PARTIAL_ANALYSIS,
    details,
  };
  findings.push({ ...finding, fingerprint: fingerprint(fingerprintBase) });
}

function federationProjectGroups(projects: ProjectFacts[]): ProjectFacts[][] {
  const groups = new Map<string, ProjectFacts[]>();
  for (const project of projects) {
    const key = project.project.federationGroup ?? "\0ungrouped";
    groups.set(key, [...(groups.get(key) ?? []), project]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareCodePoint(left, right))
    .map(([, group]) =>
      group.sort((left, right) => compareCodePoint(left.project.name, right.project.name)),
    );
}

export type FederationAnalysisOptions = {
  outputDirectory?: string;
  formats?: OutputFormat[];
  /** When false, skip writing report artifacts to disk. Defaults to true. */
  write?: boolean;
  /** When true, emit the JSON report on stdout. */
  stdoutJson?: boolean;
  failOn?: "never" | "warning" | "error";
  baseline?: string | { path: string; failOnSuppressed?: boolean; reportStale?: boolean };
  root?: string;
  quiet?: boolean;
  printLog?: { success?: boolean };
  /** When false, omit health score from terminal output. */
  score?: boolean;
  /** When false, omit top agent prompts from terminal output. */
  prompt?: boolean;
  /** Severity / off map (supports `rules: { "federation/ghost-shares": "off" }`). */
  rules?: Record<string, RuleSetting>;
  /** Packages excluded from host-gap / ghost-share heuristics. */
  alwaysShared?: string[];
  /** Opt in to failing when persisted workspace evidence is incomplete. */
  requireComplete?: boolean;
  analysis?: AnalysisBudgetReport;
  workspaceDiagnostics?: WorkspaceProjectDiagnostic[];
  /** @internal Evidence rollout injection for staged federation rule migration. */
  evidenceRollout?: import("./evidence-rollout.js").EvidenceRolloutController;
};

async function analyzeFederationImpl(
  files: string[],
  options: FederationAnalysisOptions,
  runId: string,
): Promise<FederationAnalysisResult> {
  const orderedFiles = files.slice().sort(compareCodePoint);
  const projectRoots = orderedFiles.map(workspaceProjectRoot);
  const workspaceRoot = workspaceRootForProjects(projectRoots);
  const loadedProjects = (
    await mapBounded(orderedFiles, async (file) => {
      const project = JSON.parse(await fs.readFile(path.resolve(file), "utf8")) as ProjectFacts;
      Object.defineProperty(project.project, "identityKey", {
        value: createWorkspaceApplicationIdentity(
          project.project.name,
          workspaceProjectRoot(file),
          workspaceRoot,
        ).key,
        enumerable: false,
        configurable: true,
      });
      return { file, project };
    })
  ).sort((a, b) => compareCodePoint(a.project.project.name, b.project.project.name));
  const projects = loadedProjects.map(({ project }) => project);
  const findings: DoctorFinding[] = [];
  const incompleteProjects = loadedProjects
    .filter(({ project }) => hasIncompleteProjectAnalysis(project))
    .map(({ project }) => ({
      project: project.project.name,
      analysis: project.analysis!,
    }))
    .sort((left, right) => compareCodePoint(left.project, right.project));
  const projectGroupKey = (project: ProjectFacts): string =>
    project.project.federationGroup ?? "\0ungrouped";
  const diagnosticGroups = new Set<string>();
  let hasUnscopedDiagnostic = false;
  for (const diagnostic of options.workspaceDiagnostics ?? []) {
    const groups = new Set<string>();
    for (const file of diagnostic.files) {
      const absolute = path.resolve(path.isAbsolute(file) ? file : path.join(workspaceRoot, file));
      for (const entry of loadedProjects)
        if (path.resolve(entry.file) === absolute) groups.add(projectGroupKey(entry.project));
    }
    if (groups.size === 0) hasUnscopedDiagnostic = true;
    for (const group of groups) diagnosticGroups.add(group);
  }
  const workspaceDiagnostics = (options.workspaceDiagnostics ?? [])
    .map((diagnostic) => ({
      kind: diagnostic.kind,
      files: [
        ...new Set(
          diagnostic.files.map((file) =>
            relativePath(
              workspaceRoot,
              path.resolve(path.isAbsolute(file) ? file : path.join(workspaceRoot, file)),
            ),
          ),
        ),
      ].sort(),
      message: diagnostic.message,
    }))
    .sort((left, right) =>
      compareCodePoint(
        `${left.kind}:${left.files.join(",")}:${left.message}`,
        `${right.kind}:${right.files.join(",")}:${right.message}`,
      ),
    );
  const workspaceAnalysis = options.analysis;
  if (workspaceAnalysis && isAnalysisIncomplete(workspaceAnalysis)) {
    pushWorkspacePartialFinding(
      findings,
      workspaceAnalysis.status === "unknown"
        ? "MFDoctor completed with unknown workspace input due to an analysis budget."
        : "MFDoctor completed with partial workspace input.",
      { analysisBudget: workspaceAnalysis },
      { missing: [], analysisBudget: workspaceAnalysis },
    );
  }
  const sourceReadFailures = aggregateWorkspaceSourceReadFailures(loadedProjects, workspaceRoot);
  if (incompleteProjects.length > 0) {
    pushWorkspacePartialFinding(
      findings,
      "MFDoctor found persisted project facts with incomplete source analysis.",
      { projectAnalysis: incompleteProjects },
      { missing: [], projectAnalysis: incompleteProjects },
    );
  }
  if (sourceReadFailures.length > 0) {
    pushWorkspacePartialFinding(
      findings,
      "MFDoctor encountered unreadable source input in workspace; analysis is unknown.",
      { sourceReadFailures },
      { missing: [], sourceReadFailures },
    );
  }
  if (workspaceDiagnostics.length > 0) {
    pushWorkspacePartialFinding(
      findings,
      "MFDoctor found workspace diagnostics; analysis is incomplete.",
      { workspaceDiagnostics },
      { missing: [], workspaceDiagnostics },
    );
  }
  const workspaceAnalysisIncomplete =
    incompleteProjects.length > 0 ||
    sourceReadFailures.length > 0 ||
    isAnalysisIncomplete(options.analysis) ||
    workspaceDiagnostics.length > 0;
  const rules = options.rules ?? {};
  const alwaysShared = new Set<string>([...DEFAULT_ALWAYS_SHARED, ...(options.alwaysShared ?? [])]);
  const rolloutDefaults = createEvidenceRolloutController();
  const rollout = rolloutDefaults.emergencyLegacy
    ? rolloutDefaults
    : (options.evidenceRollout ?? rolloutDefaults);
  const rolloutMode = rollout.modeFor("federation-workspace");
  const root = path.resolve(options.root ?? process.cwd());
  const bridgeBudget =
    rolloutMode === "legacy" ? undefined : new AnalysisBudgetTracker(resolveAnalysisBudgets({}));
  const migratedRuns: MigratedFederationEvidenceRun[] = [];
  const migratedProjectionRuns: MigratedFederationEvidenceRun[] = [];
  const migratedExecutionErrors: RuleExecutionState[] = [];
  let legacyFederationFindings: DoctorFinding[] = [];

  for (const projectGroup of federationProjectGroups(projects)) {
    const groupKey = projectGroupKey(projectGroup[0]!);
    const groupEvidenceIncomplete =
      isAnalysisIncomplete(options.analysis) ||
      hasUnscopedDiagnostic ||
      diagnosticGroups.has(groupKey) ||
      projectGroup.some(
        (project) =>
          hasIncompleteProjectAnalysis(project) ||
          hasPackageCapableUnresolvedDynamic(project) ||
          (project.imports?.sourceReadFailures?.length ?? 0) > 0,
      );

    if (rolloutMode === "legacy" || rolloutMode === "shadow") {
      legacyFederationFindings = legacyFederationFindings.concat(
        legacyFederationFindingsForGroup(
          projectGroup,
          groupEvidenceIncomplete,
          rules,
          alwaysShared,
        ),
      );
    }

    if (rolloutMode !== "legacy") {
      try {
        const run = structureEvidenceRun(
          await runMigratedFederationRules(
            {
              projects: projectGroup,
              groupKey,
              ...(options.analysis ? { workspaceAnalysis: options.analysis } : {}),
              groupEvidenceIncomplete,
              alwaysShared,
            },
            rules,
            bridgeBudget,
          ),
          "evidence",
          runId,
        );
        migratedRuns.push(run);
        const needsLegacyFallback =
          run.output.execution.some((state) => state.state === "engine-error") ||
          isAnalysisIncomplete(run.output.analysis);
        if (rolloutMode === "v2-compat" && needsLegacyFallback) {
          legacyFederationFindings = legacyFederationFindings.concat(
            legacyFederationFindingsForGroup(
              projectGroup,
              groupEvidenceIncomplete,
              rules,
              alwaysShared,
            ),
          );
        } else migratedProjectionRuns.push(run);
      } catch (error) {
        migratedExecutionErrors.push(...federationBridgeEngineErrors(rules, error, root, runId));
        if (rolloutMode === "v2-compat") {
          legacyFederationFindings = legacyFederationFindings.concat(
            legacyFederationFindingsForGroup(
              projectGroup,
              groupEvidenceIncomplete,
              rules,
              alwaysShared,
            ),
          );
        }
      }
    }
  }

  const migratedFederationFindings = sortFindings(
    migratedProjectionRuns.flatMap((run) =>
      projectMigratedFederationFailures(run.output.evaluations, rules, root),
    ),
  );
  const federationParity =
    rolloutMode === "shadow"
      ? compareV1Outputs(
          legacyFederationFindings.filter((finding) =>
            migratedFederationEvidenceRuleIds.has(finding.ruleId),
          ),
          migratedFederationFindings,
        )
      : undefined;
  findings.push(
    ...(rolloutMode === "v2-compat" ? migratedFederationFindings : legacyFederationFindings),
  );

  const baselineOptions = resolveBaselineOptions(options.baseline, root);
  const { findings: baselined, failOnSuppressed } = await withBaseline(
    sortFindings(findings),
    baselineOptions,
  );
  const report = reportFromFindings(projects, baselined, {
    requireProjects: true,
    ...(options.analysis ? { workspaceAnalysis: options.analysis } : {}),
    ...(options.workspaceDiagnostics ? { workspaceDiagnostics: options.workspaceDiagnostics } : {}),
  });
  const ui = buildUiPayload(projects, report);
  const failOn = options.failOn ?? "error";
  const formats = options.formats ?? [];
  const stdoutJson = options.stdoutJson === true;
  if (options.outputDirectory && (formats.length > 0 || stdoutJson))
    await writeFederationReports(
      report,
      options.outputDirectory,
      formats.length > 0 ? formats : ["json"],
      {
        ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
        ...(options.printLog !== undefined ? { printLog: options.printLog } : {}),
        ...(options.score !== undefined ? { score: options.score } : {}),
        ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
        policy: { failOn, failOnSuppressed },
        ...(options.write !== undefined ? { write: options.write } : {}),
        ...(stdoutJson ? { stdoutJson: true } : {}),
      },
    );
  const evidence: EvidenceAnalysisMetadata | undefined =
    rolloutMode === "legacy"
      ? undefined
      : {
          rollout: { scope: "federation-workspace", mode: rolloutMode },
          evaluations: migratedRuns.flatMap((run) => run.output.evaluations),
          execution: [
            ...migratedRuns.flatMap((run) => run.output.execution),
            ...migratedExecutionErrors,
          ],
          ...(federationParity ? { parity: federationParity } : {}),
        };
  return {
    projects,
    findings: baselined,
    report,
    ui,
    exitCode:
      options.requireComplete && !isStrictlyComplete(projects, report.status)
        ? 1
        : workspaceAnalysisIncomplete
          ? 2
          : policyFails(baselined, failOn, failOnSuppressed)
            ? 1
            : 0,
    ...(evidence ? { evidence } : {}),
  };
}

export async function analyzeFederation(
  files: string[],
  options: FederationAnalysisOptions = {},
): Promise<FederationAnalysisResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const normalizedOptions: FederationAnalysisOptions = {
    ...options,
    root,
    ...(options.outputDirectory !== undefined
      ? { outputDirectory: path.resolve(root, options.outputDirectory) }
      : {}),
  };
  const runId = randomUUID();
  try {
    return await analyzeFederationImpl(files, normalizedOptions, runId);
  } catch (error) {
    const message = errorMessage(error);
    const failureRoot = normalizedOptions.root ?? process.cwd();
    if (normalizedOptions.formats?.includes("terminal"))
      process.stderr.write(`MFDoctor could not complete workspace analysis: ${message}\n`);
    const finding = runFailureFinding(
      failureRoot,
      "workspace",
      {
        phase: "analysis",
        errorCode: RUN_FAILURE_ERROR_CODES.analysis,
        runId,
        error: redact(message, failureRoot) as string,
      },
      `MFDoctor workspace analysis failed: ${message}`,
    );
    const findings = [finding];
    const report = reportFromFindings([], findings, {
      requireProjects: true,
      ...(normalizedOptions.analysis ? { workspaceAnalysis: normalizedOptions.analysis } : {}),
      ...(normalizedOptions.workspaceDiagnostics
        ? { workspaceDiagnostics: normalizedOptions.workspaceDiagnostics }
        : {}),
    });
    report.status = markRunIncomplete(report.status, "evidence-unknown");
    if (normalizedOptions.outputDirectory)
      await persistFailureReport(
        normalizedOptions.outputDirectory,
        normalizedOptions.write !== false,
        report,
        normalizedOptions.formats ?? [],
      );
    return {
      projects: [],
      findings,
      report,
      ui: buildUiPayload([], report),
      exitCode: normalizedOptions.requireComplete ? 1 : 2,
    };
  }
}
