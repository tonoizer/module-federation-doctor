import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
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
import { writeDiagnosticsDump } from "./agent-prompt.js";
import { computeHealthScore } from "./health-score.js";
import { builtInRules, federationRuleMeta } from "./rules.js";
import { DEFAULT_ALWAYS_SHARED } from "./shared-policy.js";
import { buildFederationModel, findFederationCycleGroups } from "./federation-model.js";
import {
  createWorkspaceApplicationIdentity,
  workspaceProjectRoot,
  workspaceRootForProjects,
} from "./monorepo-identity.js";
import type { WorkspaceProjectDiagnostic } from "./workspace.js";
import type {
  AnalysisResult,
  DoctorFinding,
  DoctorOptions,
  DoctorReport,
  DoctorRule,
  FederationAnalysisResult,
  OutputFormat,
  ProjectFacts,
  BuildOutputInput,
  ResolvedDoctorOptions,
  RuleSetting,
  Severity,
} from "./types.js";
import { FINDING_DETAILS_SCHEMAS } from "./finding-details.js";
import { deepFreeze, fingerprint, redact, relativePath, sortFindings } from "./utils.js";
import { writeFederationReports, writeReports } from "./reporters.js";
import { buildUiPayload, reportFromFindings } from "./ui-graph.js";
import type { AnalysisBudgetReport } from "./analysis-budgets.js";
import { mapBounded } from "./async-map.js";

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
      evidence: { ruleId: rule.meta.id },
      documentation: rule.meta.documentation,
      suggestion: "Fix or disable this rule, then re-run Doctor to collect the full report.",
    };
    findings.push({ ...base, fingerprint: fingerprint(base) });
  }
  return findings;
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
  const resolved = await resolveOptions(options);
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
    const rawFindings = sortFindings(
      (
        await Promise.all(
          [...builtInRules, ...resolved.extends].map((rule) =>
            runRule(
              rule,
              facts,
              resolved.rules[rule.meta.id],
              resolved.root,
              resolved.sharedPolicy,
              resolved.recognizeMfToolkit,
            ),
          ),
        )
      ).flat(),
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
    if (resolved.diagnosticsDir) await writeDiagnosticsDump(report, resolved.diagnosticsDir);
    return {
      facts: safeFacts,
      report,
      exitCode: isAnalysisIncomplete(facts.analysis)
        ? 2
        : policyFails(findings, resolved.failOn, failOnSuppressed)
          ? 1
          : 0,
    };
  } catch (error) {
    if (resolved.output.formats.includes("terminal"))
      process.stderr.write(
        `Module Federation Doctor could not complete: ${error instanceof Error ? error.message : String(error)}\n`,
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
  return isAnalysisIncomplete(project.analysis);
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
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) =>
      group.sort((left, right) => left.project.name.localeCompare(right.project.name)),
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
  } = {},
): Promise<FederationAnalysisResult> {
  const orderedFiles = files.slice().sort();
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
  ).sort((a, b) => a.project.project.name.localeCompare(b.project.project.name));
  const projects = loadedProjects.map(({ project }) => project);
  const findings: DoctorFinding[] = [];
  const incompleteProjects = loadedProjects
    .filter(({ project }) => hasIncompleteProjectAnalysis(project))
    .map(({ project }) => ({
      project: project.project.name,
      analysis: project.analysis!,
    }))
    .sort((left, right) => left.project.localeCompare(right.project));
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
      `${left.kind}:${left.files.join(",")}:${left.message}`.localeCompare(
        `${right.kind}:${right.files.join(",")}:${right.message}`,
      ),
    );
  const workspaceAnalysis = options.analysis;
  if (workspaceAnalysis && isAnalysisIncomplete(workspaceAnalysis)) {
    pushWorkspacePartialFinding(
      findings,
      workspaceAnalysis.status === "unknown"
        ? "Doctor completed with unknown workspace input due to an analysis budget."
        : "Doctor completed with partial workspace input.",
      { analysisBudget: workspaceAnalysis },
      { missing: [], analysisBudget: workspaceAnalysis },
    );
  }
  const sourceReadFailures = aggregateWorkspaceSourceReadFailures(loadedProjects, workspaceRoot);
  if (incompleteProjects.length > 0) {
    pushWorkspacePartialFinding(
      findings,
      "Doctor found persisted project facts with incomplete source analysis.",
      { projectAnalysis: incompleteProjects },
      { missing: [], projectAnalysis: incompleteProjects },
    );
  }
  if (sourceReadFailures.length > 0) {
    pushWorkspacePartialFinding(
      findings,
      "Doctor encountered unreadable source input in workspace; analysis is unknown.",
      { sourceReadFailures },
      { missing: [], sourceReadFailures },
    );
  }
  if (workspaceDiagnostics.length > 0) {
    pushWorkspacePartialFinding(
      findings,
      "Doctor found stale, duplicate, conflicting, or invalid workspace project facts.",
      { workspaceDiagnostics },
      { missing: [], workspaceDiagnostics },
    );
  }
  const workspaceAnalysisIncomplete =
    incompleteProjects.length > 0 ||
    sourceReadFailures.length > 0 ||
    isAnalysisIncomplete(options.analysis) ||
    workspaceDiagnostics.length > 0;
  const rules = options.rules;
  const alwaysShared = new Set<string>([...DEFAULT_ALWAYS_SHARED, ...(options.alwaysShared ?? [])]);
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
    const federation = buildFederationModel(projectGroup);
    for (const [name, owners] of federation.federationNames)
      if (owners.length > 1)
        pushFederationFinding(
          findings,
          rules,
          "federation/name-conflict",
          owners[0]?.projectName ?? "federation",
          `Module Federation name "${name}" is used by more than one project.`,
          { name, projects: owners.map((owner) => owner.projectName).sort() },
        );

    const strategyOwners = new Map<string, string[]>();
    for (const node of federation.projects) {
      if (!node.project.moduleFederation) continue;
      strategyOwners.set(node.shareStrategy, [
        ...(strategyOwners.get(node.shareStrategy) ?? []),
        node.projectName,
      ]);
    }
    if (strategyOwners.size > 1)
      pushFederationFinding(
        findings,
        rules,
        "federation/share-strategy-mismatch",
        [...strategyOwners.values()][0]?.[0] ?? "federation",
        "Federation projects disagree on `shareStrategy`.",
        {
          strategies: Object.fromEntries(
            [...strategyOwners.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([strategy, owners]) => [strategy, [...owners].sort()]),
          ),
        },
      );

    for (const cycle of findFederationCycleGroups(federation)) {
      if (cycle.riskEdges.length === 0) continue;
      const first = cycle.members[0];
      if (!first) continue;
      pushFederationFinding(
        findings,
        rules,
        "federation/circular-remote-graph",
        first.projectName,
        `Remote graph has a cycle with eager \`version-first\` startup risk: ${cycle.members
          .map((member) => member.federationName ?? member.projectName)
          .join(" -> ")}.`,
        {
          projects: cycle.members.map((member) => member.projectName),
          members: cycle.members.map((member) => ({
            project: member.projectName,
            federationName: member.federationName,
            shareStrategy: member.shareStrategy,
            asyncStartup: member.asyncStartup,
          })),
          edges: cycle.edges.map((edge) => ({
            from: edge.fromFederationName,
            to: edge.targetFederationName,
            project: edge.fromProject,
            remote: edge.remoteName,
            alias: edge.alias,
            entry: edge.entry,
          })),
          riskMembers: cycle.riskMembers.map((member) => ({
            project: member.projectName,
            federationName: member.federationName,
            shareStrategy: member.shareStrategy,
            asyncStartup: member.asyncStartup,
          })),
        },
      );
    }

    const externalRuntimeConsumers = projectGroup.filter(
      (project) => project.moduleFederation?.experiments?.externalRuntime,
    );
    const runtimeProviders = projectGroup.filter(
      (project) => project.moduleFederation?.experiments?.provideExternalRuntime,
    );
    if (
      !groupEvidenceIncomplete &&
      externalRuntimeConsumers.length > 0 &&
      runtimeProviders.length === 0
    )
      pushFederationFinding(
        findings,
        rules,
        "federation/external-runtime-provider-missing",
        externalRuntimeConsumers[0]?.project.name ?? "federation",
        "Projects externalize the Module Federation runtime, but no project provides it.",
        {
          consumers: externalRuntimeConsumers.map((project) => project.project.name).sort(),
        },
      );

    const packages = new Set(
      projectGroup.flatMap((project) => Object.keys(project.moduleFederation?.shared ?? {})),
    );
    for (const name of [...packages].sort()) {
      const entries = projectGroup
        .map((project) => ({ project, shared: project.moduleFederation?.shared[name] }))
        .filter((entry) => entry.shared);
      const scopes = new Set(
        entries.map((entry) => JSON.stringify(entry.shared?.shareScope ?? ["default"])),
      );
      if (scopes.size > 1)
        pushFederationFinding(
          findings,
          rules,
          "federation/share-scope-mismatch",
          entries[0]?.project.project.name ?? "federation",
          `"${name}" uses different share scopes.`,
          { package: name, scopes: [...scopes].sort().map((scope) => JSON.parse(scope)) },
        );
      const singleton = new Set(entries.map((entry) => entry.shared?.singleton));
      if (singleton.size > 1)
        pushFederationFinding(
          findings,
          rules,
          "shared/singleton-mismatch",
          entries[0]?.project.project.name ?? "federation",
          `"${name}" has inconsistent singleton settings.`,
          { package: name },
          {
            detailsSchema: FINDING_DETAILS_SCHEMAS.SHARED_SINGLETON,
            details: { package: name, kind: "mismatch" },
          },
        );
      const versions = entries
        .map((entry) => ({
          project: entry.project.project.name,
          version: entry.project.dependencies.installed[name],
          range: entry.shared?.requiredVersion,
        }))
        .filter((entry) => entry.version);
      if (
        versions.some((left) =>
          versions.some(
            (right) =>
              left.version &&
              typeof right.range === "string" &&
              semver.valid(left.version) &&
              semver.validRange(right.range) &&
              !semver.satisfies(left.version, right.range),
          ),
        )
      )
        pushFederationFinding(
          findings,
          rules,
          "federation/version-conflict",
          versions[0]?.project ?? "federation",
          `"${name}" versions do not satisfy all consumer ranges.`,
          { package: name, versions },
        );
      const consumersWithoutFallback = entries.filter((entry) => entry.shared?.import === false);
      const providers = entries.filter((entry) => entry.shared?.import !== false);
      if (!groupEvidenceIncomplete && consumersWithoutFallback.length > 0 && providers.length === 0)
        pushFederationFinding(
          findings,
          rules,
          "federation/missing-provider",
          entries[0]?.project.project.name ?? "federation",
          `"${name}" has no provider or local fallback.`,
          {
            package: name,
            consumers: consumersWithoutFallback.map((entry) => entry.project.project.name).sort(),
          },
        );
    }

    // Cross-project usage vs shared declarations (MFDOCTOR-122 / shared-inspector).
    if (projectGroup.length > 1) {
      const sharedByPkg = new Map<string, Set<string>>();
      const usedByPkg = new Map<string, Set<string>>();
      for (const project of projectGroup) {
        const mfName = project.project.name;
        for (const pkg of Object.keys(project.moduleFederation?.shared ?? {})) {
          if (!sharedByPkg.has(pkg)) sharedByPkg.set(pkg, new Set());
          sharedByPkg.get(pkg)!.add(mfName);
        }
        for (const pkg of project.imports?.packages ?? []) {
          if (!usedByPkg.has(pkg)) usedByPkg.set(pkg, new Set());
          usedByPkg.get(pkg)!.add(mfName);
        }
      }

      for (const [pkg, usedByMfs] of [...usedByPkg.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        if (!groupEvidenceIncomplete) {
          if (usedByMfs.size < 2) continue;
          if (alwaysShared.has(pkg)) continue;
          const sharedByMfs = sharedByPkg.get(pkg);
          if (sharedByMfs && sharedByMfs.size > 0) continue;
          // Workspace protocol deps are monorepo source links, not federation share gaps.
          const isWorkspacePackage = projectGroup.some((project) => {
            const range = project.dependencies?.declared?.[pkg];
            return typeof range === "string" && range.startsWith("workspace:");
          });
          if (isWorkspacePackage) continue;
          pushFederationFinding(
            findings,
            rules,
            "federation/host-gaps",
            [...usedByMfs].sort()[0] ?? "federation",
            `"${pkg}" is imported by ${usedByMfs.size} projects but is not in any shared config.`,
            { package: pkg, missingIn: [...usedByMfs].sort() },
          );
        }
      }

      if (!groupEvidenceIncomplete)
        for (const [pkg, sharedByMfs] of [...sharedByPkg.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          if (alwaysShared.has(pkg)) continue;
          if (sharedByMfs.size !== 1) continue;
          const soloMf = [...sharedByMfs][0]!;
          const usedByMfs = usedByPkg.get(pkg) ?? new Set<string>();
          const usedUnsharedBy = [...usedByMfs]
            .filter((mf) => mf !== soloMf && !sharedByPkg.get(pkg)?.has(mf))
            .sort();
          const otherMfsUseIt = [...usedByMfs].some((mf) => mf !== soloMf);
          if (!otherMfsUseIt || usedUnsharedBy.length > 0) {
            pushFederationFinding(
              findings,
              rules,
              "federation/ghost-shares",
              soloMf,
              otherMfsUseIt
                ? `"${pkg}" is shared only by "${soloMf}" while other projects import it without sharing.`
                : `"${pkg}" is shared only by "${soloMf}" and unused elsewhere in the federation graph.`,
              {
                package: pkg,
                sharedBy: soloMf,
                usedUnsharedBy,
              },
            );
          }
        }
    }
  }

  const root = path.resolve(options.root ?? process.cwd());
  const baselineOptions = resolveBaselineOptions(options.baseline, root);
  const { findings: baselined, failOnSuppressed } = await withBaseline(
    sortFindings(findings),
    baselineOptions,
  );
  const report = reportFromFindings(projects, baselined);
  const ui = buildUiPayload(projects, report);
  const formats = options.formats ?? [];
  if (options.outputDirectory && formats.length > 0)
    await writeFederationReports(projects, report, options.outputDirectory, formats, {
      ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
      ...(options.printLog !== undefined ? { printLog: options.printLog } : {}),
      ...(options.score !== undefined ? { score: options.score } : {}),
      ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
    });
  const failOn = options.failOn ?? "error";
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
  };
}
