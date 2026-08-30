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
): Promise<DoctorFinding[]> {
  const resolved = parseSetting(setting, rule.meta.defaultSeverity);
  if (!resolved || !rule.meta.supportedBundlers.includes(facts.bundler.name)) return [];
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
    const base = {
      schemaVersion: 1 as const,
      ruleId: rule.meta.id,
      severity: "error" as const,
      message: `Rule "${rule.meta.id}" failed during analysis: ${
        error instanceof Error ? error.message : String(error)
      }`,
      project: facts.project.name,
      ...(facts.federationInstanceId ? { federationInstanceId: facts.federationInstanceId } : {}),
      evidence: { ruleId: rule.meta.id },
      documentation: rule.meta.documentation,
      suggestion: "Fix or disable this rule, then re-run MFDoctor to collect the full report.",
    };
    findings.push({ ...base, fingerprint: fingerprint(base) });
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
): RuleExecutionState[] {
  const message = redact(error instanceof Error ? error.message : String(error), root) as string;
  return migratedEvidenceRules
    .filter((rule) => settings[rule.meta.id] !== "off")
    .map((rule) => ({
      state: "engine-error" as const,
      rule: { id: rule.meta.id, version: rule.meta.version },
      reason: "Evidence bridge failed before rule evaluation.",
      error: message,
    }));
}

async function legacyMigratedFallback(
  facts: ProjectFacts,
  settings: Readonly<Record<string, RuleSetting>>,
  root: string,
  sharedPolicy: ResolvedDoctorOptions["sharedPolicy"],
  recognizeMfToolkit: boolean | undefined,
): Promise<DoctorFinding[]> {
  return (
    await Promise.all(
      builtInRules
        .filter((rule) => migratedEvidenceRuleIds.has(rule.meta.id))
        .map((rule) =>
          runRule(rule, facts, settings[rule.meta.id], root, sharedPolicy, recognizeMfToolkit),
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
  const resolved = await resolveOptions(
    diagnostics?.moduleFederationInstances?.length
      ? { ...options, moduleFederationInstances: diagnostics.moduleFederationInstances }
      : options,
  );
  try {
    const boundedRoots = buildOutputs
      ? buildOutputs
          .filter((output) => output.buildWrite !== false)
          .map((output) => output.outputRoot)
          .filter((value): value is string => Boolean(value))
      : undefined;
    const facts = await collectProjectFacts(resolved, boundedRoots);
    if (emittedAssets)
      await addBuildFacts(facts, emittedAssets, resolved.root, diagnostics, buildOutputs);
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
          [...legacyBuiltIns, ...resolved.extends].map((rule) =>
            runRule(
              rule,
              factsForRules,
              resolved.rules[rule.meta.id],
              resolved.root,
              resolved.sharedPolicy,
              resolved.recognizeMfToolkit,
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
      rolloutMode === "legacy" ? undefined : new AnalysisBudgetTracker(resolved.analysisBudgets);
    if (rolloutMode !== "legacy") {
      for (const scope of migratedEvidenceScopes(facts)) {
        try {
          const run = await runMigratedEvidenceRules(
            scope.facts,
            resolved.rules,
            bridgeBudget,
            scope.build,
            {
              root: resolved.root,
              sharedPolicy: resolved.sharedPolicy,
              ...(resolved.recognizeMfToolkit !== undefined
                ? { recognizeMfToolkit: resolved.recognizeMfToolkit }
                : {}),
            },
          );
          migratedRuns.push({ facts: scope.facts, run });
          const needsLegacyFallback =
            run.output.execution.some((state) => state.state === "engine-error") ||
            isAnalysisIncomplete(run.output.analysis);
          if (rolloutMode === "v2-compat" && needsLegacyFallback) {
            legacyFindings = legacyFindings.concat(
              await legacyMigratedFallback(
                scope.facts,
                resolved.rules,
                resolved.root,
                resolved.sharedPolicy,
                resolved.recognizeMfToolkit,
              ),
            );
          } else migratedProjectionRuns.push({ facts: scope.facts, run });
        } catch (error) {
          // A migrated graph is additive. A malformed or budget-clipped bridge
          // must not discard the complete legacy V1 result.
          migratedExecutionErrors.push(...bridgeEngineErrors(resolved.rules, error, resolved.root));
          if (rolloutMode === "v2-compat") {
            legacyFindings = legacyFindings.concat(
              await legacyMigratedFallback(
                scope.facts,
                resolved.rules,
                resolved.root,
                resolved.sharedPolicy,
                resolved.recognizeMfToolkit,
              ),
            );
          }
        }
      }
      if (resolved.runtimeTrace) {
        try {
          const { correlateRuntime, loadRuntimeTraceFile } = await import("./runtime-trace.js");
          const runtimeTraces = await loadRuntimeTraceFile(resolved.runtimeTrace);
          if (runtimeTraces.length > 0) {
            const runtimeProjects = scopedFacts.length > 0 ? scopedFacts : [facts];
            legacyRuntimeFindings = correlateRuntime(runtimeTraces, runtimeProjects);
            const run = await runMigratedRuntimeEvidenceRules(
              facts,
              runtimeProjects,
              runtimeTraces,
              resolved.rules,
              bridgeBudget,
              {
                root: resolved.root,
                sharedPolicy: resolved.sharedPolicy,
                ...(resolved.recognizeMfToolkit !== undefined
                  ? { recognizeMfToolkit: resolved.recognizeMfToolkit }
                  : {}),
              },
            );
            migratedRuns.push({ facts, run });
            migratedProjectionRuns.push({ facts, run });
          }
        } catch (error) {
          migratedExecutionErrors.push(...bridgeEngineErrors(resolved.rules, error, resolved.root));
        }
      }
    }
    const migratedFindings = sortFindings(
      migratedProjectionRuns.flatMap(({ facts: factsForEvidence, run }) =>
        projectMigratedFailures(
          run.output.evaluations,
          factsForEvidence,
          resolved.rules,
          resolved.root,
          run.graph.subjects,
        ),
      ),
    );
    const exactRuntimeAttribution = (finding: DoctorFinding) => finding.project !== "runtime";
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
                  exactRuntimeAttribution(finding),
              ),
            ]),
            findingsForParity(migratedFindings),
          )
        : undefined;
    const rawFindings = sortFindings(
      rolloutMode === "v2-compat" ? [...legacyFindings, ...migratedFindings] : legacyFindings,
    );
    const { findings, failOnSuppressed } = await withBaseline(rawFindings, resolved.baseline);
    // Write the full report before any caller decides to fail the build.
    // Terminal showcase is the single print path (adapters must not re-print).
    const report = reportFor(facts, findings);
    const safeFacts = redact(facts, resolved.root) as ProjectFacts;
    await writeReports(safeFacts, report, resolved.output.directory, resolved.output.formats, {
      quiet: resolved.quiet,
      printLog: resolved.printLog,
      score: resolved.score,
      prompt: resolved.prompt,
    });
    if (resolved.diagnosticsDir)
      await writeDiagnosticsDump(report, resolved.diagnosticsDir, {
        limit: resolved.diagnosticsPromptLimit,
      });
    return {
      facts: safeFacts,
      report,
      exitCode: isAnalysisIncomplete(facts.analysis)
        ? 2
        : policyFails(findings, resolved.failOn, failOnSuppressed)
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
    if (resolved.output.formats.includes("terminal"))
      process.stderr.write(
        `MFDoctor could not complete: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    const emptyFacts = await collectProjectFacts({ ...resolved, include: [] });
    return { facts: emptyFacts, report: reportFor(emptyFacts, []), exitCode: 2 };
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
): RuleExecutionState[] {
  const message = redact(error instanceof Error ? error.message : String(error), root) as string;
  return [...migratedFederationEvidenceRuleIds]
    .filter((id) => settings[id] !== "off")
    .map((id) => ({
      state: "engine-error" as const,
      rule: { id, version: "1" },
      reason: "Federation evidence bridge failed before rule evaluation.",
      error: message,
    }));
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

export async function analyzeFederation(
  files: string[],
  options: {
    outputDirectory?: string;
    formats?: OutputFormat[];
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
    analysis?: AnalysisBudgetReport;
    workspaceDiagnostics?: WorkspaceProjectDiagnostic[];
    /** @internal Evidence rollout injection for staged federation rule migration. */
    evidenceRollout?: import("./evidence-rollout.js").EvidenceRolloutController;
  } = {},
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
        const run = await runMigratedFederationRules(
          {
            projects: projectGroup,
            groupKey,
            ...(options.analysis ? { workspaceAnalysis: options.analysis } : {}),
            groupEvidenceIncomplete,
            alwaysShared,
          },
          rules,
          bridgeBudget,
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
        migratedExecutionErrors.push(...federationBridgeEngineErrors(rules, error, root));
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
  const report = reportFromFindings(projects, baselined);
  const ui = buildUiPayload(projects, report);
  const formats = options.formats ?? [];
  if (options.outputDirectory && formats.length > 0)
    await writeFederationReports(report, options.outputDirectory, formats, {
      ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
      ...(options.printLog !== undefined ? { printLog: options.printLog } : {}),
      ...(options.score !== undefined ? { score: options.score } : {}),
      ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
    });
  const failOn = options.failOn ?? "error";
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
    exitCode: workspaceAnalysisIncomplete
      ? 2
      : policyFails(baselined, failOn, failOnSuppressed)
        ? 1
        : 0,
    ...(evidence ? { evidence } : {}),
  };
}
